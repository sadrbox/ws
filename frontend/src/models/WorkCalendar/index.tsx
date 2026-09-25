/**
 * Производственный календарь (E17): праздники РК, перенесённые выходные и рабочие дни-переносы.
 *
 * ЗАЧЕМ. Все сроки стандарта сервер считает в рабочем времени фирмы (SLA обращений, отработка находок,
 * проверка исправления), а посещаемость в праздник молчит — и то и другое по этому календарю. Год
 * заполняется сам по закону (праздники и перенос выходного, совпавшего с государственным праздником);
 * переносы по постановлению Правительства и дату Курбан айта вносит администратор.
 *
 * Смотрят все (сроки касаются каждого), правит администратор; сервер проверяет права ещё раз.
 */
import { type FC, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import Tabs from "src/components/Tabs";
import Toolbar from "src/components/Toolbar";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Button } from "src/components/Button";
import { FieldSelect } from "src/components/Field";
import { getModelColumns } from "src/components/Table/services";
import { showToast } from "src/components/UIToast";
import { useAppContext } from "src/app/context";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { useQualityMe } from "src/hooks/useQualityMe";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { routeError } from "src/services/errors/route";
import { deleteWorkCalendarDay, fetchQualitySettings, fetchWorkCalendar, seedWorkCalendar } from "src/services/quality/api";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getAppUtcOffset, getFormatDateOnly } from "src/utils/datetime";
import { cx } from "src/utils/cx";
import { getLanguage, translate } from "src/i18";
import QualityChip from "src/models/_quality/QualityChip";
import { localYmd } from "src/models/_quality/month";
import { fillTemplate } from "src/models/_quality/text";
import { ISO_DAYS, dayLabel, workDaysText } from "src/models/_quality/workWeek";
import { DayModal, type DayDraft } from "./DayModal";
import {
	type CalendarCell, type CalendarEntry, calendarEntries, indexCalendar, kindLabel, lawLabel, lawTone, monthGrid, monthName,
	toCalendarRows, workingDaysInMonth, workingDaysInYear,
} from "./calendarView";
import columnsJson from "./columns.json";
import main from "src/styles/main.module.scss";
import styles from "./WorkCalendar.module.scss";

const COMPONENT = "WorkCalendarView";
const MIN_YEAR = 2020;
const DEFAULT_WEEK = "1,2,3,4,5";

type CalendarTab = "year" | "days";

const KIND_CLASS: Record<string, string> = {
	holiday: styles.Holiday,
	dayoff: styles.Dayoff,
	workday: styles.Workday,
};

export const WorkCalendarView: FC<{ uniqId?: string }> = ({ uniqId }) => {
	const { confirm } = useAppContext().actions;
	const { me } = useQualityMe();
	const isAdmin = !!me?.isAdmin;
	const today = localYmd(getAppUtcOffset() * 60);
	const thisYear = Number(today.slice(0, 4));
	const [year, setYear] = useState(thisYear);
	const [tab, setTab] = useState<CalendarTab>("year");
	const [edit, setEdit] = useState<{ day: DayDraft; existing: boolean } | null>(null);
	const [activeDate, setActiveDate] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const q = useQuery({ queryKey: ["quality", "work-calendar", year], queryFn: () => fetchWorkCalendar(year), retry: false });
	// Рабочая неделя фирмы — из настроек качества (тот же ключ, что у экрана настроек: общий кэш).
	const settingsQ = useQuery({ queryKey: ["quality", "settings"], queryFn: fetchQualitySettings, staleTime: 30_000, retry: false });
	const workDays = settingsQ.data?.settings?.workDays || DEFAULT_WEEK;
	const slaWorkingTime = settingsQ.data?.settings?.slaWorkingTime !== false;

	const items = useMemo(() => q.data?.items ?? [], [q.data]);
	const index = useMemo(() => indexCalendar(items), [items]);
	const entries = useMemo(() => calendarEntries(items, q.data?.byLaw ?? []), [items, q.data?.byLaw]);
	const active: CalendarEntry | null = useMemo(() => entries.find((e) => e.date === activeDate) ?? null, [entries, activeDate]);
	const lang = getLanguage();

	const refresh = useCallback(() => {
		setNotices([]);
		void q.refetch();
	}, [q]);

	const years = useMemo(() => {
		const out: number[] = [];
		for (let y = Math.max(MIN_YEAR, thisYear - 3); y <= thisYear + 2; y++) out.push(y);
		if (!out.includes(year)) out.push(year);
		return out.sort((a, b) => a - b);
	}, [thisYear, year]);

	const openDay = useCallback((cell: CalendarCell) => {
		if (!isAdmin) return;
		const stored = index.get(cell.ymd);
		// Новый день: в выходной — чаще всего рабочий день-перенос, в будний — праздник.
		const kind = stored?.kind ?? (cell.working ? "holiday" : "workday");
		setEdit({ day: { date: cell.ymd, kind, name: stored?.name ?? "" }, existing: !!stored });
	}, [isAdmin, index]);

	const removeDay = useCallback(async () => {
		if (!active?.stored) return;
		if (!(await confirm(fillTemplate(translate("workCalendarDeleteAsk"), { date: getFormatDateOnly(active.date) })))) return;
		setBusy(true);
		setNotices([]);
		try {
			await deleteWorkCalendarDay(active.date);
			showToast(translate("workCalendarDeleted"), "success");
			await q.refetch();
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT) }));
		} finally {
			setBusy(false);
		}
	}, [active, confirm, q]);

	const seed = useCallback(async () => {
		setBusy(true);
		setNotices([]);
		try {
			const r = await seedWorkCalendar(year);
			showToast(r.created
				? fillTemplate(translate("workCalendarSeeded"), { count: r.created })
				: translate("workCalendarSeededNone"), "success");
			await q.refetch();
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT) }));
		} finally {
			setBusy(false);
		}
	}, [year, q]);

	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar className={main.PaneToolbarFill}>
			<FieldSelect name="work_calendar_year" size="sm" value={String(year)} onChange={(e) => setYear(Number(e.target.value))}
				options={years.map((y) => ({ value: String(y), label: String(y) }))} />
			{isAdmin && (
				<>
					<Button icon="plus" disabled={busy} onClick={() => setEdit({ day: { date: "", kind: "holiday", name: "" }, existing: false })}>
						{translate("workCalendarAdd")}
					</Button>
					{tab === "days" && (
						<>
							<Button disabled={busy || !active} onClick={() => active && setEdit({ day: { date: active.date, kind: active.kind, name: active.name ?? "" }, existing: true })}>
								{translate("edit")}
							</Button>
							<Button disabled={busy || !active?.stored} onClick={() => void removeDay()}>{translate("delete")}</Button>
						</>
					)}
					<Button disabled={busy} onClick={() => void seed()} title={translate("workCalendarSeedHint")}>{translate("workCalendarSeed")}</Button>
				</>
			)}
			<Toolbar.Divider />
			<Toolbar.ReloadButton onClick={refresh} disabled={q.isFetching} />
		</Toolbar>
	));

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columnsJson as TColumn[], "WorkCalendarDays"));
	const view = useStaticTableView(useMemo(() => toCalendarRows(entries), [entries]), { wcDate: "asc" });
	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier !== "wcLaw") return undefined;
		const e = row.source as CalendarEntry | undefined;
		return e ? <QualityChip tone={lawTone(e.lawState)}>{lawLabel(e.lawState)}</QualityChip> : undefined;
	}, []);

	const missing = entries.filter((e) => e.lawState === "missing").length;
	const info: NoticeItem[] = [
		{ type: "info", text: translate("workCalendarInfo") },
		...(!slaWorkingTime ? [{ type: "info" as const, text: translate("workCalendarSlaCalendar") }] : []),
		...(missing ? [{ type: "warning" as const, text: fillTemplate(translate("workCalendarMissingWarn"), { count: missing }) }] : []),
		...(q.error ? routeError(q.error, { source: translate(COMPONENT) }) : []),
	];

	const renderMonth = (month: number) => {
		const weeks = monthGrid(year, month, index, workDays, today);
		return (
			<section key={month} className={styles.Month} aria-label={monthName(month, lang)}>
				<header className={styles.MonthHead}>
					<span className={styles.MonthName}>{monthName(month, lang)}</span>
					<span className={styles.MonthCount}>
						{fillTemplate(translate("workCalendarMonthDays"), { count: workingDaysInMonth(year, month, index, workDays) })}
					</span>
				</header>
				<div className={styles.Grid} role="grid">
					{ISO_DAYS.map((d) => <span key={d} className={styles.WeekHead} role="columnheader">{dayLabel(d)}</span>)}
					{weeks.flat().map((cell, i) => {
						if (!cell) return <span key={`e${i}`} className={styles.Empty} />;
						const title = [getFormatDateOnly(cell.ymd), cell.kind ? kindLabel(cell.kind) : null, cell.name].filter(Boolean).join(" · ");
						const cls = cx(styles.Day, cell.kind ? KIND_CLASS[cell.kind] : !cell.working && styles.Weekend, cell.today && styles.Today);
						return isAdmin ? (
							<button key={cell.ymd} type="button" className={cx(cls, styles.DayButton)} title={title} onClick={() => openDay(cell)}>{cell.day}</button>
						) : (
							<span key={cell.ymd} className={cls} title={title}>{cell.day}</span>
						);
					})}
				</div>
			</section>
		);
	};

	const tabs = [
		{
			id: "year", label: translate("workCalendarYearTab"), component: (
				<div className={styles.Body}>
					<div className={styles.Summary}>
						<span className={styles.SummaryMain}>
							{fillTemplate(translate("workCalendarYearDays"), { year, count: q.data ? workingDaysInYear(year, index, workDays) : "…" })}
						</span>
						<span>{fillTemplate(translate("workCalendarWeek"), { days: workDaysText(workDays) })}</span>
						<span className={styles.Legend}>
							<span className={cx(styles.Swatch, styles.Holiday)} />{translate("workCalendarHoliday")}
							<span className={cx(styles.Swatch, styles.Dayoff)} />{translate("workCalendarDayoff")}
							<span className={cx(styles.Swatch, styles.Workday)} />{translate("workCalendarWorkday")}
							<span className={cx(styles.Swatch, styles.Weekend)} />{translate("workCalendarWeekend")}
						</span>
						{isAdmin && <span className={main.SettingHint}>{translate("workCalendarClickHint")}</span>}
					</div>
					<div className={styles.Months}>{Array.from({ length: 12 }, (_, i) => renderMonth(i + 1))}</div>
				</div>
			),
		},
		{
			id: "days", label: translate("workCalendarDaysTab"), component: (
				<div className={styles.Tab}>
					<Table {...buildStaticTableProps({
						componentName: "WorkCalendarDays", rows: view.rows, columns: cols, setColumns: setCols,
						sorting: view.sorting, search: view.search, isLoading: q.isLoading,
						emptyText: translate("workCalendarEmpty"), renderCell,
						onActiveRowChange: (row) => setActiveDate((row?.source as CalendarEntry | undefined)?.date ?? null),
						onRowClick: (row) => {
							const e = (row as TDataItem).source as CalendarEntry | undefined;
							if (e && isAdmin) setEdit({ day: { date: e.date, kind: e.kind, name: e.name ?? "" }, existing: true });
						},
					})} />
				</div>
			),
		},
	];

	return (
		<>
			{paneToolbar}
			<Notice items={[...info, ...notices]} />
			<div className={main.PaneFill}>
				<Tabs tabs={tabs} activeTab={tab} onTabChange={(id) => setTab(id as CalendarTab)} />
			</div>
			{edit && <DayModal day={edit.day} existing={edit.existing} onClose={() => setEdit(null)} onDone={() => void q.refetch()} />}
		</>
	);
};
WorkCalendarView.displayName = COMPONENT;

export default WorkCalendarView;
