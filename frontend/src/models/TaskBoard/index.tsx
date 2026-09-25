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
 *
 * E17 «Стандарт качества» (СК1):
 *   • задачи со статусом вне справочника видны — в своей колонке (board.ts), а не пропадают;
 *   • щелчок по карточке открывает задачу: порог PointerSensor отличает щелчок от перетаскивания;
 *   • значки: вид задачи, просроченная реакция на обращение («SLA»), напоминания клиента, «помощь»;
 *   • перенос в «Выполнена» без результата или в ожидание без даты контроля не проходит (правило
 *     сервера, проверяется и заранее): карточка остаётся на месте, причина — тостом и в журнале
 *     с кнопкой «Открыть задачу», и доска предлагает открыть задачу уже с выбранным статусом.
 */
import { FC, useMemo, useState, useCallback, useRef } from "react";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";
import { getCurrentUser } from "src/services/auth";
import { useTodoStatuses } from "src/hooks/useTodoStatuses";
import { useConfirm } from "src/hooks/useConfirm";
import ConfirmModal from "src/components/ConfirmModal";
import { useAppContext } from "src/app/context";
import { loadFormByEndpoint } from "src/registry/modelRegistry";
import { notify } from "src/components/TechMessages/store";
import { errorStatus, errorText, isSystemError, reportError } from "src/services/errors/route";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import { boardColumns, cardBadges, cardTitle, groupByColumn, moveError, type BoardColumn, type CardBadge } from "./board";
import styles from "./TaskBoard.module.scss";
import main from "src/styles/main.module.scss";

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
  // E17: вид, SLA и сигналы — для значков и проверки переноса.
  kind?: string | null;
  acceptedAt?: string | null;
  reactionDueAt?: string | null;
  reminderCount?: number | null;
  helpRequestedAt?: string | null;
  result?: string | null;
  nextControlAt?: string | null;
}

const BOARD_KEY = ["todos", "board"] as const;

/** Щелчок раньше этого срока после перетаскивания — отпускание карточки, а не просьба открыть её. */
const CLICK_AFTER_DRAG_MS = 300;

const userName = (t: TodoItem): string =>
  t.executor?.employee?.fullName || t.executor?.username || "";

/** Просрочена: срок прошёл, а статус НЕ завершающий (isFinal из справочника). */
const isOverdue = (t: TodoItem, finalCodes: ReadonlySet<string>): boolean =>
  !!t.deadline && !finalCodes.has(t.status) &&
  new Date(t.deadline).getTime() < Date.now();

const TONE_CLASS: Record<CardBadge["tone"], string> = {
  info: styles.badgeInfo,
  danger: styles.badgeDanger,
  warning: styles.badgeWarning,
  accent: styles.badgeAccent,
};

// ── Карточка ─────────────────────────────────────────────────────────────────
const TaskCard: FC<{ todo: TodoItem; overdue: boolean; badges: CardBadge[]; onOpen: (t: TodoItem) => void }> = ({ todo, overdue, badges, onOpen }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: todo.uuid });
  const title = cardTitle(todo);
  const exec = userName(todo);

  return (
    <div
      ref={setNodeRef}
      className={`${styles.Card}${isDragging ? ` ${styles.dragging}` : ""}`}
      {...listeners}
      {...attributes}
      title={translate("taskCardOpenHint")}
      // Сенсор перетаскивания срабатывает только после сдвига на 5px — простой щелчок до него не доходит.
      onClick={() => onOpen(todo)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(todo); }
      }}
    >
      {badges.length > 0 && (
        <div className={styles.CardBadges}>
          {badges.map((b) => (
            <span key={b.id} className={`${styles.Badge} ${TONE_CLASS[b.tone]}`} title={b.title}>{b.label}</span>
          ))}
        </div>
      )}
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
const Column: FC<{ column: BoardColumn; items: TodoItem[]; finalCodes: ReadonlySet<string>; onOpen: (t: TodoItem) => void }> = ({ column, items, finalCodes, onOpen }) => {
  // В колонку статуса вне справочника бросать нельзя: она только показывает задачи, которые иначе
  // пропали бы с доски. Пустой код — служебный идентификатор (у dnd-kit он должен быть непустым).
  const { setNodeRef, isOver } = useDroppable({ id: column.code || "__no_status", disabled: !column.known });
  const now = Date.now();
  return (
    <div
      ref={setNodeRef}
      className={[styles.Column, isOver ? styles.over : "", column.known ? "" : styles.unknown].filter(Boolean).join(" ")}
    >
      <div className={styles.ColumnHead} title={column.known ? undefined : translate("taskStatusUnknownHint")}>
        <span>{column.label}</span>
        <span className={styles.ColumnCount}>{items.length}</span>
      </div>
      <div className={styles.ColumnBody}>
        {items.length === 0
          ? <div className={styles.ColumnEmpty}>{translate("taskColumnEmpty")}</div>
          : items.map((t) => (
            <TaskCard key={t.uuid} todo={t} overdue={isOverdue(t, finalCodes)} badges={cardBadges(t, finalCodes, now)} onOpen={onOpen} />
          ))}
      </div>
    </div>
  );
};

// ── Доска ────────────────────────────────────────────────────────────────────
export const TaskBoardList: FC = () => {
  const me = getCurrentUser();
  const queryClient = useQueryClient();
  const { windows: { addPane } } = useAppContext();
  // Колонки и признаки «завершающий»/«ожидание» — из справочника (E9.5, E17).
  const { statuses, finalCodes, isLoading: statusesLoading } = useTodoStatuses();
  const { confirm, confirmState } = useConfirm();
  const [filter, setFilter] = useState<Filter>("all");
  const lastDragEndRef = useRef(0);

  // Небольшой порог, чтобы клик по карточке не считался перетаскиванием.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data, isLoading, isError } = useQuery({
    queryKey: BOARD_KEY,
    queryFn: async () => {
      const r = await apiClient.get<{ items?: TodoItem[] }>("todos", { params: { limit: 500 } });
      return r.data?.items ?? [];
    },
    staleTime: 15_000,
  });

  const all = useMemo(() => data ?? [], [data]);

  /** Открыть задачу; с `nextStatus` форма сразу выберет статус, в который её пытались перенести. */
  const openTodo = useCallback(async (t: TodoItem, nextStatus?: string) => {
    const Form = await loadFormByEndpoint("todos");
    if (!Form) return;
    addPane({
      label: translate("TodosForm"),
      component: Form,
      data: { uuid: t.uuid, ...(nextStatus ? { nextStatus } : {}) },
      restore: { kind: "form", endpoint: "todos", uuid: t.uuid },
    });
  }, [addPane]);

  const handleOpen = useCallback((t: TodoItem) => {
    if (Date.now() - lastDragEndRef.current < CLICK_AFTER_DRAG_MS) return;
    void openTodo(t);
  }, [openTodo]);

  /**
   * Перенос не прошёл по правилу (нет результата, нет даты контроля): причина — тостом и в журнал
   * с кнопкой «Открыть задачу» (журнал её сохранит, тост — нет), затем прямой вопрос.
   */
  const offerOpen = useCallback(async (t: TodoItem, target: string, message: string) => {
    notify({
      severity: "error", text: message, source: translate("TaskBoard"),
      ref: { endpoint: "todos", uuid: t.uuid, label: cardTitle(t).slice(0, 60) },
      actions: [{ label: translate("taskOpenTask"), onClick: () => openTodo(t, target) }],
    });
    if (await confirm(translate("taskMoveOpenForm"))) void openTodo(t, target);
  }, [confirm, openTodo]);

  // Смена статуса перетаскиванием — оптимистично, с откатом при ошибке.
  const mutate = useMutation({
    mutationFn: async ({ uuid, status }: { uuid: string; status: string; todo: TodoItem }) =>
      apiClient.put(`todos/${uuid}`, { status }),
    onMutate: async ({ uuid, status }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const prev = queryClient.getQueryData<TodoItem[]>(BOARD_KEY);
      queryClient.setQueryData<TodoItem[]>(BOARD_KEY, (old) =>
        (old ?? []).map((t) => (t.uuid === uuid ? { ...t, status } : t)));
      return { prev };
    },
    onError: (err, vars, ctx) => {
      // Карточка — на прежнее место: молча «уехавшая» и вернувшаяся карточка хуже любого сообщения.
      if (ctx?.prev) queryClient.setQueryData(BOARD_KEY, ctx.prev);
      // Отказ по существу (400: правило результата/даты контроля) — с предложением открыть задачу;
      // сбой сети или сервера, отказ в правах — тостом и в журнал, как везде (403 уже показан клиентом).
      if (isSystemError(errorStatus(err))) reportError(err, { source: translate("TaskBoard") });
      else void offerOpen(vars.todo, vars.status, errorText(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

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

  // Колонки: справочник + статусы задач вне него (каждая задача видна ровно в одной колонке).
  const columns = useMemo(() => boardColumns(statuses, filtered), [statuses, filtered]);
  const byStatus = useMemo(() => groupByColumn(filtered, columns), [filtered, columns]);

  const overdueCount = useMemo(() => all.filter((t) => isOverdue(t, finalCodes)).length, [all, finalCodes]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    lastDragEndRef.current = Date.now();
    const uuid = String(e.active.id);
    const target = e.over ? String(e.over.id) : null;
    if (!target) return;
    const todo = all.find((t) => t.uuid === uuid);
    if (!todo || todo.status === target) return;
    // То же правило, что у сервера, — заранее: заведомый отказ не отправляем.
    const reason = moveError(todo, target, statuses);
    if (reason) { void offerOpen(todo, target, reason); return; }
    mutate.mutate({ uuid, status: target, todo });
  }, [all, statuses, offerOpen, mutate]);

  const TABS: { key: Filter; labelKey: string; count?: number }[] = [
    { key: "all", labelKey: "taskFilterAll", count: all.length },
    { key: "mine", labelKey: "taskFilterMine" },
    { key: "assigned", labelKey: "taskFilterAssigned" },
    { key: "overdue", labelKey: "taskFilterOverdue", count: overdueCount },
  ];

  if (isLoading || statusesLoading) return <div className={styles.Board}><div className={styles.Status}>{translate("loading")}</div></div>;
  if (isError) return <div className={styles.Board}><div className={styles.Status}>{translate("taskBoardError")}</div></div>;

  return (
    <div className={styles.Board}>
      <div className={main.Toolbar}>
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
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className={styles.Columns}>
            {columns.map((c) => (
              <Column key={c.code || "__no_status"} column={c} items={byStatus[c.code] ?? []} finalCodes={finalCodes} onOpen={handleOpen} />
            ))}
          </div>
        </DndContext>
      )}
      <ConfirmModal {...confirmState} />
    </div>
  );
};

// Совместимость с реестром видов (default export как у прочих моделей).
const TaskBoard = TaskBoardList;
export default TaskBoard;
