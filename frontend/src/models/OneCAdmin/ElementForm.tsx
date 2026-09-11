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
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import { NoticeScope } from "./notices";
import NoticeBoard from "./NoticeBoard";
import ModelForm from "src/components/ModelForm";
import Modal from "src/components/Modal";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import Notice from "src/components/Notice";
import { showToast } from "src/components/UIToast";
import { translate } from "src/i18";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBases, fetchUserOccurrences, runBatch, type BatchType, type OnecBase,
} from "src/services/onec/api";
import RolesPicker from "./RolesPicker";
import { useOpenOnecBase } from "src/models/OneCBases";
import { QueryError, isApplicable, publishLabel } from "./shared";
import main from "src/styles/main.module.scss";
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
	const openBase = useOpenOnecBase();
	const [dialog, setDialog] = useState<Op | null>(null);
	const [picked, setPicked] = useState<string[]>(() => {
		const scope = asText((paneProps.data as TDataItem | undefined)?.scopeBase);
		return scope ? [scope] : [];
	});
	const [showAll, setShowAll] = useState(false);

	// Реквизиты. Пустое поле в изменении означает «не трогать»: групповая правка полного
	// имени не должна заодно стирать всем пароли.
	const [name, setName] = useState(elementName);
	const [fullName, setFullName] = useState(asText(row.fullName));
	const [password, setPassword] = useState("");
	const [disabled, setDisabled] = useState(row.disabledFlag === true);
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);
	// Роли: пустой набор в изменении означает «не трогать» — как и прочие поля. Явное
	// «снять все роли» пришлось бы делать отдельной командой, и это к лучшему: случайно
	// разослать «без ролей» на сотню баз здесь невозможно.
	const [roles, setRoles] = useState<string[]>(Array.isArray(row.roles) ? (row.roles as string[]) : []);

	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	// «Где заведён» для пользователя — из кэша реестра, без обращения к 1С.
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", elementName],
		queryFn: () => fetchUserOccurrences(elementName),
		enabled: isUser && !!elementName,
	});

	/** Из какой базы взяты показанные роли — чтобы «текущие» не выглядели общими для всех. */
	const [rolesFrom, setRolesFrom] = useState<string>(asText(row.baseKey) || asText(row.scopeBase));
	// Сводка ролей не несёт (там имя, число баз и признак отключения), поэтому при открытии
	// из неё поле ролей было пустым — и выглядело как «ролей нет». Подтягиваем их из базы:
	// из открытой, если форма вызвана в контексте базы, иначе из первой, где он заведён.
	useEffect(() => {
		if (!isUser || roles.length || !occurrences.data?.items?.length) return;
		const scope = asText(row.scopeBase);
		const src = scope
			? occurrences.data.items.find((o) => o.baseKey === scope)
			: occurrences.data.items.find((o) => (o.roles ?? []).length);
		if (src?.roles?.length) { setRoles(src.roles); setRolesFrom(src.baseKey); }
	}, [isUser, roles.length, occurrences.data, row.scopeBase]);

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
						...(roles.length ? { roles } : {}),
						disabled,
					}
						: isUser ? {
							name: name.trim(),
							...(fullName.trim() ? { fullName: fullName.trim() } : {}),
							...(password ? { password } : {}),
							...(roles.length ? { roles } : {}),
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

	// База, у которой спрашивать справочник ролей: отмеченная, иначе первая, где
	// пользователь уже заведён — у неё та же конфигурация.
	const firstBase = (occurrences.data?.items ?? [])[0]?.baseKey ?? (bases.data?.items ?? [])[0]?.key;

	// «Закрыть» в командной панели формы НИЧЕГО не делала: обработчик был пустой
	// заглушкой. Кнопка, которая рисуется и не работает, хуже отсутствующей.
	const { requestClose } = useAppContext().windows;
	// Своя область сообщений: карточка открыта отдельным пейном и может быть единственным,
	// что человек видит, — её сообщения обязаны быть видны в ней самой.
	const scope = paneProps.uniqId ?? "element-card";
	const closeCard = useCallback(() => {
		if (paneProps.uniqId) void requestClose(paneProps.uniqId);
	}, [requestClose, paneProps.uniqId]);

	return (
		<NoticeScope.Provider value={scope}>
			<ModelForm
				paneId={paneProps.uniqId}
				readonly
				isLoading={bases.isLoading}
				// Реквизиты живут в базах 1С, а не у нас: «сохранить» здесь нечего —
				// изменения уходят командой по отмеченным базам.
				onSave={() => {}} onSaveAndClose={() => {}} onClose={closeCard}
				tabs={[
					{
						id: "main", label: translate("general"),
						// Каркас — общий для форм приложения (см. SalesForm).
						component: (
							<div className={main.FormContainer}>
								<div className={main.FormWrapper}>
									<GroupCol className={main.Form}>
										{/* Области — как в остальных карточках панели: сперва чем элемент
										    является, затем что в нём меняют. Колонки полей совпадают с
										    другими формами за счёт общих токенов ширины. */}
										<FormArea title={isUser ? translate("onecUser") : translate("onecExtension")}>
											<GroupRow>
												<Field name="el_name" label={isUser ? translate("onecUserName") : translate("onecExtName")}
													value={name} width={FIELD_WIDTH.wide} noAutofill
													onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
												{isUser ? (
													<Field name="el_full" label={translate("onecUserFullName")} value={fullName} width={FIELD_WIDTH.wide} noAutofill
														onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)} />
												) : (
													<Field name="el_syn" label={translate("onecExtSynonym")} value={asText(row.synonym) || "—"}
														disabled width={FIELD_WIDTH.wide} onChange={() => {}} />
												)}
												<Field name="el_bases" label={translate("bases")} value={String(present.size)} disabled
													width={FIELD_WIDTH.sm} onChange={() => {}} />
											</GroupRow>
										</FormArea>

										<FormArea title={isUser ? translate("onecAreaUserData") : translate("onecExtFile")}>
											{isUser ? (
												<GroupRow>
													<Field name="el_pwd" label={translate("onecUserPassword")} type="password" value={password}
														width={FIELD_WIDTH.wide}
														onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
													<FieldToggle name="el_disabled" label={translate("onecUserDisabled")}
														value={disabled} onChange={setDisabled} />
												</GroupRow>
											) : (
												<GroupCol>
													<GroupRow>
														<Field name="el_version" label={translate("version")} value={asText(row.version) || "—"}
															disabled width={FIELD_WIDTH.md} onChange={() => {}} />
														<Field name="el_purpose" label={translate("purpose")} value={asText(row.purpose) || "—"}
															disabled width={FIELD_WIDTH.md} onChange={() => {}} />
													</GroupRow>
													<GroupRow>
														<input type="file" accept=".cfe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
														<FieldToggle name="el_safe" label={translate("onecExtSafeMode")} value={safeMode} onChange={setSafeMode} />
													</GroupRow>
												</GroupCol>
											)}
										</FormArea>
									</GroupCol>

									<GroupCol className={main.FormNotice}>
										<QueryError error={bases.error ?? occurrences.error}
											noticeKey="element-card" source={isUser ? translate("onecUser") : translate("onecExtension")} />
										<Notice items={[{ type: "info", text: translate("onecElementCardHint") }]} />
									</GroupCol>
								</div>
							</div>
						),
					},
					...(isUser ? [{
						id: "roles", label: translate("roles"),
						component: (
							<GroupCol>
								<div className={styles.Hint}>{translate("onecRolesHint")}</div>
								{/* Применение — прямо здесь: уходить за ним на вкладку «Базы» значит
								    забыть про него. Что отмечено, написано рядом с кнопкой. */}
								<GroupRow>
									<span className={styles.Hint}>
										{translate("onecBatchTargets")}: {picked.length}
										{picked.length ? ` (${picked.slice(0, 3).join(", ")}${picked.length > 3 ? "…" : ""})` : ""}
									</span>
									<Button variant="primary" disabled={!picked.length || !elementName}
										onClick={() => setDialog("update")}>
										{translate("onecUserUpdate")}
									</Button>
									{!picked.length && <span className={styles.Hint}>{translate("onecPickBasesFirst")}</span>}
								</GroupRow>
								{rolesFrom && (
									<div className={styles.Hint}>{translate("onecRolesTakenFrom")}: {rolesFrom}</div>
								)}
								<RolesPicker value={roles} onChange={setRoles} baseKey={picked[0] ?? firstBase} />

								{/* Что назначено СЕЙЧАС и где: одинаковое имя в разных базах не
								    означает одинаковых прав, и до этой таблицы расхождение было
								    видно только по одной базе за раз. */}
								<div className={styles.Hint}>{translate("onecRolesByBase")}</div>
								<div className={styles.RolesList}>
									{(occurrences.data?.items ?? []).map((o) => (
										<div key={o.baseKey} className={styles.InstanceRow}>
											<span className={styles.InstanceName}>{o.baseKey}</span>
											<span>{(o.roles ?? []).join(", ") || "—"}</span>
										</div>
									))}
									{!(occurrences.data?.items ?? []).length && (
										<div className={styles.Hint}>{translate("onecRolesNoData")}</div>
									)}
								</div>
							</GroupCol>
						),
					}] : []),
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
									// Строка — база: двойной щелчок открывает её карточку.
									onRowClick: (r) => openBase(asText(r.baseKey)),
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
						{/* Что именно уйдёт в базу — показываем ДО применения: подтверждают вслепую, а
						    роли на сотне баз стереть/переписать легко. Пустое поле = «не трогать»,
						    поэтому здесь только заполненное; disabled шлётся всегда. */}
						{isUser && (dialog === "update" || dialog === "create") && (
							<div className={styles.ModalChanges}>
								<div className={styles.ModalChangesTitle}>{translate("onecChangesTitle")}:</div>
								{dialog === "update" && name.trim() && name.trim() !== elementName && (
									<div>{translate("onecUserNewName")}: {name.trim()}</div>
								)}
								{fullName.trim() && <div>{translate("onecUserFullName")}: {fullName.trim()}</div>}
								{password && <div>{translate("onecUserPassword")}: {translate("onecPwdWillChange")}</div>}
								{dialog === "update" && (
									<div>{translate("onecUserDisabled")}: {disabled ? translate("yes") : translate("no")}</div>
								)}
								<div>{translate("roles")}: {roles.length ? roles.join(", ") : translate("onecRolesUnchanged")}</div>
							</div>
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
			{/* Полоса сообщений внизу пейна: место занято всегда — форма не дёргается. */}
			<NoticeBoard compact scope={scope} />
		</NoticeScope.Provider>
	);
};
ElementForm.displayName = "ElementForm";

/** Открыть форму элемента отдельным пейном — двойным щелчком по строке сводки. */
export function useOpenElement(kind: ElementKind) {
	const { addPane } = useAppContext().windows;
	/**
	 * `baseKey` — открыть элемент В КОНКРЕТНОЙ БАЗЕ: она сразу отмечена, роли и реквизиты
	 * взяты из неё. Без него открывается группа (одно имя во всех базах).
	 *
	 * Разница существенная: «поменять роли Иванову в базе клиента» и «поменять их во всех
	 * базах» — разные задачи, и вторая по ошибке правит сотню чужих баз.
	 */
	return (row: Partial<TDataItem>, baseKey?: string) => addPane({
		label: `${kind === "user" ? translate("onecUserCard") : translate("onecExtCard")}: ${asText(row.name)}`
			+ (baseKey ? ` — ${baseKey}` : ""),
		component: ElementForm as never,
		data: { ...row, kind, scopeBase: baseKey ?? "" } as TDataItem,
	});
}

export default ElementForm;
