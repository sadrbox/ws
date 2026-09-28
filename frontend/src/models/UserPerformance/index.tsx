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
 *
 * E17 «Стандарт качества» (СК1.8): к активности добавлено КАЧЕСТВО работы с задачами — доля
 * закрытых с результатом, время реакции на обращения, напоминания клиентов, возвраты «не
 * выполнено», оценка клиентов. Те же блоки и плитки по тем же правилам (dashboardBlocks.ts).
 */
import { FC, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { translate } from "src/i18";
import SubTableSheets from "src/components/SubTableSheets";
import { CategoryBars, TaskStackBars } from "./charts";
import { fmtMaybe } from "./format";
import { barData, num, taskData, userTileValue } from "./metrics";
import {
	managerColumns,
	managerTableRows,
	perfCellText,
	userColumns,
	userTableRows,
	type ManagerRow,
	type PerfRow,
} from "./tables";
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
// Строки менеджеров и пользователей описаны в tables.ts: по ним строится и табличный вид.
interface ManagerTotals {
	netRevenue: number;
	grossProfit: number;
	salesCount: number;
	[k: string]: number;
}

const yearStart = () => `${new Date().getFullYear()}-01-01`;
const yearEnd = () => `${new Date().getFullYear()}-12-31`;

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
	// null — показателя нет (доля без единой закрытой задачи): плитка пишет «—», а не 0 %.
	const tileValue = (t: KpiTileDef): number | null => {
		if (t.source === "managers") return num(managerTotals?.[t.key]);
		return userTileValue(perfRows, t);
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
							title={translate(b.subtitle)}
						>
							{translate(b.title)}
						</button>
					))}
				</div>
			)}

			{/* KPI-плитки */}
			{!noAccess && availableTiles.length > 0 && (
				<div className={styles.Kpis}>
					{availableTiles.map((t) => (
						<div key={t.id} className={styles.Kpi}>
							<span className={styles.KpiLabel}>{translate(t.label)}</span>
							<span className={styles.KpiVal}>
								{tileLoading(t) ? "…" : fmtMaybe(tileValue(t), t.format)}
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
					managersState={{ loading: managersQ.isLoading, error: managersQ.isError }}
					usersState={{ loading: usersQ.isLoading, error: usersQ.isError }}
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
		const data = barData(rows as Array<Record<string, unknown>>, nameKey, block.valueKey!, block);
		return data.length ? (
			<CategoryBars data={data} colorVar={block.colorVar!} format={block.format ?? "int"} seriesName={translate(block.title)} />
		) : (
			<div className={styles.CardStatus}>{translate("perfEmpty")}</div>
		);
	};
	return (
		<section className={styles.Card}>
			<header className={styles.CardHead}>
				<h3>{translate(block.title)}</h3>
				<p>{translate(block.subtitle)}</p>
			</header>
			{body()}
		</section>
	);
};

// ── Табличный вид (a11y / выгрузка глазами) ──────────────────────────────────
/*
 * SubTableSheets вместо сырых <table> (28.09): общий вид ячеек, сортировка по заголовку, ресайз колонок.
 * Подпись таблицы — заголовком карточки, как у графиков; подсказки к колонкам качества — в title заголовка.
 */
type SourceState = { loading: boolean; error: boolean };

const DataTables: FC<{
	blocks: DashboardBlockDef[];
	managerRows: ManagerRow[];
	perfRows: PerfRow[];
	managersState: SourceState;
	usersState: SourceState;
}> = ({ blocks, managerRows, perfRows, managersState, usersState }) => {
	const hasManagers = blocks.some((b) => b.source === "managers");
	const hasUsers = blocks.some((b) => b.source === "users");
	const managerData = useMemo(() => managerTableRows(managerRows), [managerRows]);
	const userData = useMemo(() => userTableRows(perfRows), [perfRows]);
	// Пустая таблица на загрузке — не «нет данных»: говорим, что идёт чтение или что оно не удалось.
	const emptyText = (s: SourceState) => translate(s.loading ? "loading" : s.error ? "perfError" : "perfEmpty");
	return (
		<div className={styles.Tables}>
			{hasManagers && (
				<section className={styles.Card}>
					<header className={styles.CardHead}>
						<h3>{translate("perfByManagers")}</h3>
					</header>
					<SubTableSheets columns={managerColumns()} rows={managerData} renderCell={perfCellText}
						emptyMessage={emptyText(managersState)} />
				</section>
			)}
			{hasUsers && (
				<section className={styles.Card}>
					<header className={styles.CardHead}>
						<h3>{translate("perfByUsers")}</h3>
					</header>
					<SubTableSheets columns={userColumns()} rows={userData} renderCell={perfCellText}
						emptyMessage={emptyText(usersState)} />
				</section>
			)}
		</div>
	);
};

const UserPerformance = UserPerformanceList;
export default UserPerformance;
