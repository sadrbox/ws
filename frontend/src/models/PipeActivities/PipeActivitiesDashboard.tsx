/**
 * Дашборд показателей «События 1С» (PipeActivity) — read-only агрегаты из
 * GET /pipeactivities/stats. Графики на Recharts (в lazy-чанке модуля), цвета —
 * CSS-токены темы (light/dark). Данные НЕ изменяются и НЕ удаляются.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie,
} from "recharts";
import { apiClient } from "src/services/api/client";
import { translate } from "src/i18";
import styles from "./PipeActivitiesDashboard.module.scss";

interface Cat { key: string | null; count: number }
interface Stats {
  total: number;
  byStatus: Cat[];
  byObjectName: Cat[];
  byUser: Cat[];
  byDay: { day: string; count: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const fmtInt = (n: number) => (Number(n) || 0).toLocaleString("ru-RU");

// applyStatus → человекочитаемо + семантический цвет.
const STATUS: Record<string, { label: string; color: string }> = {
  created: { label: "Создано", color: "var(--success)" },
  updated: { label: "Обновлено", color: "var(--color-link)" },
  linked: { label: "Связано", color: "var(--c-teal-61)" },
  skipped: { label: "Пропущено", color: "var(--text-muted)" },
  error: { label: "Ошибка", color: "var(--danger)" },
};
const PENDING = { label: "Не обработано", color: "var(--warning)" };
const statusMeta = (k: string | null) => (k && STATUS[k]) || PENDING;

const GRID = "var(--n-88)";
const TICK = "var(--text-muted)";

const Tip: FC<{ active?: boolean; title?: string; value?: number; color?: string }> = ({ active, title, value, color }) =>
  active && value != null ? (
    <div className={styles.Tip}>
      <div className={styles.TipKey}>{title}</div>
      <div className={styles.TipVal}>
        {color && <span className={styles.TipSw} style={{ background: color }} />}
        {fmtInt(value)}
      </div>
    </div>
  ) : null;

// Горизонтальные бары по категории (тип объекта / пользователь / действие).
const CatBars: FC<{ data: Cat[]; color: string; nameOf?: (k: string | null) => string }> = ({ data, color, nameOf }) => {
  const rows = data.map((d) => ({ name: nameOf ? nameOf(d.key) : (d.key ?? "—"), value: d.count }));
  const h = Math.max(120, rows.length * 30 + 24);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 14, bottom: 2, left: 6 }} barCategoryGap={7}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" allowDecimals={false} tick={{ fill: TICK, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fill: TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "var(--n-88)", opacity: 0.4 }}
          content={({ active, payload, label }) => <Tip active={active} title={String(label ?? "")} value={payload?.[0]?.value as number} color={color} />} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export const PipeActivitiesDashboard: FC = () => {
  const [dateFrom, setDateFrom] = useState(() => daysAgo(30));
  const [dateTo, setDateTo] = useState(() => iso(new Date()));

  const { data, isLoading, isError } = useQuery<Stats>({
    queryKey: ["pipeactivities-stats", dateFrom, dateTo],
    queryFn: async () => (await apiClient.get<Stats>("pipeactivities/stats", { params: { dateFrom, dateTo } })).data,
    staleTime: 30_000,
  });

  const kpis = useMemo(() => {
    const by = new Map((data?.byStatus ?? []).map((s) => [s.key, s.count]));
    const g = (k: string) => by.get(k) ?? 0;
    return {
      total: data?.total ?? 0,
      applied: g("created") + g("updated") + g("linked"),
      skipped: g("skipped"),
      error: g("error"),
      pending: by.get(null) ?? 0,
    };
  }, [data]);

  const statusPie = useMemo(
    () => (data?.byStatus ?? []).map((s) => ({ name: statusMeta(s.key).label, value: s.count, color: statusMeta(s.key).color })),
    [data],
  );

  return (
    <div className={styles.Wrap}>
      <div className={styles.Toolbar}>
        <label className={styles.Field}>{translate("perfPeriod")}:
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className={styles.Field}>—
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <span className={styles.Hint}>События 1С · показатели за период</span>
      </div>

      {isError ? (
        <div className={styles.Status}>{translate("perfError")}</div>
      ) : (
        <>
          <div className={styles.Kpis}>
            <Kpi label="Всего событий" value={kpis.total} loading={isLoading} />
            <Kpi label="Применено" value={kpis.applied} loading={isLoading} tone="good" />
            <Kpi label="Пропущено" value={kpis.skipped} loading={isLoading} />
            <Kpi label="Ошибки" value={kpis.error} loading={isLoading} tone="bad" />
            <Kpi label="Не обработано" value={kpis.pending} loading={isLoading} tone="warn" />
          </div>

          <div className={styles.Grid}>
            <Card title="Динамика по дням" subtitle="Число событий по дате получения" wide>
              {isLoading ? <Loading /> : <DayBars data={data?.byDay ?? []} />}
            </Card>
            <Card title="По статусу применения" subtitle="Что сделано со справочником">
              {isLoading ? <Loading /> : <StatusPie data={statusPie} total={kpis.total} />}
            </Card>
            <Card title="По справочнику" subtitle="Какие справочники синхронизируются (по числу событий)">
              {isLoading ? <Loading /> : <CatBars data={data?.byObjectName ?? []} color="var(--color-link)" />}
            </Card>
            <Card title="По пользователям" subtitle="Топ инициаторов в 1С">
              {isLoading ? <Loading /> : <CatBars data={data?.byUser ?? []} color="var(--c-teal-61)" />}
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

const Kpi: FC<{ label: string; value: number; loading?: boolean; tone?: "good" | "bad" | "warn" }> = ({ label, value, loading, tone }) => (
  <div className={styles.Kpi}>
    <span className={styles.KpiLabel}>{label}</span>
    <span className={`${styles.KpiVal} ${tone ? styles[tone] : ""}`}>{loading ? "…" : fmtInt(value)}</span>
  </div>
);

const Card: FC<{ title: string; subtitle?: string; wide?: boolean; children: React.ReactNode }> = ({ title, subtitle, wide, children }) => (
  <section className={`${styles.Card} ${wide ? styles.wide : ""}`}>
    <header className={styles.CardHead}>
      <h3>{title}</h3>{subtitle && <p>{subtitle}</p>}
    </header>
    {children}
  </section>
);

const Loading: FC = () => (
  <div className={styles.Loading}><span className={styles.Spinner} />{translate("loading")}</div>
);

const DayBars: FC<{ data: { day: string; count: number }[] }> = ({ data }) => {
  const rows = data.map((d) => ({ day: d.day.slice(5), count: d.count })); // MM-DD
  if (!rows.length) return <div className={styles.Empty}>{translate("perfEmpty")}</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={{ fill: TICK, fontSize: 10.5 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
        <YAxis allowDecimals={false} width={38} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "var(--n-88)", opacity: 0.4 }}
          content={({ active, payload, label }) => <Tip active={active} title={String(label ?? "")} value={payload?.[0]?.value as number} color="var(--color-link)" />} />
        <Bar dataKey="count" fill="var(--color-link)" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const StatusPie: FC<{ data: { name: string; value: number; color: string }[]; total: number }> = ({ data, total }) => {
  if (!data.length) return <div className={styles.Empty}>{translate("perfEmpty")}</div>;
  return (
    <div className={styles.PieRow}>
      <ResponsiveContainer width={168} height={168}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={46} outerRadius={78} paddingAngle={1.5} stroke="var(--panel, var(--surface-muted))" strokeWidth={2} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={({ active, payload }) => {
            const p = payload?.[0]?.payload as { name: string; value: number; color: string } | undefined;
            return <Tip active={active} title={p?.name} value={p?.value} color={p?.color} />;
          }} />
        </PieChart>
      </ResponsiveContainer>
      <ul className={styles.Legend}>
        {data.map((d) => (
          <li key={d.name}>
            <span className={styles.Sw} style={{ background: d.color }} />
            <span className={styles.LgName}>{d.name}</span>
            <span className={styles.LgVal}>{fmtInt(d.value)}</span>
            <span className={styles.LgPct}>{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PipeActivitiesDashboard;
