/**
 * «Панель главбуха» (E17 СК4.1, п. 29 стандарта): клиенты групп × участки учёта.
 *
 * Главбух обязан видеть состояние сверок, задолженности, банка, документов, налогов, ТМЗ, ОС,
 * поручений клиентов и сроков по своей группе. Светофор строит сервер по находкам проверок
 * учёта и задачам (quality/dashboard/chief); щелчок по участку открывает находки клиента,
 * по первичке — окно отметок о получении. Ниже — консультации на проверку (СК7.3).
 * Нарушение по п. 29 панель не заводит: она даёт видимость, факт фиксирует человек.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import Toolbar from "src/components/Toolbar";
import Notice, { type NoticeItem } from "src/components/Notice";
import { FieldSelect } from "src/components/Field";
import { getModelColumns } from "src/components/Table/services";
import { useAppContext } from "src/app/context";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { useQualityMe } from "src/hooks/useQualityMe";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { openFormByEndpoint } from "src/registry/formRegistry";
import { fetchChiefDashboard, type ChiefClientRow } from "src/services/quality/api";
import { QUALITY_AREAS, type QualityArea } from "src/services/quality/checkCatalog";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { withStableIds } from "src/utils/stableRowId";
import { getFormatDate, getFormatDateOnly } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { cx } from "src/utils/cx";
import { translate } from "src/i18";
import { openFindingsPane } from "src/models/CheckFindings/openFindings";
import { fillTemplate } from "src/models/_quality/text";
import { PrimaryDocsModal } from "./PrimaryDocsModal";
import {
	TONE_KEYS, areaColumnId, areaCounts, areaTitle, areaTone, chiefSummary, primaryDocsTone, runStatusCounts, runStatusView,
	toChiefTableRows, type DotTone,
} from "./areaView";
import matrixColumnsJson from "./matrixColumns.json";
import consultationsColumnsJson from "./consultationsColumns.json";
import main from "src/styles/main.module.scss";
import styles from "./QualityChiefDashboard.module.scss";

const MATRIX = "QualityChiefMatrix";
const CONSULTATIONS = "QualityChiefConsultations";
const TONES: DotTone[] = ["red", "yellow", "green", "grey"];

/** Колонка участка по идентификатору (идентификатор — ключ подписи участка). */
const AREA_BY_COLUMN = new Map<string, QualityArea>(QUALITY_AREAS.map((a) => [areaColumnId(a), a]));

const Dot: FC<{ tone: DotTone }> = ({ tone }) => <span className={cx(styles.Dot, styles[tone])} aria-hidden />;

export const QualityChiefDashboard: FC<Partial<TPane>> = ({ uniqId }) => {
	const { addPane } = useAppContext().windows;
	const { me, isController, isLoading: meLoading } = useQualityMe();
	const [groupUuid, setGroupUuid] = useState("");
	const [primaryFor, setPrimaryFor] = useState<ChiefClientRow | null>(null);

	const q = useQuery({
		queryKey: ["quality", "dashboard", "chief", groupUuid],
		queryFn: () => fetchChiefDashboard(groupUuid || undefined),
		enabled: isController,
	});
	const clients = useMemo(() => q.data?.clients ?? [], [q.data]);
	const summary = useMemo(() => chiefSummary(clients), [clients]);
	const runCounts = useMemo(() => runStatusCounts(clients), [clients]);

	const [matrixCols, setMatrixCols] = useState<TColumn[]>(() => getModelColumns(matrixColumnsJson as TColumn[], MATRIX));
	// Порядок по умолчанию — как у сервера: группа, затем клиент. Щелчок по заголовку участка
	// сортирует «сначала проблемные» (значение колонки — ключ тяжести, areaSortValue).
	const matrix = useStaticTableView(useMemo(() => toChiefTableRows(clients), [clients]));

	const orgNames = useMemo(() => new Map(clients.map((c) => [c.organizationUuid, c.name])), [clients]);
	const [consultCols, setConsultCols] = useState<TColumn[]>(() => getModelColumns(consultationsColumnsJson as TColumn[], CONSULTATIONS));
	const consultRows = useMemo(() => withStableIds((q.data?.consultations ?? []).map((c) => ({
		uuid: c.uuid,
		consultCompletedAt: c.completedAt,
		consultClient: orgNames.get(c.organizationUuid) ?? "",
		consultTask: c.name || (c.result ?? "").slice(0, 120),
		executorName: c.executorName ?? "",
		consultRating: c.clientRating,
		consultReasons: (c.reasons ?? []).join("; "),
	})), (r) => r.uuid), [q.data, orgNames]);
	const consult = useStaticTableView(consultRows, { consultCompletedAt: "desc" });

	const openArea = useCallback((row: ChiefClientRow, area: QualityArea) => {
		openFindingsPane(addPane, { organizationUuid: row.organizationUuid, organizationName: row.name, area, state: "open" });
	}, [addPane]);

	const renderMatrixCell = useCallback((row: TDataItem, col: TColumn) => {
		const src = row.source as ChiefClientRow | undefined;
		if (!src) return undefined;
		const area = AREA_BY_COLUMN.get(col.identifier);
		if (area) {
			const cell = src.areas?.[area];
			const { main: counts, overdue } = areaCounts(cell);
			let title = areaTitle(area, cell);
			if (area === "taxes" && src.kn) {
				title += `\n${translate("chiefDashKn")}: ${getFormatDateOnly(src.kn.onDate)} · ${translate("mismatches")}: ${src.kn.mismatches ?? "—"}`;
			}
			return (
				<button type="button" className={styles.Cell} title={title} onClick={() => openArea(src, area)}>
					<Dot tone={areaTone(cell?.state)} />
					{counts && <span>{counts}</span>}
					{overdue > 0 && <span className={styles.Overdue}>{overdue}</span>}
				</button>
			);
		}
		switch (col.identifier) {
			case "chiefRequests": {
				const r = src.requests;
				const title = `${translate("chiefDashRequestsOpen")}: ${r?.open ?? 0}\n${translate("chiefDashRequestsUnaccepted")}: ${r?.unaccepted ?? 0}\n${translate("chiefDashRequestsOverdue")}: ${r?.overdueReaction ?? 0}`;
				return (
					<span className={cx(styles.Cell, styles.CellStatic)} title={title}>
						<Dot tone={areaTone(r?.state)} />
						<span>{`${r?.open ?? 0}/${r?.unaccepted ?? 0}`}</span>
						{(r?.overdueReaction ?? 0) > 0 && <span className={styles.Overdue}>{r?.overdueReaction}</span>}
					</span>
				);
			}
			case "chiefDeadlines": {
				const dl = src.deadlines;
				const title = `${translate("chiefDashOverdue")}: ${dl?.overdue ?? 0}\n${translate("chiefDashOpenTasks")}: ${dl?.open ?? 0}`;
				return (
					<span className={cx(styles.Cell, styles.CellStatic)} title={title}>
						<Dot tone={areaTone(dl?.state)} />
						{(dl?.overdue ?? 0) > 0 ? <span className={styles.Overdue}>{dl?.overdue}</span> : <span className={styles.Muted}>{dl?.open ?? 0}</span>}
					</span>
				);
			}
			case "chiefPrimaryDocs": {
				const p = src.primaryDocs;
				const label = !p?.received ? translate("chiefDashPrimaryNone") : p.complete ? translate("primaryDocsComplete") : translate("primaryDocsPartial");
				return (
					<button type="button" className={styles.Cell} title={translate("chiefDashPrimaryHint")} onClick={() => setPrimaryFor(src)}>
						<Dot tone={primaryDocsTone(p)} />
						<span>{label}</span>
					</button>
				);
			}
			case "chiefLastRun": {
				const v = runStatusView(src.runStatus, src.lastRunAt);
				const when = src.lastRunAt ? getFormatDate(src.lastRunAt) : "";
				const title = [translate(v.labelKey), when ? `${translate("chiefDashRunLastOk")}: ${when}` : null, v.detail || null].filter(Boolean).join("\n");
				return (
					<span className={cx(styles.Cell, styles.CellStatic)} title={title}>
						<Dot tone={v.tone} />
						{v.tone === "green" ? <span>{when}</span> : <span className={v.tone === "red" ? styles.Overdue : styles.Muted}>{translate(v.labelKey)}</span>}
					</span>
				);
			}
			default:
				return undefined;
		}
	}, [openArea]);

	const groups = me?.groups ?? [];
	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar className={main.PaneToolbarFill}>
			<FieldSelect name="chief_dashboard_group" size="sm" value={groupUuid} onChange={(e) => setGroupUuid(e.target.value)}
				options={[{ value: "", label: translate("chiefDashAllGroups") }, ...groups.map((g) => ({ value: g.uuid, label: g.name }))]} />
			<Toolbar.Divider />
			<Toolbar.ReloadButton onClick={() => void q.refetch()} disabled={q.isFetching || !isController} />
		</Toolbar>
	));

	if (!meLoading && !isController) {
		return (
			<>
				{paneToolbar}
				<div className={main.PaneFill}>
					<Notice inline items={[{ type: "info", text: translate("chiefDashOnlyControllers") }]} />
				</div>
			</>
		);
	}

	return (
		<>
			{paneToolbar}
			<Notice items={[
				{ type: "info", text: translate("chiefDashInfo") },
				...(runCounts.failed ? [{ type: "warning", text: fillTemplate(translate("chiefDashRunsFailed"), { count: runCounts.failed }) } satisfies NoticeItem] : []),
				...(runCounts.access ? [{ type: "warning", text: fillTemplate(translate("chiefDashRunsAccess"), { count: runCounts.access }) } satisfies NoticeItem] : []),
				...(runCounts.unavailable ? [{ type: "info", text: fillTemplate(translate("chiefDashRunsUnavailable"), { count: runCounts.unavailable }) } satisfies NoticeItem] : []),
			]} />
			<div className={main.PaneFill}>
				<div className={styles.Body}>
					<div className={styles.Legend}>
						<span className={styles.Summary}>
							{`${translate("chiefDashClients")}: ${summary.clients} · ${translate("chiefDashWithRed")}: ${summary.red} · ${translate("chiefDashWithYellow")}: ${summary.yellow}`}
						</span>
						{TONES.map((t) => (
							<span key={t} className={styles.LegendItem}><Dot tone={t} />{translate(TONE_KEYS[t])}</span>
						))}
						<span className={styles.LegendItem}>{translate("chiefDashCountsLegend")}</span>
					</div>
					<div className={styles.Matrix}>
						<Table {...buildStaticTableProps({
							componentName: MATRIX, rows: matrix.rows, columns: matrixCols, setColumns: setMatrixCols,
							sorting: matrix.sorting, search: matrix.search,
							isLoading: q.isLoading, reloading: q.isFetching && !q.isLoading, onReload: () => void q.refetch(),
							emptyText: translate("chiefDashNoClients"), renderCell: renderMatrixCell, fitHeight: true,
							// Двойной щелчок по строке — все открытые находки клиента, без отбора по участку.
							onRowClick: (row) => {
								const src = row.source as ChiefClientRow | undefined;
								if (src) openFindingsPane(addPane, { organizationUuid: src.organizationUuid, organizationName: src.name, state: "open" });
							},
						})} />
					</div>
					<div className={styles.Consultations}>
						<h4 className={styles.SectionTitle}>{translate("chiefDashConsultations")}</h4>
						<Table {...buildStaticTableProps({
							componentName: CONSULTATIONS, rows: consult.rows, columns: consultCols, setColumns: setConsultCols,
							sorting: consult.sorting, search: consult.search, isLoading: q.isLoading,
							emptyText: translate("chiefDashNoConsultations"), fitHeight: true, wrapCells: true,
							onRowClick: (row) => { if (row.uuid) void openFormByEndpoint("todos", asText(row.uuid), addPane); },
						})} />
					</div>
				</div>
			</div>
			{primaryFor && (
				<PrimaryDocsModal organizationUuid={primaryFor.organizationUuid} organizationName={primaryFor.name} onClose={() => setPrimaryFor(null)} />
			)}
		</>
	);
};
QualityChiefDashboard.displayName = "QualityChiefDashboard";
