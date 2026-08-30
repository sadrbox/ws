/**
 * UserPerformance — дашборд показателей (E9, collaboration).
 *
 * Read-only агрегаты из двух источников:
 *   • GET /reports/sales-by-manager  — деньги ПО МЕНЕДЖЕРАМ (выручка, прибыль, кол-во);
 *   • GET /reports/user-performance — активность по пользователям (документы, задачи).
 *
 * Механизм выбора блоков ПО ПРАВАМ ДОСТУПА: каждый блок объявляет модель прав
 * (dashboardBlocks.ts → requires). Недоступные пользователю блоки не предлагаются к
 * выбору и не запускают свой источник (query.enabled = canRead). Выбор сохраняется в
 * localStorage.
 *
 * Графики — Recharts (charts.tsx), внутри этой lazy-панели → в отдельном чанке,
 * цвета/тема — из CSS-токенов.
 */
import { FC, useEffect, useMemo, useState } from "react";
import { asText } from "src/utils/asText";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { translate } from "src/i18";
import { CategoryBars, TaskStackBars, type CatDatum, type TaskDatum } from "./charts";
import { fmtValue } from "./format";
import {
	BLOCKS,
	KPI_TILES,
	SELECTED_BLOCKS_KEY,
	type DashboardBlockDef,
	type KpiTileDef,
} from "./dashboardBlocks";
import styles from "./UserPerformance.module.scss";
import main from "src/styles/main.module.scss";

// ── Типы источников ──────────────────────────────────────────────────────────
interface ManagerRow {
	managerUuid: string | null;
	managerName: string;
	salesCount: number;
	netRevenue: number;
	grossProfit: number;
	[k: string]: unknown;
}
interface ManagerTotals {
	netRevenue: number;
	grossProfit: number;
	salesCount: number;
	[k: string]: number;
}
interface PerfRow {
	userUuid: string;
	userName: string;
	docs: number;
	tasksTotal: number;
	tasksDone: number;
	tasksActive: number;
	tasksOverdue: number;
	[k: string]: unknown;
}

const yearStart = () => `${new Date().getFullYear()}-01-01`;
const yearEnd = () => `${new Date().getFullYear()}-12-31`;
const TOP_N = 15;

// ── Хелперы данных ───────────────────────────────────────────────────────────
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

function barData(rows: Array<Record<string, unknown>>, nameKey: string, valueKey: string): CatDatum[] {
	return rows
		.map((r) => ({ name: asText(r[nameKey] ?? "—"), value: num(r[valueKey]) }))
		.filter((d) => d.value !== 0)
		.sort((a, b) => b.value - a.value)
		.slice(0, TOP_N);
}
function taskData(rows: PerfRow[]): TaskDatum[] {
	return rows
		.map((r) => ({ name: r.userName, done: num(r.tasksDone), active: num(r.tasksActive), overdue: num(r.tasksOverdue) }))
		.filter((d) => d.done + d.active + d.overdue > 0)
		.sort((a, b) => b.done + b.active + b.overdue - (a.done + a.active + a.overdue))
		.slice(0, TOP_N);
}

export const UserPerformanceList: FC = () => {
	const [dateFrom, setDateFrom] = useState(yearStart);
	const [dateTo, setDateTo] = useState(yearEnd);
	const [asTable, setAsTable] = useState(false);

	// Права: гейтят блоки, KPI и запуск источников.
	const saleAccess = useAccessPermission("Sale");
	const todoAccess = useAccessPermission("Todo");
	const perms = useMemo<Record<string, boolean>>(
		() => ({ Sale: saleAccess.canRead, Todo: todoAccess.canRead }),
		[saleAccess.canRead, todoAccess.canRead],
	);
	const canBlock = (requires: string) => perms[requires] ?? false;
	const needManagers = canBlock("Sale");
	const needUsers = canBlock("Todo");

	// ── Источники (грузятся только при наличии прав) ──────────────────────────
	const managersQ = useQuery({
		queryKey: ["sales-by-manager", dateFrom, dateTo],
		enabled: needManagers,
		staleTime: 30_000,
		queryFn: async () => {
			const r = await apiClient.get<{ items?: ManagerRow[]; totals?: ManagerTotals }>("reports/sales-by-manager", {
				params: { dateFrom, dateTo },
			});
			return { items: r.data?.items ?? [], totals: r.data?.totals };
		},
	});
	const usersQ = useQuery({
		queryKey: ["user-performance", dateFrom, dateTo],
		enabled: needUsers,
		staleTime: 30_000,
		queryFn: async () => {
			const r = await apiClient.get<{ items?: PerfRow[] }>("reports/user-performance", {
				params: { dateFrom, dateTo },
			});
			return r.data?.items ?? [];
		},
	});

	const managerRows = managersQ.data?.items ?? [];
	const managerTotals = managersQ.data?.totals;
	const perfRows = usersQ.data ?? [];

	// ── Доступные блоки + выбор пользователя ──────────────────────────────────
	const availableBlocks = useMemo(() => BLOCKS.filter((b) => canBlock(b.requires)), [perms]); // eslint-disable-line react-hooks/exhaustive-deps
	const availableTiles = useMemo(() => KPI_TILES.filter((t) => canBlock(t.requires)), [perms]); // eslint-disable-line react-hooks/exhaustive-deps

	const [selected, setSelected] = useState<Set<string>>(() => {
		try {
			const raw = localStorage.getItem(SELECTED_BLOCKS_KEY);
			if (raw) return new Set(JSON.parse(raw) as string[]);
		} catch {
			/* ignore */
		}
		return new Set(BLOCKS.map((b) => b.id)); // по умолчанию — все
	});
	useEffect(() => {
		try {
			localStorage.setItem(SELECTED_BLOCKS_KEY, JSON.stringify([...selected]));
		} catch {
			/* ignore */
		}
	}, [selected]);
	const toggleBlock = (id: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});

	const shownBlocks = availableBlocks.filter((b) => selected.has(b.id));

	// ── Значение KPI-плитки ───────────────────────────────────────────────────
	const tileValue = (t: KpiTileDef): number => {
		if (t.source === "managers") return num(managerTotals?.[t.key]);
		return perfRows.reduce((s, r) => s + num(r[t.key]), 0);
	};
	const tileLoading = (t: KpiTileDef) => (t.source === "managers" ? managersQ.isLoading : usersQ.isLoading);

	const noAccess = availableBlocks.length === 0;

	return (
		<div className={styles.Wrap}>
			{/* Панель управления */}
			<div className={main.Toolbar}>
				<label className={styles.Field}>
					{translate("perfPeriod")}:
					<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
				</label>
				<label className={styles.Field}>
					—
					<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
				</label>
				<span className={styles.Spacer} />
				<button
					type="button"
					className={styles.ViewToggle}
					onClick={() => setAsTable((v) => !v)}
					title={asTable ? "Показать графики" : "Показать таблицу"}
				>
					{asTable ? "◧ Графики" : "☰ Таблица"}
				</button>
			</div>

			{/* Выбор блоков — только доступные по правам */}
			{!noAccess && (
				<div className={styles.Picker}>
					<span className={styles.PickerLabel}>Показатели:</span>
					{availableBlocks.map((b) => (
						<button
							key={b.id}
							type="button"
							className={`${styles.Chip} ${selected.has(b.id) ? styles.on : ""}`}
							aria-pressed={selected.has(b.id)}
							onClick={() => toggleBlock(b.id)}
							title={b.subtitle}
						>
							{b.title}
						</button>
					))}
				</div>
			)}

			{/* KPI-плитки */}
			{!noAccess && availableTiles.length > 0 && (
				<div className={styles.Kpis}>
					{availableTiles.map((t) => (
						<div key={t.id} className={styles.Kpi}>
							<span className={styles.KpiLabel}>{t.label}</span>
							<span className={styles.KpiVal}>
								{tileLoading(t) ? "…" : fmtValue(tileValue(t), t.format)}
							</span>
						</div>
					))}
				</div>
			)}

			{/* Тело */}
			{noAccess ? (
				<div className={styles.Status}>Нет доступных показателей — обратитесь к администратору прав.</div>
			) : asTable ? (
				<DataTables
					blocks={shownBlocks}
					managerRows={managerRows}
					perfRows={perfRows}
				/>
			) : shownBlocks.length === 0 ? (
				<div className={styles.Status}>Все блоки скрыты — выберите показатели выше.</div>
			) : (
				<div className={styles.Grid}>
					{shownBlocks.map((b) => (
						<BlockCard
							key={b.id}
							block={b}
							managerRows={managerRows}
							perfRows={perfRows}
							loading={b.source === "managers" ? managersQ.isLoading : usersQ.isLoading}
							error={b.source === "managers" ? managersQ.isError : usersQ.isError}
						/>
					))}
				</div>
			)}
		</div>
	);
};

// ── Карточка блока ───────────────────────────────────────────────────────────
const BlockCard: FC<{
	block: DashboardBlockDef;
	managerRows: ManagerRow[];
	perfRows: PerfRow[];
	loading: boolean;
	error: boolean;
}> = ({ block, managerRows, perfRows, loading, error }) => {
	const body = () => {
		if (loading) return <div className={styles.CardStatus}>{translate("loading")}</div>;
		if (error) return <div className={styles.CardStatus}>{translate("perfError")}</div>;

		if (block.kind === "tasks") {
			const data = taskData(perfRows);
			return data.length ? <TaskStackBars data={data} /> : <div className={styles.CardStatus}>{translate("perfEmpty")}</div>;
		}
		const rows = block.source === "managers" ? managerRows : perfRows;
		const nameKey = block.source === "managers" ? "managerName" : "userName";
		const data = barData(rows as Array<Record<string, unknown>>, nameKey, block.valueKey!);
		return data.length ? (
			<CategoryBars data={data} colorVar={block.colorVar!} format={block.format ?? "int"} seriesName={block.title} />
		) : (
			<div className={styles.CardStatus}>{translate("perfEmpty")}</div>
		);
	};
	return (
		<section className={styles.Card}>
			<header className={styles.CardHead}>
				<h3>{block.title}</h3>
				<p>{block.subtitle}</p>
			</header>
			{body()}
		</section>
	);
};

// ── Табличный вид (a11y / выгрузка глазами) ──────────────────────────────────
const DataTables: FC<{ blocks: DashboardBlockDef[]; managerRows: ManagerRow[]; perfRows: PerfRow[] }> = ({
	blocks,
	managerRows,
	perfRows,
}) => {
	const hasManagers = blocks.some((b) => b.source === "managers");
	const hasUsers = blocks.some((b) => b.source === "users");
	return (
		<div className={styles.Tables}>
			{hasManagers && (
				<table className={styles.DataTable}>
					<caption>По менеджерам</caption>
					<thead>
						<tr>
							<th>Менеджер</th>
							<th>Выручка</th>
							<th>Валовая прибыль</th>
							<th>Продаж, шт</th>
						</tr>
					</thead>
					<tbody>
						{managerRows.map((r) => (
							<tr key={r.managerUuid ?? r.managerName}>
								<td>{r.managerName}</td>
								<td className={styles.numCell}>{fmtValue(num(r.netRevenue), "money")}</td>
								<td className={styles.numCell}>{fmtValue(num(r.grossProfit), "money")}</td>
								<td className={styles.numCell}>{num(r.salesCount)}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{hasUsers && (
				<table className={styles.DataTable}>
					<caption>По пользователям</caption>
					<thead>
						<tr>
							<th>Пользователь</th>
							<th>Документов</th>
							<th>Выполнено</th>
							<th>В работе</th>
							<th>Просрочено</th>
						</tr>
					</thead>
					<tbody>
						{perfRows.map((r) => (
							<tr key={r.userUuid}>
								<td>{r.userName}</td>
								<td className={styles.numCell}>{r.docs}</td>
								<td className={styles.numCell}>{r.tasksDone}</td>
								<td className={styles.numCell}>{r.tasksActive}</td>
								<td className={styles.numCell}>{r.tasksOverdue}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
};

const UserPerformance = UserPerformanceList;
export default UserPerformance;
