/**
 * UserPerformance — дашборд эффективности пользователей (E9, collaboration).
 *
 * Read-only агрегат: сколько документов каждый пользователь провёл за период
 * (авторство по 22 таблицам документов) + состояние его задач (Todo, где он
 * исполнитель). Источник — бэкенд `GET /reports/user-performance`; мультитенант-
 * изоляция там же (только доступные пользователю организации).
 *
 * Новой доменной модели нет — только визуализация того, что уже пишется при
 * ведении учёта.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";
import { translate } from "src/i18";
import styles from "./UserPerformance.module.scss";

interface PerfRow {
  userUuid: string;
  userName: string;
  docs: number;
  tasksTotal: number;
  tasksDone: number;
  tasksActive: number;
  tasksOverdue: number;
}

// По умолчанию — текущий год (документы набора датированы 2026).
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const yearEnd = () => `${new Date().getFullYear()}-12-31`;

const Metric: FC<{ value: number; kind: "done" | "active" | "overdue" }> = ({ value, kind }) => (
  <div className={`${styles.Metric} ${value === 0 ? styles.zero : styles[kind]}`}>{value}</div>
);

export const UserPerformanceList: FC = () => {
  const [dateFrom, setDateFrom] = useState(yearStart);
  const [dateTo, setDateTo] = useState(yearEnd);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["user-performance", dateFrom, dateTo],
    queryFn: async () => {
      const r = await apiClient.get<{ items?: PerfRow[] }>("reports/user-performance", {
        params: { dateFrom, dateTo },
      });
      return r.data?.items ?? [];
    },
    staleTime: 30_000,
  });

  const rows = data ?? [];
  // Масштаб полосы «документов» — по максимуму, чтобы сравнивать пользователей.
  const maxDocs = useMemo(() => Math.max(1, ...rows.map((r) => r.docs)), [rows]);

  return (
    <div className={styles.Wrap}>
      <div className={styles.Toolbar}>
        <label className={styles.Field}>
          {translate("perfPeriod")}:
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className={styles.Field}>
          —
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <span className={styles.Hint}>{translate("perfHint")}</span>
      </div>

      {isLoading ? (
        <div className={styles.Status}>{translate("loading")}</div>
      ) : isError ? (
        <div className={styles.Status}>{translate("perfError")}</div>
      ) : rows.length === 0 ? (
        <div className={styles.Status}>{translate("perfEmpty")}</div>
      ) : (
        <div className={styles.Table}>
          <div className={`${styles.Row} ${styles.head}`}>
            <span>{translate("perfUser")}</span>
            <span>{translate("perfDocuments")}</span>
            <span style={{ textAlign: "center" }}>{translate("perfTasksDone")}</span>
            <span style={{ textAlign: "center" }}>{translate("perfTasksActive")}</span>
            <span style={{ textAlign: "center" }}>{translate("perfTasksOverdue")}</span>
          </div>
          {rows.map((r) => (
            <div key={r.userUuid} className={styles.Row}>
              <div className={styles.User} title={r.userName}>{r.userName}</div>
              <div className={styles.DocBarCell}>
                <div className={styles.DocBarTrack}>
                  <div className={styles.DocBarFill} style={{ width: `${(r.docs / maxDocs) * 100}%` }} />
                </div>
                <div className={styles.DocValue}>{r.docs}</div>
              </div>
              <Metric value={r.tasksDone} kind="done" />
              <Metric value={r.tasksActive} kind="active" />
              <Metric value={r.tasksOverdue} kind="overdue" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const UserPerformance = UserPerformanceList;
export default UserPerformance;
