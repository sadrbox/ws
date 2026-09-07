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
import { asText } from "src/utils/asText";
import { fetchBaseExtensions, fetchExtensionSummary, runBatch, type BatchType } from "src/services/onec/api";
import ElementCard from "./ElementCard";
import { useOpenElement } from "./ElementForm";
import { CapabilityGuard, QueryError, VSplit, checkBases, useBaseTargets, useCheckParallel } from "./shared";
import styles from "./OneCAdmin.module.scss";


const summaryColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "230px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "synonym", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "basesCount", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "versions", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
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
	// Отбор целей раскатки: имя расширения + «только те, где его нет». Иначе базы без
	// расширения пришлось бы выискивать глазами среди сотни строк.
		const [onlyMissing, setOnlyMissing] = useState(false);
	/** Выбранное расширение — справа показываются базы, где оно стоит. */
	const [pickedExt, setPickedExt] = useState("");
	const [pickedSynonym, setPickedSynonym] = useState("");
	/** Карточка расширения: реквизиты + базы, куда его поставить. */
	const [card, setCard] = useState(false);
	const openElement = useOpenElement("extension");

	const summary = useQuery({ queryKey: ["onec", "ext-summary"], queryFn: fetchExtensionSummary });
	const [sumCols, setSumCols] = useState<TColumn[]>(() => getModelColumns(summaryColumns(), "OneCAdmin_extSummary"));
	// Публикация переехала в командную панель списка баз: там выбирают базы, а не расширения.
	const [dialog, setDialog] = useState<null | "install" | "remove">(null);
	const [extName, setExtName] = useState("");
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);

	const baseExt = useQuery({
		queryKey: ["onec", "base-ext", openedBase],
		queryFn: () => fetchBaseExtensions(openedBase),
		enabled: !!openedBase,
		staleTime: 0,
	});

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
		await qc.invalidateQueries({ queryKey: ["onec", "bases"] });
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${keys.length}. ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}`,
			r.failed.length ? "warning" : "success",
		);
	}, [qc, parallel]);

	const summaryRows = (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: `${x.name}|${x.synonym}`, name: x.name,
		synonym: x.synonym || "—", basesCount: x.bases,
		versions: x.versions.length ? x.versions.join(", ") : "—",
	}));
	const sumView = useStaticTableView(summaryRows, { name: "asc" });

	const missingFilter = useCallback((b: { extensionNames: string[]; extensionsCount: number | null }) => {
		// Выбрано расширение слева — справа только базы, где оно стоит.
		// Отбор идёт по расширению, ВЫБРАННОМУ в сводке слева: своё поле ввода здесь было
		// вторым поиском рядом со штатным (у таблицы он свой, в командной панели) — и
		// требовало набирать руками то, что уже выбрано щелчком.
		if (!pickedExt) return true;
		const has = b.extensionNames.some((n) => n.toLowerCase() === pickedExt.toLowerCase());
		if (!onlyMissing) return has;
		// Базу, которую ещё не проверяли, в «где нет» не берём: мы про неё не знаем.
		if (b.extensionsCount == null) return false;
		return !has;
	}, [onlyMissing, pickedExt]);

	const targets = useBaseTargets({
		componentName: "OneCAdmin_extTargets",
		onOpenBase: setOpenedBase,
		filter: missingFilter,
		// Расширение ставится внутрь базы: пропавшая база команду не примет.
		applicableFor: "ib",
		extraButtons: (selected) => (
			<>
				<Button variant="secondary" active={onlyMissing} disabled={!pickedExt}
					title={pickedExt ? pickedExt : translate("onecExtPickFirst")}
					onClick={() => setOnlyMissing((v) => !v)}>
					{translate("onecExtOnlyMissing")}
				</Button>
				<Button variant="secondary" disabled={!selected.length || checking}
					onClick={() => void checkSelected(selected)}>
					{translate("onecExtCheck")}
				</Button>
				<Button variant="secondary" disabled={!selected.length}
					onClick={() => { setExtName(""); setFile(null); setSafeMode(true); setDialog("install"); }}>
					{translate("onecExtInstall")}
				</Button>
				<Button variant="secondary" disabled={!selected.length} onClick={() => { setExtName(""); setDialog("remove"); }}>
					{translate("onecExtRemove")}
				</Button>
			</>
		),
	});


	const baseRows = (baseExt.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name,
		version: x.version ?? "—", purpose: x.purpose ?? "—",
		safeMode: x.safeMode == null ? "—" : x.safeMode ? translate("yes") : translate("no"),
	}));
	const baseSorted = useStaticTableView(baseRows, { name: "asc" });

	const apply = useCallback(async () => {
		const keys = targets.selectedKeys;
		if (!keys.length) return;
		if (!extName.trim()) return;
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
			<VSplit
				storageKey="extensions"
				main={
					<>
						<QueryError error={summary.error} />
						{/* Группировка по паре имя+синоним: служебное имя (EF_00_…) без синонима
						    ничего не говорит, а одно и то же имя в разных базах может
						    принадлежать разным расширениям. */}
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_extSummary", rows: sumView.rows, columns: sumCols,
							setColumns: setSumCols, sorting: sumView.sorting, search: sumView.search,
							isLoading: summary.isLoading,
							onReload: () => void summary.refetch(),
							// Двойной щелчок — форма расширения (общий жест списков); отбор баз
							// по выбранному расширению остаётся его же побочным действием.
							onRowClick: (row) => {
								setPickedExt(asText(row.name));
								setPickedSynonym(asText(row.synonym));
								openElement(row);
							},
							extraButtons: (
								<>
									{/* Карточка расширения: реквизиты + базы, куда его поставить, в одном окне. */}
									<Button variant="secondary" onClick={() => setCard(true)}>{translate("onecOpenCard")}</Button>
									{pickedExt && (
										<Button variant="secondary" onClick={() => setPickedExt("")}>{translate("onecExtAllBases")}</Button>
									)}
								</>
							),
						})} />
					</>
				}
				side={openedBase ? (
					<>
						<QueryError error={baseExt.error} />
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_baseExt", rows: baseSorted.rows, columns: baseColumns,
							setColumns: setBaseColumns, sorting: baseSorted.sorting, search: baseSorted.search,
							// Двойной щелчок по расширению ЭТОЙ базы — его форма с отмеченной базой.
							onRowClick: (row) => openElement(row, openedBase),
							isLoading: baseExt.isLoading || baseExt.isFetching,
							onReload: () => void baseExt.refetch(),
							extraButtons: <Button variant="secondary" onClick={() => setOpenedBase("")}>{translate("onecBackToSummary")}</Button>,
						})} />
					</>
				) : targets.table}
			/>

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
			{card && (
				<ElementCard
					kind="extension"
					initialName={pickedExt}
					initialSynonym={pickedSynonym}
					// Базы, где расширение уже стоит, — из кэша имён расширений базы.
					presentIn={targets.bases
						.filter((b) => pickedExt && b.extensionNames.some((n) => n.toLowerCase() === pickedExt.toLowerCase()))
						.map((b) => b.key)}
					onClose={() => setCard(false)}
					onBatchStarted={onBatchStarted}
				/>
			)}
		</>
	);
};

export default ExtensionsTab;
