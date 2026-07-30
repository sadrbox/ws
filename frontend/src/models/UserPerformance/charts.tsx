/**
 * Графики дашборда на Recharts. Тема-независимы: цвета берутся из CSS-переменных
 * (index.html, light/dark) — сетка/оси/тултип следуют за темой без JS.
 *
 * Recharts живёт внутри lazy-панели UserPerformance → попадает в её отдельный чанк,
 * в основной бандл не тянется.
 *
 * Компонентный модуль (без экспортов-данных): форматтеры вынесены в ./format.
 */
import { FC } from "react";
import {
	ResponsiveContainer,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Cell,
	Legend,
} from "recharts";
import { fmtValue, type ValueFormat } from "./format";

const GRID = "var(--n-88)";
const AXIS_TICK = "var(--text-muted)";
const AXIS_LINE = "var(--n-88)";

/** Высота контейнера под число строк (горизонтальные бары). */
const heightFor = (rows: number, extra = 44) => Math.max(150, rows * 34 + extra);

// ── Тултип (единый, стилизован токенами) ─────────────────────────────────────
interface TipEntry {
	name: string;
	value: number;
	color: string;
	format: ValueFormat;
}
const Tip: FC<{ active?: boolean; title?: string; entries: TipEntry[] }> = ({ active, title, entries }) =>
	active && entries.length ? (
		<div
			style={{
				background: "var(--panel, var(--surface-muted))",
				border: "1px solid var(--n-88)",
				borderRadius: 8,
				boxShadow: "0 2px 10px rgba(0,0,0,.12)",
				padding: "7px 10px",
				fontSize: 12.5,
				color: "var(--text-secondary)",
				minWidth: 130,
			}}
		>
			<div style={{ color: "var(--text-muted)", marginBottom: 3 }}>{title}</div>
			{entries.map((e) => (
				<div key={e.name} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
					<span style={{ width: 9, height: 9, borderRadius: 2, background: e.color, flex: "none" }} />
					<span style={{ flex: 1 }}>{e.name}</span>
					<b style={{ color: "var(--ink, var(--n-20))", fontVariantNumeric: "tabular-nums" }}>
						{fmtValue(e.value, e.format)}
					</b>
				</div>
			))}
		</div>
	) : null;

// ── Простой горизонтальный бар: значение по категории ────────────────────────
export interface CatDatum {
	name: string;
	value: number;
}
export const CategoryBars: FC<{
	data: CatDatum[];
	colorVar: string;
	format: ValueFormat;
	seriesName: string;
}> = ({ data, colorVar, format, seriesName }) => {
	const color = `var(${colorVar})`;
	return (
		<ResponsiveContainer width="100%" height={heightFor(data.length)}>
			<BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={8}>
				<CartesianGrid horizontal={false} stroke={GRID} />
				<XAxis
					type="number"
					tick={{ fill: AXIS_TICK, fontSize: 11 }}
					tickFormatter={(v) => fmtValue(v, format, true)}
					axisLine={{ stroke: AXIS_LINE }}
					tickLine={false}
				/>
				<YAxis
					type="category"
					dataKey="name"
					width={132}
					tick={{ fill: AXIS_TICK, fontSize: 12 }}
					axisLine={false}
					tickLine={false}
				/>
				<Tooltip
					cursor={{ fill: "var(--n-88)", opacity: 0.4 }}
					content={({ active, payload, label }) => (
						<Tip
							active={active}
							title={String(label ?? "")}
							entries={payload?.length ? [{ name: seriesName, value: Number(payload[0].value), color, format }] : []}
						/>
					)}
				/>
				<Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={26} isAnimationActive={false}>
					{data.map((d) => (
						<Cell key={d.name} />
					))}
				</Bar>
			</BarChart>
		</ResponsiveContainer>
	);
};

// ── Стек задач по исполнителям (выполнено / в работе / просрочено) ────────────
export interface TaskDatum {
	name: string;
	done: number;
	active: number;
	overdue: number;
}
const TASK_SERIES = [
	{ key: "done", name: "Выполнено", color: "var(--success)" },
	{ key: "active", name: "В работе", color: "var(--warning)" },
	{ key: "overdue", name: "Просрочено", color: "var(--danger)" },
] as const;

export const TaskStackBars: FC<{ data: TaskDatum[] }> = ({ data }) => (
	<ResponsiveContainer width="100%" height={heightFor(data.length, 60)}>
		<BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={8}>
			<CartesianGrid horizontal={false} stroke={GRID} />
			<XAxis
				type="number"
				allowDecimals={false}
				tick={{ fill: AXIS_TICK, fontSize: 11 }}
				axisLine={{ stroke: AXIS_LINE }}
				tickLine={false}
			/>
			<YAxis
				type="category"
				dataKey="name"
				width={132}
				tick={{ fill: AXIS_TICK, fontSize: 12 }}
				axisLine={false}
				tickLine={false}
			/>
			<Tooltip
				cursor={{ fill: "var(--n-88)", opacity: 0.4 }}
				content={({ active, payload, label }) => (
					<Tip
						active={active}
						title={String(label ?? "")}
						entries={
							payload?.map((p) => {
								const s = TASK_SERIES.find((x) => x.key === p.dataKey)!;
								return { name: s.name, value: Number(p.value), color: s.color, format: "int" as const };
							}) ?? []
						}
					/>
				)}
			/>
			<Legend
				verticalAlign="bottom"
				height={26}
				iconType="circle"
				iconSize={9}
				formatter={(v) => <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{v}</span>}
			/>
			{TASK_SERIES.map((s, i) => (
				<Bar
					key={s.key}
					dataKey={s.key}
					name={s.name}
					stackId="t"
					fill={s.color}
					isAnimationActive={false}
					radius={i === TASK_SERIES.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
					maxBarSize={26}
				/>
			))}
		</BarChart>
	</ResponsiveContainer>
);
