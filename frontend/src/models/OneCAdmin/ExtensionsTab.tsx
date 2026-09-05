/**
 * Вкладка «Расширения» (E15/A3-P1 + A4): что стоит в базах и групповая установка/удаление.
 *
 * ПОЧЕМУ ГРУППОВО. Раскатить расширение на сто клиентских баз поштучно нельзя: это
 * задача A7 в чистом виде. Поэтому цель операции — ОТМЕЧЕННЫЕ базы в верхней таблице,
 * а не «текущая»: выбор ста баз мышью один раз дешевле ста заходов в карточку.
 *
 * Файл .cfe уходит в команду телом (base64): агент не ходит за ним в сеть, у него нет
 * доступа ни к нашему хранилищу, ни к интернету.
 */
import { FC, useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { showToast } from "src/components/UIToast";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchBaseExtensions, fetchExtensionSummary, runBatch, type BatchType } from "src/services/onec/api";
import { CapabilityGuard, QueryError, SectionTitle, checkBases, useBaseTargets, useCheckParallel } from "./shared";
import styles from "./OneCAdmin.module.scss";

const summaryColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "300px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
	{ identifier: "basesCount", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "versions", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const baseExtColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "280px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "version", type: "string", width: "130px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "purpose", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "safeMode", type: "string", width: "140px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Файл → base64 без префикса data:. Читаем в браузере: сервис файлы не хранит. */
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
	const r = new FileReader();
	r.onload = () => resolve(typeof r.result === "string" ? r.result.replace(/^data:[^;]*;base64,/, "") : "");
	r.onerror = () => reject(new Error(translate("onecExtReadFailed")));
	r.readAsDataURL(file);
});

export const ExtensionsTab: FC<{ onBatchStarted: (id: string) => void }> = ({ onBatchStarted }) => {
	const qc = useQueryClient();
	const [openedBase, setOpenedBase] = useState<string>("");
	const [checking, setChecking] = useState(false);
	const parallel = useCheckParallel();
	const [dialog, setDialog] = useState<null | "install" | "remove">(null);
	const [extName, setExtName] = useState("");
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);

	const summary = useQuery({ queryKey: ["onec", "ext-summary"], queryFn: fetchExtensionSummary });
	const baseExt = useQuery({
		queryKey: ["onec", "base-ext", openedBase],
		queryFn: () => fetchBaseExtensions(openedBase),
		enabled: !!openedBase,
		staleTime: 0,
	});

	const [sumColumns, setSumColumns] = useState<TColumn[]>(() => getModelColumns(summaryColumns(), "OneCAdmin_extSummary"));
	const [baseColumns, setBaseColumns] = useState<TColumn[]>(() => getModelColumns(baseExtColumns(), "OneCAdmin_baseExt"));

	const batch = useMutation({
		mutationFn: (p: { type: BatchType; keys: string[]; payload: Record<string, unknown> }) =>
			runBatch(p.type, p.keys, p.payload),
		onSuccess: (d) => {
			setDialog(null);
			// Пропущенные базы называем сразу: молча «поставлено 3 из 100» — худший исход.
			const skipped = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${skipped}`, d.skipped.length ? "warning" : "success");
			onBatchStarted(d.batchId);
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	/**
	 * Прочитать расширения выбранных баз — ПРЯМЫМИ запросами, без задания: это чтение,
	 * результат виден сразу в сводке, хранить его отдельной сущностью незачем.
	 */
	const checkSelected = useCallback(async (keys: string[]) => {
		setChecking(true);
		const r = await checkBases(keys, fetchBaseExtensions, parallel);
		setChecking(false);
		// Сводка и счётчики в «Базах» считаются по кэшу, который только что пополнился.
		await qc.invalidateQueries({ queryKey: ["onec", "ext-summary"] });
		await qc.invalidateQueries({ queryKey: ["onec", "bases"] });
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${keys.length}. ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}`,
			r.failed.length ? "warning" : "success",
		);
	}, [qc, parallel]);

	const targets = useBaseTargets({
		componentName: "OneCAdmin_extTargets",
		onOpenBase: setOpenedBase,
		extraButtons: (selected) => (
			<>
				<Button size="sm" disabled={!selected.length || checking}
					onClick={() => void checkSelected(selected)}>
					{translate("onecExtCheck")}
				</Button>
				<Button size="sm" disabled={!selected.length}
					onClick={() => { setExtName(""); setFile(null); setSafeMode(true); setDialog("install"); }}>
					{translate("onecExtInstall")}
				</Button>
				<Button size="sm" disabled={!selected.length} onClick={() => { setExtName(""); setDialog("remove"); }}>
					{translate("onecExtRemove")}
				</Button>
			</>
		),
	});

	const summaryRows = (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, basesCount: x.bases,
		versions: x.versions.length ? x.versions.join(", ") : "—",
	}));
	const sumSorted = useStaticTableView(summaryRows, { name: "asc" });

	const baseRows = (baseExt.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name,
		version: x.version ?? "—", purpose: x.purpose ?? "—",
		safeMode: x.safeMode == null ? "—" : x.safeMode ? translate("yes") : translate("no"),
	}));
	const baseSorted = useStaticTableView(baseRows, { name: "asc" });

	const apply = useCallback(async () => {
		const keys = targets.selectedKeys;
		if (!keys.length || !extName.trim()) return;
		if (dialog === "remove") {
			batch.mutate({ type: "IB_DELETE_EXTENSION", keys, payload: { name: extName.trim() } });
			return;
		}
		if (!file) { showToast(translate("onecExtFileRequired"), "error"); return; }
		batch.mutate({
			type: "IB_INSTALL_EXTENSION", keys,
			payload: { name: extName.trim(), safeMode, contentBase64: await toBase64(file) },
		});
	}, [batch, dialog, extName, file, safeMode, targets.selectedKeys]);

	return (
		<>
			<CapabilityGuard capability="ib.admin" />
			<SectionTitle>{translate("onecExtTargetsHint")}</SectionTitle>
			{targets.table}

			<SectionTitle>
				{openedBase ? `${translate("onecExtOfBase")}: ${openedBase}` : translate("onecExtSummary")}
			</SectionTitle>
			<QueryError error={openedBase ? baseExt.error : summary.error} />

			{openedBase ? (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_baseExt", rows: baseSorted.rows, columns: baseColumns,
					setColumns: setBaseColumns, sorting: baseSorted.sorting, search: baseSorted.search,
					isLoading: baseExt.isLoading || baseExt.isFetching,
					onReload: () => void baseExt.refetch(),
					extraButtons: <Button size="sm" onClick={() => setOpenedBase("")}>{translate("onecBackToSummary")}</Button>,
				})} />
			) : (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_extSummary", rows: sumSorted.rows, columns: sumColumns,
					setColumns: setSumColumns, sorting: sumSorted.sorting, search: sumSorted.search,
					isLoading: summary.isLoading, onReload: () => void summary.refetch(),
				})} />
			)}

			{dialog && (
				<Modal
					title={dialog === "install" ? translate("onecExtInstall") : translate("onecExtRemove")}
					onClose={() => setDialog(null)}
					onApply={() => void apply()}
				>
					<div className={styles.ModalForm}>
						<div>{translate("onecBatchTargets")}: {targets.selectedKeys.length}</div>
						<Field name="onec_ext_name" label={translate("onecExtName")} value={extName}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExtName(e.target.value)} />
						{dialog === "install" && (
							<>
								<input type="file" accept=".cfe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
								<FieldToggle name="onec_ext_safe" label={translate("onecExtSafeMode")}
									value={safeMode} onChange={setSafeMode} />
							</>
						)}
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
