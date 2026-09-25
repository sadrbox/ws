/**
 * «Итоги месяца» — бонус за соблюдение стандарта качества (E17 СК5.5).
 *
 * ПРАВИЛО. Один подтверждённый факт нарушения — бонус за месяц не начисляется полностью;
 * нарушение учитывается в месяце ВЫЯВЛЕНИЯ; самовыявленная и своевременно исправленная ошибка
 * нарушением не считается. Систематичность (N подтверждённых за скользящие M месяцев) — уже
 * вопрос соответствия должности; «мер нет» — нарушения повторяются, а мера руководителя не
 * записана (п. 30).
 *
 * МЕСЯЦ ЗАКРЫВАЕТСЯ: сервер снимает снимок итогов по всем сотрудникам фирмы, после этого записи
 * месяца не меняются, а новые выявления идут в текущий месяц. Закрывают администратор и
 * руководитель; открыть закрытый месяц может только администратор. Нерешённые кандидаты и
 * возражения сервер без подтверждения не пропустит — тогда спрашиваем, закрыть ли всё равно.
 *
 * Кто что видит — решает сервер: сотрудник — себя, главбух — свою группу, руководитель — всех.
 */
import { type FC, type ReactNode, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate, getLanguage } from "src/i18";
import { useAppContext } from "src/app/context";
import Table from "src/components/Table";
import Toolbar from "src/components/Toolbar";
import { FieldFastSearchInternal } from "src/components/Table/TableToolbarControls";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldPeriod } from "src/components/Field";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import Notice, { type NoticeItem } from "src/components/Notice";
import { showToast } from "src/components/UIToast";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { useQualityMe } from "src/hooks/useQualityMe";
import { routeError } from "src/services/errors/route";
import { getAppUtcOffset, getFormatDate, getFormatDateOnly } from "src/utils/datetime";
import { closeBonusMonth, fetchBonus, reopenBonusMonth } from "src/services/quality/api";
import QualityChip from "src/models/_quality/QualityChip";
import RecordLink from "src/models/_quality/RecordLink";
import { currentMonth, monthLabel } from "src/models/_quality/month";
import { escapeHtml, fillTemplate } from "src/models/_quality/text";
import { itemCaption } from "src/models/StandardViolations/violations";
import MeasuresModal from "./MeasuresModal";
import { bonusExportAoa, bonusExportFileName, bonusRows, needsConfirmation, roleLabel, violationsSummary, type BonusTableRow } from "./bonus";
import main from "src/styles/main.module.scss";
import styles from "./QualityBonus.module.scss";

const COMPONENT = "QualityBonusView";

const COLUMNS: TColumn[] = [
	{ identifier: "userName", type: "string", width: "210px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "groupName", type: "string", width: "170px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "bonus", type: "string", width: "120px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "confirmedCount", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "violations", type: "string", width: "220px", minWidth: "120px", alignment: "left", sortable: false, visible: true, inlist: true },
	{ identifier: "pendingCandidates", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "disputed", type: "number", width: "100px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "systematic", type: "string", width: "150px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "noMeasure", type: "string", width: "120px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "measures", type: "string", width: "110px", minWidth: "90px", alignment: "left", sortable: false, visible: true, inlist: true },
];

export const QualityBonusView: FC<{ uniqId?: string }> = ({ uniqId }) => {
	const queryClient = useQueryClient();
	const { actions: { confirm }, auth } = useAppContext();
	const myUuid = auth.user?.uuid ?? "";
	const { me, canManage } = useQualityMe();
	const isAdmin = !!me?.isAdmin;
	const canMeasure = !!me?.canDecide;
	const [month, setMonth] = useState(() => currentMonth(getAppUtcOffset() * 60));
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, COMPONENT));
	const [showSearch, setShowSearch] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [measuresFor, setMeasuresFor] = useState<BonusTableRow | null>(null);
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);

	const q = useQuery({
		queryKey: ["quality", "bonus", month],
		queryFn: () => fetchBonus(month),
		staleTime: 30_000,
	});
	const data = q.data;
	const rows = useMemo(() => bonusRows(data?.items), [data]);
	// Порядок — серверный (без бонуса первыми, затем по числу нарушений): своей сортировки по умолчанию нет.
	const view = useStaticTableView(rows as unknown as TDataItem[]);
	const closed = data?.closed ?? null;
	const label = monthLabel(month, getLanguage());

	const toggle = useCallback((uuid: string) => setExpanded((prev) => {
		const next = new Set(prev);
		if (!next.delete(uuid)) next.add(uuid);
		return next;
	}), []);

	const afterChange = useCallback(async () => {
		// Закрытие и открытие месяца меняют и итоги, и то, можно ли править записи реестра.
		await queryClient.invalidateQueries({ queryKey: ["quality", "bonus"] });
		void queryClient.invalidateQueries({ queryKey: ["standard-violations"] });
	}, [queryClient]);

	const closeMonth = useCallback(async () => {
		if (!(await confirm(escapeHtml(fillTemplate(translate("bonusCloseAsk"), { month: label }))))) return;
		setBusy(true);
		setNotices([]);
		try {
			try {
				await closeBonusMonth(month);
			} catch (e) {
				const pending = needsConfirmation(e);
				if (pending == null) throw e;
				// Нерешённые кандидаты и возражения: закрыть можно, но это осознанное решение.
				if (!(await confirm(escapeHtml(fillTemplate(translate("bonusCloseForceAsk"), { n: pending }))))) return;
				await closeBonusMonth(month, true);
			}
			showToast(fillTemplate(translate("bonusClosedDone"), { month: label }), "success");
			await afterChange();
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT), fallback: translate("bonusCloseFailed") }));
		} finally {
			setBusy(false);
		}
	}, [confirm, label, month, afterChange]);

	const reopenMonth = useCallback(async () => {
		if (!(await confirm(escapeHtml(fillTemplate(translate("bonusReopenAsk"), { month: label }))))) return;
		setBusy(true);
		setNotices([]);
		try {
			await reopenBonusMonth(month);
			showToast(fillTemplate(translate("bonusReopenedDone"), { month: label }), "success");
			await afterChange();
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT), fallback: translate("bonusReopenFailed") }));
		} finally {
			setBusy(false);
		}
	}, [confirm, label, month, afterChange]);

	// Выгрузка для расчёта зарплаты. Библиотека книг тяжёлая — грузим её только по кнопке.
	const exportXlsx = useCallback(async () => {
		if (!data?.items?.length) return;
		try {
			const { downloadAoa } = await import("src/utils/sheetIO");
			downloadAoa(bonusExportAoa(data), { sheetName: month, fileName: bonusExportFileName(month, !!data.closed) });
			if (!data.closed) showToast(fillTemplate(translate("bonusExportPreliminary"), { month: label }), "info");
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT), fallback: translate("bonusExportFailed") }));
		}
	}, [data, month, label]);

	const renderCell = useCallback((row: TDataItem, col: TColumn): ReactNode | undefined => {
		const r = row as unknown as BonusTableRow;
		switch (col.identifier) {
			case "userName": {
				const role = roleLabel(r.role);
				return <span title={role || undefined}>{r.userName}{role && <span className={styles.Role}> · {role}</span>}</span>;
			}
			case "groupName":
				return <span>{r.groupName ?? "—"}</span>;
			case "bonus":
				return <QualityChip tone={r.bonus ? "ok" : "bad"}>{translate(r.bonus ? "bonusYes" : "bonusNo")}</QualityChip>;
			case "violations": {
				if (!r.violations?.length) return <span className={main.Muted}>—</span>;
				const open = expanded.has(r.uuid);
				return (
					<button type="button" className={styles.ExpandButton} aria-expanded={open}
						title={translate(open ? "bonusHideViolations" : "bonusShowViolations")}
						onMouseDown={(e) => e.stopPropagation()}
						onClick={(e) => { e.stopPropagation(); toggle(r.uuid); }}>
						<span>{violationsSummary(r.violations)}</span>
						<Icon name="caretDown" className={open ? styles.CaretOpen : styles.Caret} />
					</button>
				);
			}
			case "systematic":
				return r.systematic
					? <QualityChip tone="bad" title={fillTemplate(translate("bonusSystematicTitle"), { n: r.windowCount, m: data?.systematicMonths ?? "" })}>
						{translate("bonusSystematicYes")}
					</QualityChip>
					: <span className={main.Muted}>{r.windowCount ? String(r.windowCount) : "—"}</span>;
			case "noMeasure":
				return r.noMeasure ? <QualityChip tone="warn">{translate("bonusNoMeasureYes")}</QualityChip> : <span className={main.Muted}>—</span>;
			case "measures":
				// О себе не решает никто: меру себе не назначают (сервер откажет так же).
				return canMeasure && r.userUuid !== myUuid ? (
					<Button size="sm" onMouseDown={(e) => e.stopPropagation()}
						onClick={() => setMeasuresFor(r)}>{translate("bonusMeasures")}</Button>
				) : <span className={main.Muted}>—</span>;
			default:
				return undefined;
		}
	}, [expanded, toggle, canMeasure, myUuid, data?.systematicMonths]);

	const renderExpandedRow = useCallback((row: TDataItem) => {
		const r = row as unknown as BonusTableRow;
		return (
			<ul className={styles.Violations}>
				{(r.violations ?? []).map((v) => (
					<li key={v.uuid} className={styles.ViolationItem}>
						<RecordLink endpoint="standard-violations" uuid={v.uuid}>{itemCaption(v.itemNumber)}</RecordLink>
						<span className={styles.ViolationDate}>{getFormatDateOnly(v.detectedAt)}</span>
						<span className={styles.ViolationText}>{v.description}</span>
					</li>
				))}
			</ul>
		);
	}, []);

	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar className={main.PaneToolbarFill}
			right={showSearch ? <FieldFastSearchInternal value={view.search.value} onChange={view.search.onChange} /> : undefined}>
			<FieldPeriod name="quality_bonus_month" value={month} onChange={(e) => { setMonth(e.target.value); setNotices([]); }} />
			{canManage && !closed && (
				<Button onClick={() => void closeMonth()} disabled={busy || q.isLoading} title={translate("bonusCloseHint")}>
					{translate("bonusCloseMonth")}
				</Button>
			)}
			{isAdmin && closed && (
				<Button onClick={() => void reopenMonth()} disabled={busy} title={translate("bonusReopenHint")}>
					{translate("bonusReopenMonth")}
				</Button>
			)}
			<Button icon="download" onClick={() => void exportXlsx()} disabled={!data?.items?.length} title={translate("bonusExportHint")}>
				{translate("bonusExport")}
			</Button>
			{closed && (
				<QualityChip tone="muted">
					{fillTemplate(translate("bonusClosedAt"), { date: getFormatDate(closed.closedAt), by: closed.closedByName ?? "—" })}
				</QualityChip>
			)}
			<Toolbar.Divider />
			<Toolbar.ReloadButton onClick={() => void q.refetch()} disabled={q.isFetching} loading={q.isFetching && !q.isLoading} />
			<Toolbar.SearchButton onClick={() => setShowSearch((v) => !v)} active={showSearch} />
		</Toolbar>
	));

	// Правило и порог систематичности — пояснением к экрану.
	// ПРОВЕРИТЬ ПОТОМ: порог систематичности (N за M месяцев) — предложение разработчика,
	// владелец его не утверждал (план, «Решения владельца», п. 6); меняется в настройках качества.
	const info = useMemo<NoticeItem[]>(() => (data ? [
		{ type: "info", text: fillTemplate(translate("bonusRuleInfo"), { n: data.systematicThreshold, m: data.systematicMonths }) },
		{ type: "info", text: translate("bonusSystematicCheckLater") },
	] : []), [data]);

	const tableProps = buildStaticTableProps({
		componentName: COMPONENT, rows: view.rows, columns, setColumns,
		sorting: view.sorting, search: view.search,
		isLoading: q.isLoading, reloading: q.isFetching && !q.isLoading,
		onReload: () => void q.refetch(), hideToolbar: true,
		emptyText: translate("bonusEmpty"),
		renderCell, expandedRowIds: expanded, renderExpandedRow,
	});

	return (
		<>
			{paneToolbar}
			<div className={main.PaneFill}>
				<Table {...tableProps} />
			</div>
			<Notice items={[...info, ...notices]} />
			{measuresFor && (
				<MeasuresModal userUuid={measuresFor.userUuid} userName={measuresFor.userName} canAdd={canMeasure} isAdmin={isAdmin}
					onClose={() => setMeasuresFor(null)} />
			)}
		</>
	);
};
QualityBonusView.displayName = COMPONENT;

export default QualityBonusView;
