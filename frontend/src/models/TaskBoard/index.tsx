/**
 * TaskBoard — канбан-доска задач между пользователями (E9, collaboration).
 *
 * Строится ПОВЕРХ существующего `Todo` (curator/executor/status/deadline) и его
 * роутера `todos` — новой доменной модели не заводим. Мультитенант-изоляция
 * бесплатна: список приходит уже через `tenantFilter` (только доступные
 * пользователю организации).
 *
 * Колонки = статусы Todo. Перетаскивание карточки в другую колонку меняет статус
 * (PUT /todos/:id { status }). Персональные фильтры (мои / поставленные мной /
 * просроченные) — поверх того же набора, без отдельных запросов.
 */
import { FC, useMemo, useState, useCallback } from "react";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";
import { getCurrentUser } from "src/services/auth";
import { useTodoStatuses } from "src/hooks/useTodoStatuses";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import type { TDataItem } from "src/components/Table/types";
import styles from "./TaskBoard.module.scss";

// Статусы = колонки. Порядок значим (слева направо по жизненному циклу).

type Filter = "all" | "mine" | "assigned" | "overdue";

interface TodoItem {
  uuid: string;
  id: number;
  description?: string | null;
  name?: string | null;
  status: string;
  deadline?: string | null;
  executorUuid?: string | null;
  curatorUuid?: string | null;
  executor?: { username?: string; employee?: { fullName?: string } | null } | null;
  organization?: { name?: string } | null;
}

const userName = (t: TodoItem): string =>
  t.executor?.employee?.fullName || t.executor?.username || "";

/** Просрочена: срок прошёл, а статус НЕ завершающий (isFinal из справочника). */
const isOverdue = (t: TodoItem, finalCodes: Set<string>): boolean =>
  !!t.deadline && !finalCodes.has(t.status) &&
  new Date(t.deadline).getTime() < Date.now();

// ── Карточка ─────────────────────────────────────────────────────────────────
const TaskCard: FC<{ todo: TodoItem; overdue: boolean }> = ({ todo, overdue }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: todo.uuid });
  const title = (todo.description || todo.name || `#${todo.id}`).trim();
  const exec = userName(todo);

  return (
    <div
      ref={setNodeRef}
      className={`${styles.Card}${isDragging ? ` ${styles.dragging}` : ""}`}
      {...listeners}
      {...attributes}
    >
      <div className={styles.CardTitle}>{title}</div>
      <div className={styles.CardMeta}>
        <span className={`${styles.CardExecutor}${exec ? "" : ` ${styles.unassigned}`}`}>
          {exec || translate("taskNoExecutor")}
        </span>
        {todo.organization?.name && <span className={styles.CardOrg}>{todo.organization.name}</span>}
        {todo.deadline && (
          <span
            className={`${styles.Deadline}${overdue ? ` ${styles.overdue}` : ""}`}
            title={overdue ? translate("taskOverdue") : translate("taskDeadline")}
          >
            {getFormatDateOnly(String(todo.deadline))}
          </span>
        )}
      </div>
    </div>
  );
};

// ── Колонка ──────────────────────────────────────────────────────────────────
const Column: FC<{ status: string; label: string; items: TodoItem[]; finalCodes: Set<string> }> = ({ status, label, items, finalCodes }) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={`${styles.Column}${isOver ? ` ${styles.over}` : ""}`}>
      <div className={styles.ColumnHead}>
        <span>{label}</span>
        <span className={styles.ColumnCount}>{items.length}</span>
      </div>
      <div className={styles.ColumnBody}>
        {items.length === 0
          ? <div className={styles.ColumnEmpty}>{translate("taskColumnEmpty")}</div>
          : items.map((t) => <TaskCard key={t.uuid} todo={t} overdue={isOverdue(t, finalCodes)} />)}
      </div>
    </div>
  );
};

// ── Доска ────────────────────────────────────────────────────────────────────
export const TaskBoardList: FC = () => {
  const me = getCurrentUser();
  const queryClient = useQueryClient();
  // Колонки и признак «завершающий статус» — из справочника (E9.5).
  const { statuses, finalCodes } = useTodoStatuses();
  const [filter, setFilter] = useState<Filter>("all");
  const [dragId, setDragId] = useState<string | null>(null);

  // Небольшой порог, чтобы клик по карточке не считался перетаскиванием.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data, isLoading, isError } = useQuery({
    queryKey: ["todos", "board"],
    queryFn: async () => {
      const r = await apiClient.get<{ items?: TodoItem[] }>("todos", { params: { limit: 500 } });
      return r.data?.items ?? [];
    },
    staleTime: 15_000,
  });

  // Смена статуса перетаскиванием — оптимистично, с откатом при ошибке.
  const mutate = useMutation({
    mutationFn: async ({ uuid, status }: { uuid: string; status: string }) =>
      apiClient.put(`todos/${uuid}`, { status }),
    onMutate: async ({ uuid, status }) => {
      await queryClient.cancelQueries({ queryKey: ["todos", "board"] });
      const prev = queryClient.getQueryData<TodoItem[]>(["todos", "board"]);
      queryClient.setQueryData<TodoItem[]>(["todos", "board"], (old) =>
        (old ?? []).map((t) => (t.uuid === uuid ? { ...t, status } : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["todos", "board"], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

  const all = data ?? [];

  // Персональный фильтр — поверх загруженного набора, без доп. запросов.
  const filtered = useMemo(() => {
    const uid = me?.uuid;
    switch (filter) {
      case "mine": return all.filter((t) => t.executorUuid === uid);
      case "assigned": return all.filter((t) => t.curatorUuid === uid);
      case "overdue": return all.filter((t) => isOverdue(t, finalCodes));
      default: return all;
    }
  }, [all, filter, me?.uuid, finalCodes]);

  const byStatus = useMemo(() => {
    const map: Record<string, TodoItem[]> = {};
    // Колонки — из справочника; статусы задач вне справочника (напр. удалённый
    // статус) всё равно получают колонку через ??=, чтобы задачи не пропали.
    for (const s of statuses) map[s.code] = [];
    for (const t of filtered) (map[t.status] ??= []).push(t);
    return map;
  }, [filtered, statuses]);

  const overdueCount = useMemo(() => all.filter((t) => isOverdue(t, finalCodes)).length, [all, finalCodes]);

  const onDragStart = useCallback((e: DragStartEvent) => setDragId(String(e.active.id)), []);
  const onDragEnd = useCallback((e: DragEndEvent) => {
    setDragId(null);
    const uuid = String(e.active.id);
    const target = e.over ? String(e.over.id) : null;
    if (!target) return;
    const todo = all.find((t) => t.uuid === uuid);
    if (!todo || todo.status === target) return;
    mutate.mutate({ uuid, status: target });
  }, [all, mutate]);

  const TABS: { key: Filter; labelKey: string; count?: number }[] = [
    { key: "all", labelKey: "taskFilterAll", count: all.length },
    { key: "mine", labelKey: "taskFilterMine" },
    { key: "assigned", labelKey: "taskFilterAssigned" },
    { key: "overdue", labelKey: "taskFilterOverdue", count: overdueCount },
  ];

  if (isLoading) return <div className={styles.Board}><div className={styles.Status}>{translate("loading")}</div></div>;
  if (isError) return <div className={styles.Board}><div className={styles.Status}>{translate("taskBoardError")}</div></div>;

  return (
    <div className={styles.Board}>
      <div className={styles.Toolbar}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.FilterTab}${filter === tab.key ? ` ${styles.active}` : ""}`}
            onClick={() => setFilter(tab.key)}
          >
            {translate(tab.labelKey)}
            {tab.count !== undefined && <span className={styles.Count}>{tab.count}</span>}
          </button>
        ))}
      </div>

      {all.length === 0 ? (
        <div className={styles.Status}>{translate("taskBoardEmpty")}</div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className={styles.Columns}>
            {statuses.map((st) => (
              <Column key={st.code} status={st.code} label={st.name} items={byStatus[st.code] ?? []} finalCodes={finalCodes} />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
};

// Совместимость с реестром видов (default export как у прочих моделей).
const TaskBoard = TaskBoardList;
export default TaskBoard;
