/**
 * Вкладка «Расширения» (E15/A3, A4): что где стоит и как это изменить.
 *
 * Собрана по тому же образцу, что «Пользователи баз», и намеренно так же: задачи у них
 * одинаковой формы — элемент, живущий во многих базах, и команда по отмеченным базам.
 * Разные экраны для одинаковых задач заставляли бы учить панель дважды.
 *
 * Слева — `Table` со сводкой расширений (отметки = цель групповой команды), справа —
 * карточка: реквизиты, базы с отметками, предпросмотр. Все команды живут в командных
 * панелях таблиц, кнопок внутри строк нет.
 *
 * ГРУППИРОВКА ПО ПАРЕ ИМЯ+СИНОНИМ. Служебное имя вида `EF_00_00062442` ничего не говорит,
 * а одно и то же имя в разных базах может принадлежать разным расширениям — склеивать их
 * в одну строку значило бы врать о том, что стоит одинаковое.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBases, fetchBatch, fetchExtensionSummary, runBatch, type BatchType,
} from "src/services/onec/api";
import { Icon } from "src/components/IconButton/icons";
import { CapabilityGuard, QueryError, isApplicable, useBaseContentCheck } from "./shared";
import styles from "./OneCAdmin.module.scss";

const summaryColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "synonym", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "basesCount", type: "number", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "presence", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "extensionsCount", type: "number", width: "130px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Файл .cfe → base64: агент не ходит за ним в сеть, файл едет телом команды. */
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
	const reader = new FileReader();
	reader.onerror = () => reject(new Error(translate("onecExtFileRequired")));
	reader.onload = () => resolve(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
	reader.readAsDataURL(file);
});

export const ExtensionsTab: FC<{ onBatchStarted: (id: string) => void }> = ({ onBatchStarted }) => {
	const qc = useQueryClient();

	const [pickedExt, setPickedExt] = useState<string[]>([]);
	const [pickedBases, setPickedBases] = useState<string[]>([]);
	const [dialog, setDialog] = useState<null | "install" | "remove">(null);
	const [form, setForm] = useState({ name: "", safeMode: true });
	const [file, setFile] = useState<File | null>(null);

	const summary = useQuery({ queryKey: ["onec", "ext-summary"], queryFn: fetchExtensionSummary });
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });

	const [sumCols, setSumCols] = useState<TColumn[]>(() => getModelColumns(summaryColumns(), "OneCAdmin_extSummary"));
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_extBases"));

	/** Карточку показываем для ПЕРВОГО отмеченного: остальные — цели той же команды. */
	const current = pickedExt[0] ?? "";
	const currentRow = useMemo(
		() => (summary.data?.items ?? []).find((x) => x.name === current) ?? null,
		[summary.data, current],
	);

	const sumRows = useMemo(() => (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: `${x.name}|${x.synonym}`, name: x.name,
		synonym: x.synonym || "—", basesCount: x.bases,
	})), [summary.data]);
	const sumView = useStaticTableView(sumRows, { name: "asc" });

	/** Базы, где расширение уже стоит, — из кэша имён расширений базы. */
	const baseRows = useMemo(() => (bases.data?.items ?? [])
		.filter((b) => isApplicable(b, "ib"))
		.map((b, i) => ({
			id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
			presence: current && b.extensionNames.some((n) => n.toLowerCase() === current.toLowerCase())
				? translate("onecPresent") : translate("onecAbsent"),
			extensionsCount: b.extensionsCount ?? translate("onecExtNotChecked"),
		})), [bases.data, current]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });

	/** Базы, где расширения ещё НЕТ, — цель установки; где есть — цель удаления. */
	const missing = useMemo(() => pickedBases.filter((k) => {
		const b = (bases.data?.items ?? []).find((x) => x.key === k);
		return !!b && !b.extensionNames.some((n) => n.toLowerCase() === current.toLowerCase());
	}), [pickedBases, bases.data, current]);
	const present = pickedBases.filter((k) => !missing.includes(k));

	const batch = useMutation({
		mutationFn: (p: { type: BatchType; keys: string[]; payload: Record<string, unknown> }) =>
			runBatch(p.type, p.keys, p.payload),
		onSuccess: (d) => {
			setDialog(null);
			const skipped = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${skipped}`, d.skipped.length ? "warning" : "success");
			onBatchStarted(d.batchId);
			void watchBatch(d.batchId);
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	/** Дождаться конца задания и перечитать: иначе экран остаётся с картиной «до». */
	const watchBatch = useCallback(async (batchId: string) => {
		let pause = 2000;
		const until = Date.now() + 15 * 60_000;
		while (Date.now() < until) {
			await new Promise((r) => setTimeout(r, pause));
			pause = Math.min(15_000, Math.round(pause * 1.4));
			const b = await fetchBatch(batchId).catch(() => null);
			if (!b) return;
			if (b.pending === 0) break;
		}
		await qc.invalidateQueries({ queryKey: ["onec", "ext-summary"] });
		await qc.invalidateQueries({ queryKey: ["onec", "bases"] });
	}, [qc]);

	// Чтение расширений баз — тем же механизмом, что и пользователей (см.
	// useBaseContentCheck): операция видна в «Прогрессе запросов и команд», её итог
	// приходит сообщением, сводки после неё перечитываются.
	const check = useBaseContentCheck("extensions");

	const apply = useCallback(async () => {
		const name = (current || form.name).trim();
		if (!name || !pickedBases.length) return;
		if (dialog === "remove") {
			batch.mutate({ type: "IB_DELETE_EXTENSION", keys: pickedBases, payload: { name } });
			return;
		}
		if (!file) { showToast(translate("onecExtFileRequired"), "error"); return; }
		batch.mutate({
			type: "IB_INSTALL_EXTENSION", keys: pickedBases,
			payload: { name, safeMode: form.safeMode, contentBase64: await toBase64(file) },
		});
	}, [batch, current, form, file, dialog, pickedBases]);

	return (
		<>
			<CapabilityGuard capability="ib.admin" />

			<div className={styles.UsersLayout}>
				<div className={styles.UsersList}>
					<QueryError error={summary.error} />
					<Table {...buildStaticTableProps({
						componentName: "OneCAdmin_extSummary", rows: sumView.rows, columns: sumCols,
						setColumns: setSumCols, sorting: sumView.sorting, search: sumView.search,
						isLoading: summary.isLoading,
						onReload: () => void summary.refetch(),
						reloadTitle: translate("onecReloadCached"),
						selectable: true,
						onSelectionChange: (sel, all) => {
							const names = all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.name));
							setPickedExt(names);
							if (names[0]) setForm((f) => ({ ...f, name: names[0] }));
						},
						extraButtons: (
							<Button variant="secondary" disabled={!pickedBases.length}
								title={translate("onecExtInstall")}
								onClick={() => { setPickedExt([]); setForm({ name: "", safeMode: true }); setFile(null); setDialog("install"); }}>
								<Icon name="plus" /> {translate("create")}
							</Button>
						),
					})} />
				</div>

				<div className={styles.UsersCard}>
					{!current ? (
						<Notice items={[{ type: "info", text: translate("onecPickExtFirst") }]} />
					) : (
						<>
							<div className={styles.SecHead}>
								{translate("onecExtCard")}: {current}
								{pickedExt.length > 1 && ` · ${translate("onecBatchTargets")}: ${pickedExt.length}`}
							</div>
							<div className={styles.SecBody}>
								<GroupCol>
									<GroupRow>
										<Field name="ex_name" label={translate("onecExtName")} value={current} disabled width="240px" onChange={() => {}} />
										<Field name="ex_syn" label={translate("onecExtSynonym")} value={currentRow?.synonym || "—"} disabled width="240px" onChange={() => {}} />
										<Field name="ex_bases" label={translate("bases")} value={String(currentRow?.bases ?? 0)} disabled width="90px" onChange={() => {}} />
										<Field name="ex_ver" label={translate("version")}
											value={(currentRow?.versions ?? []).join(", ") || "—"} disabled width="180px" onChange={() => {}} />
									</GroupRow>
									<GroupRow>
										<input type="file" accept=".cfe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
										<FieldToggle name="ex_safe" label={translate("onecExtSafeMode")} value={form.safeMode}
											onChange={(v) => setForm((f) => ({ ...f, safeMode: v }))} />
									</GroupRow>
								</GroupCol>
							</div>

							<div className={styles.SecHead}>{translate("onecTabBases")}</div>
							<Table {...buildStaticTableProps({
								componentName: "OneCAdmin_extBases", rows: baseView.rows, columns: baseCols,
								setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
								isLoading: bases.isLoading || check.checking,
								// «Обновить» = прочитать расширения отмеченных баз у самой 1С;
								// ничего не отмечено — перечитать список баз.
								onReload: () => {
									if (pickedBases.length) void check.run(pickedBases);
									else void bases.refetch();
								},
								reloadTitle: translate("onecExtCheck"),
								selectable: true,
								onSelectionChange: (sel, all) =>
									setPickedBases(all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey))),
								extraButtons: (
									<>
										<Button variant="primary" disabled={!missing.length}
											title={missing.length ? undefined : translate("onecExtAlreadyEverywhere")}
											onClick={() => setDialog("install")}>
											<Icon name="download" /> {translate("onecExtInstall")}
										</Button>
										<Button variant="danger" disabled={!present.length}
											onClick={() => setDialog("remove")}>
											<Icon name="trash" /> {translate("onecExtRemove")}
										</Button>
									</>
								),
							})} />

							<div className={styles.SecHead}>{translate("onecWhatHappens")}</div>
							<div className={styles.SecBody}>
								{!pickedBases.length && <Notice items={[{ type: "info", text: translate("onecPickBasesFirst") }]} />}
								{pickedBases.length > 0 && (
									<>
										<div className={styles.PlanRow}>
											<span className={styles.PlanBase}>{translate("onecExtInstall")}</span>
											<span className={styles.PlanAdd}>{missing.length ? missing.join(", ") : translate("onecNoChanges")}</span>
										</div>
										<div className={styles.PlanRow}>
											<span className={styles.PlanBase}>{translate("onecExtRemove")}</span>
											<span className={styles.PlanDel}>{present.length ? present.join(", ") : translate("onecNoChanges")}</span>
										</div>
									</>
								)}
								{currentRow && (
									<span className={styles.Hint}>
										{translate("onecDataFrom")}: {getFormatDate(new Date().toISOString())}
									</span>
								)}
							</div>
						</>
					)}
				</div>
			</div>

			{dialog && (
				<Modal
					title={dialog === "install" ? translate("onecExtInstall") : translate("onecExtRemove")}
					onClose={() => setDialog(null)}
					onApply={() => void apply()}
				>
					<div className={styles.ModalForm}>
						{!current && dialog === "install" && (
							<Field name="ex_new" label={translate("onecExtName")} value={form.name} noAutofill
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} />
						)}
						<div>{translate("onecExtName")}: {current || form.name}</div>
						<div>{translate("onecBatchTargets")}: {dialog === "install" ? (missing.length || pickedBases.length) : present.length}</div>
						<div className={styles.ConfirmWarning}>
							{dialog === "install" ? translate("onecExtInstallWarning") : translate("onecExtRemoveWarning")}
						</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default ExtensionsTab;
