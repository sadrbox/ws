/**
 * Форма элемента, живущего сразу во многих базах: расширения или пользователя ИБ.
 *
 * ЗАЧЕМ. Сводка отвечает «сколько баз знают этот элемент», но не «что он такое»: у
 * пользователя есть роли, полное имя и признак отключения, у расширения — версия,
 * назначение и безопасный режим. Всё это приходило в ответах и выбрасывалось. Здесь
 * элемент — главный объект: сверху его реквизиты, ниже базы, где он есть, и команды
 * ровно над отмеченными.
 *
 * ГРУППА — ЭТО ТОЧНОЕ СОВПАДЕНИЕ ИМЕНИ. Пользователи группируются по паре имя+полное имя,
 * расширения — по паре имя+синоним: так их считает сводка, и так же адресуются команды.
 * Поэтому групповое изменение безопасно: под одним именем в разных базах — один и тот же
 * человек или одно и то же расширение, а не однофамильцы.
 *
 * ПОЧЕМУ ИЗМЕНЕНИЕ, А НЕ ПЕРЕСОЗДАНИЕ. «Удалить и создать заново» на сотне баз — это сотня
 * шансов остановиться на середине и потерять настройки пользователя. Изменение идёт
 * отдельной командой, где незаполненное поле значит «не трогать».
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import ModelForm from "src/components/ModelForm";
import Modal from "src/components/Modal";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBases, fetchUserOccurrences, runBatch, type BatchType, type OnecBase,
} from "src/services/onec/api";
import { QueryError, isApplicable, publishLabel } from "./shared";
import styles from "./OneCAdmin.module.scss";

export type ElementKind = "user" | "extension";

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "presence", type: "string", width: "130px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "published", type: "string", width: "140px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Файл расширения → base64: агент не ходит за ним в сеть, файл едет телом команды. */
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
	const reader = new FileReader();
	reader.onerror = () => reject(new Error(translate("onecExtFileRequired")));
	reader.onload = () => resolve(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
	reader.readAsDataURL(file);
});

type Op = "create" | "update" | "delete";

export const ElementForm: FC<Partial<TPane>> = (paneProps) => {
	const row = (paneProps.data ?? {}) as TDataItem;
	const kind: ElementKind = asText(row.kind) === "user" ? "user" : "extension";
	const isUser = kind === "user";
	const elementName = asText(row.name);

	const qc = useQueryClient();
	const [dialog, setDialog] = useState<Op | null>(null);
	const [picked, setPicked] = useState<string[]>([]);
	const [showAll, setShowAll] = useState(false);

	// Реквизиты. Пустое поле в изменении означает «не трогать»: групповая правка полного
	// имени не должна заодно стирать всем пароли.
	const [name, setName] = useState(elementName);
	const [fullName, setFullName] = useState(asText(row.fullName));
	const [password, setPassword] = useState("");
	const [disabled, setDisabled] = useState(row.disabledFlag === true);
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);

	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	// «Где заведён» для пользователя — из кэша реестра, без обращения к 1С.
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", elementName],
		queryFn: () => fetchUserOccurrences(elementName),
		enabled: isUser && !!elementName,
	});

	const present = useMemo(() => {
		if (isUser) return new Set((occurrences.data?.items ?? []).map((o) => o.baseKey.toLowerCase()));
		return new Set((bases.data?.items ?? [])
			.filter((b) => elementName && b.extensionNames.some((n) => n.toLowerCase() === elementName.toLowerCase()))
			.map((b) => b.key.toLowerCase()));
	}, [isUser, occurrences.data, bases.data, elementName]);

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), `OneCAdmin_elem_${kind}`));
	const rowsRaw = useMemo(() => (bases.data?.items ?? [])
		.filter((b: OnecBase) => showAll || isApplicable(b, "ib"))
		.map((b, i) => ({
			id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
			presence: present.has(b.key.toLowerCase()) ? translate("onecPresent") : translate("onecAbsent"),
			published: publishLabel(b.published),
		})), [bases.data, showAll, present]);
	const view = useStaticTableView(rowsRaw, { presence: "asc", baseKey: "asc" });
	const hidden = (bases.data?.items ?? []).length - rowsRaw.length;

	const batch = useMutation({
		mutationFn: async () => {
			const type: BatchType = dialog === "delete"
				? (isUser ? "IB_DELETE_USER" : "IB_DELETE_EXTENSION")
				: dialog === "update"
					? "IB_UPDATE_USER"
					: (isUser ? "IB_CREATE_USER" : "IB_INSTALL_EXTENSION");

			const payload: Record<string, unknown> =
				dialog === "delete" ? { name: elementName || name.trim() }
					: dialog === "update" ? {
						name: elementName,
						...(name.trim() && name.trim() !== elementName ? { newName: name.trim() } : {}),
						...(fullName.trim() ? { fullName: fullName.trim() } : {}),
						...(password ? { password } : {}),
						disabled,
					}
						: isUser ? {
							name: name.trim(),
							...(fullName.trim() ? { fullName: fullName.trim() } : {}),
							...(password ? { password } : {}),
						}
							: { name: name.trim(), safeMode, contentBase64: file ? await toBase64(file) : "" };

			return runBatch(type, picked, payload);
		},
		onSuccess: (d) => {
			const tail = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${tail}`, d.skipped.length ? "warning" : "success");
			void qc.invalidateQueries({ queryKey: ["onec"] });
			setDialog(null);
		},
		onError: (e: unknown) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const apply = () => {
		if (!picked.length) return;
		if (dialog !== "delete" && !name.trim()) return;
		if (dialog === "create" && !isUser && !file) { showToast(translate("onecExtFileRequired"), "error"); return; }
		batch.mutate();
	};

	const roles = Array.isArray(row.roles) ? (row.roles as string[]) : [];

	return (
		<>
			<ModelForm
				paneId={paneProps.uniqId}
				readonly
				isLoading={bases.isLoading}
				// Реквизиты живут в базах 1С, а не у нас: «сохранить» здесь нечего —
				// изменения уходят командой по отмеченным базам.
				onSave={() => {}} onSaveAndClose={() => {}} onClose={() => {}}
				tabs={[
					{
						id: "main", label: translate("general"),
						component: (
							<GroupCol>
								<QueryError error={bases.error ?? occurrences.error} />
								<GroupRow>
									<Field name="el_name" label={isUser ? translate("onecUserName") : translate("onecExtName")}
										value={name} width="260px"
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
									{isUser ? (
										<Field name="el_full" label={translate("onecUserFullName")} value={fullName} width="260px"
											autoComplete="off"
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)} />
									) : (
										<Field name="el_syn" label={translate("onecExtSynonym")} value={asText(row.synonym) || "—"}
											disabled width="260px" onChange={() => {}} />
									)}
									<Field name="el_bases" label={translate("bases")} value={String(present.size)} disabled
										width="110px" onChange={() => {}} />
								</GroupRow>

								{isUser ? (
									<GroupRow>
										<Field name="el_pwd" label={translate("onecUserPassword")} type="password" value={password}
											width="240px" autoComplete="new-password"
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
										<FieldToggle name="el_disabled" label={translate("onecUserDisabled")}
											value={disabled} onChange={setDisabled} />
									</GroupRow>
								) : (
									<GroupRow>
										<Field name="el_version" label={translate("version")} value={asText(row.version) || "—"}
											disabled width="150px" onChange={() => {}} />
										<Field name="el_purpose" label={translate("purpose")} value={asText(row.purpose) || "—"}
											disabled width="180px" onChange={() => {}} />
										<input type="file" accept=".cfe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
										<FieldToggle name="el_safe" label={translate("onecExtSafeMode")} value={safeMode} onChange={setSafeMode} />
									</GroupRow>
								)}

								{isUser && roles.length > 0 && (
									// Роли показываем как есть: их десятки, и любое «сокращение для
									// красоты» здесь скрывало бы права.
									<div className={styles.Hint}>{translate("roles")}: {roles.join(", ")}</div>
								)}
							</GroupCol>
						),
					},
					{
						id: "bases", label: translate("onecTabBases"),
						component: (
							<>
								<div className={styles.Hint}>{translate("onecElementBasesHint")}</div>
								<Table {...buildStaticTableProps({
									componentName: `OneCAdmin_elem_${kind}`, rows: view.rows, columns: cols, setColumns: setCols,
									sorting: view.sorting, search: view.search,
									isLoading: bases.isLoading,
									onReload: () => void bases.refetch(),
									selectable: true,
									onSelectionChange: (sel: Set<number>, all: TDataItem[]) =>
										setPicked(all.filter((r) => sel.has(Number(r.id))).map((r) => String(r.baseKey))),
									extraButtons: (
										<>
											<Button variant="secondary" disabled={!picked.length} onClick={() => setDialog("create")}>
												{isUser ? translate("onecUserCreate") : translate("onecExtInstall")}
											</Button>
											{isUser && (
												<Button variant="secondary" disabled={!picked.length || !elementName}
													onClick={() => setDialog("update")}>
													{translate("onecUserUpdate")}
												</Button>
											)}
											<Button variant="danger" disabled={!picked.length || !elementName}
												onClick={() => setDialog("delete")}>
												{isUser ? translate("onecUserDelete") : translate("onecExtRemove")}
											</Button>
											{(hidden > 0 || showAll) && (
												<Button variant="secondary" active={showAll} onClick={() => setShowAll((v) => !v)}>
													{translate("onecShowInapplicable")}{hidden > 0 && !showAll ? ` (${hidden})` : ""}
												</Button>
											)}
										</>
									),
								})} />
							</>
						),
					},
				]}
			/>

			{dialog && (
				<Modal
					title={dialog === "delete"
						? (isUser ? translate("onecUserDelete") : translate("onecExtRemove"))
						: dialog === "update" ? translate("onecUserUpdate")
							: (isUser ? translate("onecUserCreate") : translate("onecExtInstall"))}
					onClose={() => setDialog(null)}
					onApply={apply}
				>
					<div className={styles.ModalForm}>
						<div>{translate("onecBatchTargets")}: {picked.length}</div>
						<div>{isUser ? translate("onecUserName") : translate("onecExtName")}: {elementName || name}</div>
						{dialog === "update" && (
							<div className={styles.Hint}>{translate("onecUserUpdateHint")}</div>
						)}
						<div className={styles.ConfirmWarning}>
							{dialog === "delete"
								? (isUser ? translate("onecUserDeleteWarning") : translate("onecExtRemoveWarning"))
								: dialog === "update" ? translate("onecUserUpdateWarning")
									: (isUser ? translate("onecUserCreateWarning") : translate("onecExtInstallWarning"))}
						</div>
					</div>
				</Modal>
			)}
		</>
	);
};
ElementForm.displayName = "ElementForm";

/** Открыть форму элемента отдельным пейном — двойным щелчком по строке сводки. */
export function useOpenElement(kind: ElementKind) {
	const { addPane } = useAppContext().windows;
	return (row: Partial<TDataItem>) => addPane({
		label: `${kind === "user" ? translate("onecUserCard") : translate("onecExtCard")}: ${asText(row.name)}`,
		component: ElementForm as never,
		data: { ...row, kind } as TDataItem,
	});
}

export default ElementForm;
