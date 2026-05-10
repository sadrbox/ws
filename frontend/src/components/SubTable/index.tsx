/**
 * SubTable — универсальный компонент для вложенных таблиц (tabular part).
 *
 * Инкапсулирует весь бойлерплейт:
 *   useInfiniteModelList, кэширование строк, сортировку, фильтры,
 *   поиск, inline-editing toggle, удаление, кнопки панели.
 *
 * Потребитель задаёт только уникальную логику через пропсы.
 */
import {
  FC, useMemo, useCallback, useState, useEffect, useRef, ReactNode,
  createContext, useContext,
} from "react";
import { getModelColumns, getFormatColumnValue, getColumnAlignment, sortTableRows } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import { useModelDelete } from "src/hooks/useModelDelete";
import Toolbar from "src/components/Toolbar";
import { useQueryClient } from "@tanstack/react-query";
import styles from "./SubTable.module.scss";

// ═══════════════════════════════════════════════════════════════════════════
// Типы
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Внутренний тип строки таблицы с pending-маркерами.
 * Расширяет TDataItem полями, которые SubTable добавляет локально
 * для отслеживания несохранённых изменений (`deferRemoteChanges`).
 */
type PendingRow = TDataItem & {
  _pendingAction?: "create" | "update" | "delete";
  _untouched?: boolean;
};

/** Хелпер: безопасный каст к PendingRow (TDataItem уже типизирован, но без приватных полей) */
const asPending = (r: TDataItem): PendingRow => r as PendingRow;

/**
 * Правило валидации ячейки SubTable.
 * Функция принимает значение и строку, возвращает строку ошибки или undefined.
 */
export type TCellValidator = (value: unknown, row: TDataItem) => string | undefined;

/**
 * Карта ошибок ячеек: rowId → { field → errorMessage }.
 * rowId — строка (uuid или String(id)).
 */
export type TCellErrors = Record<string, Record<string, string>>;

export interface SubTableProps {
  /** API endpoint модели (например "saleitems", "employee-histories") */
  model: string;
  /** Ключ для columns.json (например "SaleItemsList_part") */
  componentName: string;
  /** JSON-конфиг колонок (import columnsJson from "./saleItemsColumns.json") */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columnsJson: any;
  /** Имя FK-параметра для фильтрации (например "saleUuid", "employeeUuid") */
  parentKey: string;
  /** Значение FK родителя */
  parentUuid: string;
  /** Сортировка по умолчанию */
  defaultSort?: Record<string, "asc" | "desc">;
  /** Если true — не отправлять изменения на сервер, хранить их локально в ref (используется внутри форм) */
  deferRemoteChanges?: boolean;
  /**
   * Начальные pending-строки (восстановленные из sessionStorage).
   * Используются ТОЛЬКО при deferRemoteChanges=true.
   * При первой загрузке данных с сервера эти строки мержатся с серверными.
   */
  initialPendingRows?: TDataItem[];
  /** Начальное состояние inline-editing (по умолчанию true) */
  defaultInlineEditing?: boolean;
  /** Отключить все действия (в режиме loading родителя) */
  disabled?: boolean;
  /**
   * Режим "только чтение" (права доступа).
   * Скрывает кнопки Добавить/Удалить, отключает inline-editing,
   * блокирует открытие форм редактирования.
   */
  readonly?: boolean;
  /** Сообщение если parentUuid ещё не задан */
  emptyMessage?: string;

  // ── Кастомная логика ───────────────────────────────────────────────────

  /** Кастомный renderCell — полностью контролирует рендер ячеек */
  renderCell?: (row: TDataItem, col: TColumn, ctx: SubTableContext) => ReactNode | undefined;
  /** Колбэк для открытия формы записи. Если не задан — форма не открывается */
  openFormFor?: (data: TDataItem | undefined, ctx: SubTableContext) => void;
  /** Колбэк для создания новой inline-записи */
  onInlineAdd?: (ctx: SubTableContext) => void | Promise<void>;
  /**
   * Показывать ли кнопку переключения режима редактирования (таблица ↔ форма).
   * По умолчанию true. Передайте false чтобы скрыть кнопку.
   */
  showEditModeToggle?: boolean;
  /** Дополнительные кнопки в панель (кроме toggle inline edit) */
  extraButtons?: ReactNode;
  /** Колбэк при изменении allItems (например для пересчёта суммы) */
  onItemsChange?: (items: TDataItem[]) => void;
  /**
   * Фронтенд-фильтрация строк (например для поиска по кириллическим label).
   * Вызывается с (rows, search) и возвращает отфильтрованный массив.
   * Если задан, search НЕ отправляется на сервер.
   */
  filterRows?: (rows: TDataItem[], search: string) => TDataItem[];
  /**
   * Кастомная логика inline-change (вместо стандартного PUT + refetch).
   * Если задан, SubTable не делает API-запрос, вызывая этот колбэк.
   */
  customInlineChange?: (row: TDataItem, field: string, value: string) => Promise<void>;
  /**
   * Правила валидации ячеек.
   * Ключ — identifier поля (например "quantity", "price").
   * Значение — функция-валидатор: (value, row) => errorMessage | undefined.
   * Ошибки отображаются красной рамкой вокруг ячейки + tooltip.
   */
  validationRules?: Record<string, TCellValidator>;
  /**
   * Идентификаторы полей, которые обязательны для логики/расчётов.
   * Ячейки с пустым/нулевым значением будут выделены оранжевой рамкой.
   * Пример: ["product.shortName", "quantity"]
   */
  requiredFields?: string[];
  /**
   * Дефолтные значения полей для новой строки (используется для стандартного onInlineAdd).
   * Если задан — SubTable сам обрабатывает добавление строки через POST,
   * без необходимости передавать onInlineAdd.
   * Пример: `{ quantity: 0, price: 0, productUuid: null }`
   * FK родителя (parentKey → parentUuid) добавляется автоматически.
   * Можно передать функцию `(rows) => {...}` для динамического вычисления дефолтов
   * на основе текущих строк таблицы (например, чтобы исключить уже выбранные значения).
   */
  defaultNewRow?: Record<string, unknown> | ((rows: TDataItem[]) => Record<string, unknown>);
  /**
   * Дополнительные query-параметры, которые отправляются при каждом GET-запросе
   * и добавляются к новым строкам (как дополнение к parentKey / parentUuid).
   * Пример: `{ ownerType: "organization" }`
   */
  extraQueryParams?: Record<string, string>;
  /**
   * Функция рендера содержимого раскрытой строки.
   * Если задана — SubTable поддерживает expand/collapse строк.
   * Используй ctx.toggleExpandRow и ctx.expandedRowIds в renderCell для кнопок.
   */
  renderExpandedRow?: (row: TDataItem, ctx: SubTableContext) => ReactNode;
}

/** Контекст, передаваемый в кастомные колбэки */
export interface SubTableContext {
  rows: TDataItem[];
  refetch: () => void;
  inlineEditing: boolean;
  disabled: boolean;
  /** Обновить одно скалярное поле строки (с сохранением / локально). */
  handleInlineChange: (row: TDataItem, field: string, value: string) => Promise<void>;
  /**
   * Обновить несколько полей строки ЛОКАЛЬНО (только при deferRemoteChanges).
   * Полезно для lookup-полей, где одновременно меняется FK-поле + вложенный объект.
   * Если deferRemoteChanges=false — вызывающая сторона должна использовать API напрямую.
   */
  updateLocalRow: (row: TDataItem, patch: Record<string, unknown>) => void;
  /** true если SubTable работает в режиме отложенных изменений */
  deferRemoteChanges: boolean;
  /** Текущие ошибки валидации ячеек: rowId → { field → errorMessage } */
  cellErrors: TCellErrors;
  /** Установить / снять ошибку для ячейки вручную */
  setCellError: (rowId: string, field: string, error: string | undefined) => void;
  /**
   * Стандартный хелпер для lookup-полей.
   * Автоматически выбирает deferred vs API-режим.
   *
   * select: `handleLookupChange(row, "currencyUuid", uuid, { currency: item })`
   * clear:  `handleLookupChange(row, "currencyUuid", null, { currency: null })`
   *
   * @param row       — строка таблицы
   * @param fkField   — поле FK (например "currencyUuid")
   * @param value     — uuid выбранного элемента или null (для очистки)
   * @param extraPatch — дополнительные поля для локального патча (вложенный объект и т.д.)
   */
  handleLookupChange: (
    row: TDataItem,
    fkField: string,
    value: string | null,
    extraPatch?: Record<string, unknown>,
  ) => Promise<void>;
  /** Набор rowId (uuid || String(id)) раскрытых строк */
  expandedRowIds: Set<string>;
  /** Переключить раскрытие строки */
  toggleExpandRow: (rowId: string) => void;
}

/** Получить rowId для идентификации строки в cellErrors */
function getRowId(row: TDataItem): string {
  return row.uuid || String(row.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// React Context для доступа к SubTableContext из дочерних элементов
// (например — из кнопок, переданных через extraButtons).
// ═══════════════════════════════════════════════════════════════════════════

const SubTableInternalContext = createContext<SubTableContext | null>(null);

/**
 * Хук для доступа к SubTableContext из любого компонента, отрендеренного
 * внутри SubTable (включая extraButtons). Возвращает null, если вызван
 * вне SubTable.
 */
export const useSubTableContext = (): SubTableContext | null =>
  useContext(SubTableInternalContext);

// ─── ReadOnlyCell ───────────────────────────────────────────────────────
// Универсальная ячейка «только чтение» для табличных частей. Используется:
//   - дефолтным рендером SubTable (см. ниже);
//   - кастомными *Table-компонентами (saleItems, purchaseItems и т.п.)
//     для вычисляемых/read-only колонок (lineNumber, vatAmount, amount, …).
//
// Поведение:
//   - форматирует значение с учётом column.type и локали ru-RU
//     (через `getFormatColumnValue` из Table/services);
//   - в режиме inline-editing при клике мигает красным, сигнализируя
//     пользователю, что поле не редактируется (анимация .flashReadOnly).
//
// API:
//   <ReadOnlyCell row column inlineEditing />              // значение из row[column.identifier]
//   <ReadOnlyCell value={x} column inlineEditing />        // override значения
//   <ReadOnlyCell value={x} inlineEditing />               // без column: number → ru-RU, иначе String
export interface ReadOnlyCellProps {
  /** Строка таблицы. Если задан column и не задан value — значение берётся отсюда. */
  row?: TDataItem;
  /** Колонка — для форматирования по типу (number/date/datetime/string/boolean). */
  column?: TColumn;
  /** Override значения (используется для вычисляемых полей, напр. lineNumber). */
  value?: unknown;
  /** Если true — клик запускает flash-анимацию (read-only клик в inline-режиме). */
  inlineEditing?: boolean;
}

function formatReadOnlyValue(
  value: unknown,
  row?: TDataItem,
  column?: TColumn,
): string {
  if (value === undefined && row && column) {
    return String(getFormatColumnValue(row, column));
  }
  if (value == null || value === "") return "";
  if (column) {
    // Имитируем getFormatColumnValue с подставленным значением, сохраняя
    // тип колонки (number/date/datetime/string/boolean) и локаль.
    const lastKey = column.identifier.includes(".")
      ? column.identifier.split(".").pop() ?? column.identifier
      : column.identifier;
    const synthetic = { [lastKey]: value } as unknown as TDataItem;
    return String(
      getFormatColumnValue(synthetic, { ...column, identifier: lastKey }),
    );
  }
  // Без column: единая логика для number/string.
  if (typeof value === "number") {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 }).format(
      value,
    );
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Числовая строка → форматируем по ru-RU.
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 9,
      }).format(Number(trimmed));
    }
    return value;
  }
  return String(value);
}

export const ReadOnlyCell: FC<ReadOnlyCellProps> = ({
  row,
  column,
  value,
  inlineEditing = false,
}) => {
  const [flashing, setFlashing] = useState(false);
  const display = formatReadOnlyValue(value, row, column);

  const handleClick = useCallback(() => {
    if (!inlineEditing) return;
    setFlashing(false);
    requestAnimationFrame(() => setFlashing(true));
    setTimeout(() => setFlashing(false), 600);
  }, [inlineEditing]);

  const cls = [
    styles.ReadOnlyCell,
    flashing && styles.flashReadOnly,
  ]
    .filter(Boolean)
    .join(" ");

  // Горизонтальное выравнивание: number/position → справа,
  // boolean → по центру, остальные → слева. Реализуется через
  // justify-content, т.к. .ReadOnlyCell — flex-контейнер.
  const align = column ? getColumnAlignment(column) : "left";
  const justify = align === "right" ? "flex-end"
    : align === "center" ? "center"
      : "flex-start";

  return (
    <span className={cls} onClick={handleClick} style={{ justifyContent: justify, textAlign: align }}>
      {display}
    </span>
  );
};
ReadOnlyCell.displayName = "ReadOnlyCell";

/** Сравнение по бизнес-id (uuid приоритетнее, fallback на числовой id) */
function isSameRow(a: TDataItem, b: TDataItem): boolean {
  return (!!a.uuid && a.uuid === b.uuid) || a.id === b.id;
}

/** Безопасное извлечение сообщения ошибки сервера из axios-подобного err */
function extractServerError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    return e.response?.data?.message || e.message || "Ошибка сохранения";
  }
  return "Ошибка сохранения";
}

/**
 * Мерж серверных строк с pending-строками (update/delete/create).
 * Возвращает объединённый массив.
 */
function mergeServerWithPending(serverItems: TDataItem[], pendingRows: TDataItem[]): PendingRow[] {
  const serverUuidSet = new Set(serverItems.map(r => r.uuid).filter(Boolean));
  const merged: PendingRow[] = [];

  // 1. Обходим серверные строки: если есть pending update/delete — подставляем его
  for (const item of serverItems) {
    const pendingRow = (pendingRows as PendingRow[]).find(p =>
      p._pendingAction && p._pendingAction !== "create" &&
      ((p.uuid && p.uuid === item.uuid) || p.id === item.id)
    );
    merged.push(pendingRow ?? asPending(item));
  }

  // 2. Добавляем temp-строки (create), которых нет на сервере
  for (const p of pendingRows as PendingRow[]) {
    if (p._pendingAction === "create" && !serverUuidSet.has(p.uuid)) {
      merged.unshift(p);
    }
  }

  return merged;
}

// ═══════════════════════════════════════════════════════════════════════════
// Компонент
// ═══════════════════════════════════════════════════════════════════════════

const SubTable: FC<SubTableProps> = ({
  model,
  componentName,
  columnsJson: colJson,
  parentKey,
  parentUuid,
  defaultSort = { id: "asc" },
  defaultInlineEditing = true,
  disabled = false,
  readonly = false,
  showEditModeToggle = true,
  emptyMessage = "Сохраните запись для добавления данных.",
  renderCell: renderCellProp,
  openFormFor,
  onInlineAdd: onInlineAddProp,
  extraButtons: extraButtonsProp,
  onItemsChange,
  filterRows,
  customInlineChange,
  deferRemoteChanges = false,
  initialPendingRows,
  validationRules,
  defaultNewRow,
  extraQueryParams,
  requiredFields,
  renderExpandedRow: renderExpandedRowProp,
}) => {
  const queryClient = useQueryClient();

  // ── Стабильный ref для onItemsChange (избегаем бесконечного цикла) ────
  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;

  // ── Ошибки валидации ячеек ─────────────────────────────────────────────
  const [cellErrors, setCellErrors] = useState<TCellErrors>({});
  const validationRulesRef = useRef(validationRules);
  validationRulesRef.current = validationRules;

  /** Установить / снять ошибку для одной ячейки */
  const setCellError = useCallback((rowId: string, field: string, error: string | undefined) => {
    setCellErrors(prev => {
      const next = { ...prev };
      if (error) {
        next[rowId] = { ...(next[rowId] || {}), [field]: error };
      } else {
        if (next[rowId]) {
          const { [field]: _, ...rest } = next[rowId];
          if (Object.keys(rest).length > 0) next[rowId] = rest;
          else delete next[rowId];
        }
      }
      return next;
    });
  }, []);

  /** Запустить валидацию одного поля строки — возвращает ошибку или undefined */
  const validateCell = useCallback((row: TDataItem, field: string, value: unknown): string | undefined => {
    const rules = validationRulesRef.current;
    if (!rules || !rules[field]) return undefined;
    return rules[field](value, row);
  }, []);

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(colJson, componentName, "part"));
  const [sort, setSort] = useState<Record<string, "asc" | "desc">>(defaultSort);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Record<string, { value: unknown; operator: string }> | undefined>(undefined);
  const [inlineEditing, setInlineEditing] = useState(readonly ? false : defaultInlineEditing);
  // Счётчик активных операций (add / inline-change / delete)
  const [opCount, setOpCount] = useState(0);
  const opLoading = opCount > 0;

  // ── Expand rows ────────────────────────────────────────────────────────
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const toggleExpandRow = useCallback((rowId: string) => {
    setExpandedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);

  // SubTable — вложенная таблица: поиск ВСЕГДА на фронтенде, не отправляем search на сервер
  // Фильтруем sort: не отправляем на сервер поля у которых sortable === false
  const serverSort = useMemo(() => {
    const unsortableCols = new Set(columns.filter(c => c.sortable === false).map(c => c.identifier));
    if (unsortableCols.size === 0) return sort;
    const filtered = Object.fromEntries(Object.entries(sort).filter(([k]) => !unsortableCols.has(k)));
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }, [sort, columns]);

  const params = useMemo(() => ({
    sort: serverSort, filter,
    extra: parentUuid ? { [parentKey]: parentUuid, ...(extraQueryParams ?? {}) } : undefined,
  }), [serverSort, filter, parentUuid, parentKey, extraQueryParams]);

  const { allItems, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage, cancelAllRequests, dataUpdatedAt } =
    useInfiniteModelList<TDataItem>({ model, params, queryOptions: { enabled: !!parentUuid } });

  const handleDeleteRaw = useModelDelete(model, refetch);

  // temp id counter for local rows (negative ids)
  // Инициализируем СИНХРОННО: если есть initialPendingRows с отрицательными id —
  // ставим счётчик ниже минимума, чтобы новые строки не получали дублирующиеся ключи.
  const tempIdRef = useRef(
    deferRemoteChanges && initialPendingRows?.length
      ? Math.min(-1, Math.min(...initialPendingRows.map(r => (typeof r.id === "number" ? r.id : 0))) - 1)
      : -1,
  );
  // Флаг: были ли initialPendingRows уже применены (мерж выполняется один раз)
  const pendingAppliedRef = useRef(false);

  // Сброс pendingAppliedRef когда pending очищается (после commit) —
  // это позволяет повторный мерж при следующем восстановлении из sessionStorage.
  const prevInitialPendingLenRef = useRef(initialPendingRows?.length ?? 0);
  useEffect(() => {
    const prevLen = prevInitialPendingLenRef.current;
    const curLen = initialPendingRows?.length ?? 0;
    prevInitialPendingLenRef.current = curLen;

    if (deferRemoteChanges && prevLen > 0 && curLen === 0) {
      // pending очищен после коммита — сбрасываем флаг мержа
      pendingAppliedRef.current = false;

      // Очищаем dirty-маркеры и temp-строки из кэша.
      // После коммита данные уже на сервере, а ветка B при следующем allItems
      // должна выполнить чистую замену кэша (без мержа старых dirty-строк).
      cachedRowsRef.current = cachedRowsRef.current
        .filter(r => !(typeof r.id === "number" && r.id < 0) && !(typeof r.uuid === "string" && r.uuid.startsWith("tmp-")))
        .map(r => {
          if (r._pendingAction) {
            const { _pendingAction: _a, _untouched: _u, ...rest } = r;
            return rest as PendingRow;
          }
          return r;
        });
      setCacheVersion(v => v + 1);

      // Принудительно запрашиваем свежие данные с сервера.
      // Не полагаемся на setTimeout(invalidateQueries) в родителе — SubTable
      // сам гарантирует обновление кэша после коммита.
      void queryClient.invalidateQueries({ queryKey: [model] });
    }
  }, [deferRemoteChanges, initialPendingRows, queryClient, model]);

  // Обёртка для delete — показывает спиннер во время удаления
  const handleDelete = useCallback(async (selectedRowIds: Set<number>, tableRows: TDataItem[]) => {
    if (deferRemoteChanges) {
      const toDelete = new Set<number>(selectedRowIds);
      cachedRowsRef.current = cachedRowsRef.current.map(r => {
        if (!r) return r;
        if (toDelete.has(r.id)) {
          if (r._pendingAction === "create") return null; // убрать созданную локально запись
          return { ...r, _pendingAction: "delete" as const };
        }
        return r;
      }).filter((r): r is PendingRow => r !== null);
      // Очищаем ошибки валидации для удалённых строк
      setCellErrors(prev => {
        const next = { ...prev };
        for (const id of toDelete) {
          const row = tableRows.find(r => r.id === id);
          if (row) delete next[getRowId(row)];
        }
        return next;
      });
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current);
      return;
    }
    setOpCount(c => c + 1);
    try {
      await handleDeleteRaw(selectedRowIds, tableRows);
    } finally {
      setOpCount(c => c - 1);
    }
  }, [handleDeleteRaw, deferRemoteChanges]);

  // ── Оповещение родителя об изменении данных ───────────────────────────
  // НЕ вызываем onItemsChange при каждом allItems — это вызывало бесконечный цикл,
  // т.к. onItemsChange → setFormData → re-render → onItemsChange пересоздаётся → эффект снова.
  // Вместо этого onItemsChange вызывается только при ЛОКАЛЬНЫХ изменениях (add/edit/delete/merge).

  /**
   * Оповестить родителя об изменении данных.
   * При передаче исключаем «нетронутые» строки (_untouched) —
   * новые пустые строки, которые пользователь ещё не редактировал,
   * не должны попадать в pending (sessionStorage) и не должны коммититься.
   */
  const notifyParent = useCallback((items: PendingRow[]) => {
    if (!onItemsChangeRef.current) return;
    const filtered = items.filter(r => !r._untouched);
    onItemsChangeRef.current(filtered);
  }, []);

  // ── Кэширование строк ─────────────────────────────────────────────────
  const cachedRowsRef = useRef<PendingRow[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);

  useEffect(() => {
    // ── Ветка A: мерж pending-строк из sessionStorage (один раз при восстановлении) ──
    if (deferRemoteChanges && initialPendingRows?.length && !pendingAppliedRef.current) {
      pendingAppliedRef.current = true;
      const merged = mergeServerWithPending([...allItems], initialPendingRows);

      cachedRowsRef.current = merged;
      setCacheVersion(v => v + 1);
      notifyParent(merged);
      return;
    }

    // ── Ветка B: синхронизация кэша с серверными данными ──
    // Убираем любые остаточные temp-строки (отрицательный id или uuid "tmp-...")
    const clean = allItems.filter(r =>
      !(typeof r.id === "number" && r.id < 0) && !(typeof r.uuid === "string" && r.uuid.startsWith("tmp-"))
    ) as PendingRow[];

    const prev = cachedRowsRef.current;
    // Собираем dirty-строки, исключая «нетронутые» (новые пустые строки — не были отредактированы)
    const dirtyRows: PendingRow[] = deferRemoteChanges
      ? prev.filter(r => r._pendingAction && !r._untouched)
      : [];

    // Если есть pending-строки при deferRemoteChanges — мержим с серверными данными,
    // чтобы не потерять локальные изменения при invalidateQueries (например после
    // сохранения формы открытой из SubTable в режиме "Редактирование в форме").
    // НЕ мержим если родитель уже очистил pending (initialPendingRows === []) —
    // это значит коммит прошёл успешно, серверные данные теперь авторитетны.
    if (dirtyRows.length > 0 && (initialPendingRows?.length ?? 0) > 0) {
      const merged = mergeServerWithPending(clean, dirtyRows);

      cachedRowsRef.current = merged;
      setCacheVersion(v => v + 1);
      // Оповещаем родителя — данные могли обновиться на сервере
      notifyParent(merged);
      return;
    }

    // Нет pending-строк — чистая замена кэша
    const hadDirtyRows = prev.some(r => r._pendingAction);
    const countChanged = prev.length !== clean.length;
    // Сравниваем содержимое: проверяем id, uuid и все скалярные поля (deep compare).
    // Ранее сравнивались только id/uuid, что пропускало обновления содержимого строк.
    const contentChanged = countChanged || prev.some((r, i) => {
      const c = clean[i];
      if (!c || r.id !== c.id || r.uuid !== c.uuid) return true;
      // Быстрая deep-проверка через JSON
      return JSON.stringify(r) !== JSON.stringify(c);
    });

    cachedRowsRef.current = clean;
    setCacheVersion(v => v + 1);

    // Оповещаем родителя:
    // - ВСЕГДА если были dirty-строки (чтобы родитель узнал что pending очищен)
    // - ВСЕГДА если данные реально изменились (новые/удалённые строки с сервера)
    if (deferRemoteChanges && (hadDirtyRows || contentChanged)) {
      notifyParent(clean);
    }
  }, [allItems, dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    return cachedRowsRef.current;
  }, [cacheVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Обработчики ────────────────────────────────────────────────────────
  const handleSortChange = useCallback((s: typeof sort) => {
    cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500);
    setSort(s ?? defaultSort);
  }, [updateAdaptiveLimit, defaultSort]);

  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => {
    setFilter(prev => {
      const next = { ...(prev ?? {}) };
      if (value == null || value === "") delete next[field];
      else next[field] = { value, operator };
      return Object.keys(next).length > 0 ? next : undefined;
    });
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v.trim()), []);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, []);

  const handleCleanRefresh = useCallback(() => {
    setSearch(""); setFilter(undefined); setSort(defaultSort); updateAdaptiveLimit(500);
    cancelAllRequests();
    // Сбрасываем флаг мержа pending, чтобы при повторном открытии мерж мог выполниться
    pendingAppliedRef.current = false;

    // При deferRemoteChanges — сбрасываем все несохранённые (pending) строки из кэша,
    // чтобы после refetch остались ТОЛЬКО актуальные серверные данные.
    if (deferRemoteChanges) {
      cachedRowsRef.current = cachedRowsRef.current.filter(
        r => !r._pendingAction,
      );
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current);
    }

    // invalidateQueries помечает кэш как stale и автоматически вызывает refetch
    // для активного (mounted) query — ручной refetch() НЕ нужен, иначе будет два запроса.
    // Кэш cachedRowsRef НЕ сбрасываем — useEffect на [allItems] обновит его когда придут новые данные,
    // а пока пользователь видит предыдущие строки вместо пустой таблицы.
    void queryClient.invalidateQueries({ queryKey: [model] });
  }, [queryClient, updateAdaptiveLimit, cancelAllRequests, defaultSort, model, deferRemoteChanges, notifyParent]);

  // ── Inline-редактирование ──────────────────────────────────────────────
  const handleInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    // console.log(" validateCell");
    // Запускаем валидацию
    const error = validateCell(row, field, value);
    const rowId = getRowId(row);
    setCellError(rowId, field, error);

    // Если режим отложенных изменений — изменяем локальную копию и помечаем строку как обновлённую
    if (deferRemoteChanges) {
      cachedRowsRef.current = cachedRowsRef.current.map(r => {
        if (!isSameRow(r, row)) return r;
        const next: PendingRow = { ...r, [field]: value };
        if (next._pendingAction !== "create") next._pendingAction = "update";
        // Строка была отредактирована — снимаем маркер «нетронутая»
        delete next._untouched;
        return next;
      });
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current);
      return;
    }

    // В режиме немедленного сохранения — если есть ошибка валидации, не отправляем на сервер
    if (error) return;

    if (!row.uuid) return;

    // Оптимистичный локальный апдейт — немедленный отклик UI без мигания
    cachedRowsRef.current = cachedRowsRef.current.map(r =>
      isSameRow(r, row) ? { ...r, [field]: value } : r
    );
    setCacheVersion(v => v + 1);

    setOpCount(c => c + 1);
    try {
      if (customInlineChange) {
        await customInlineChange(row, field, value);
        return;
      }
      const { default: apiClient } = await import("src/services/api/client");
      await apiClient.put(`/${model}/${row.uuid}`, { [field]: value });
      // refetch не нужен — оптимистичный кэш уже актуален
    } catch (err: unknown) {
      // Сервер вернул ошибку — откатываем через refetch и показываем ошибку в ячейке
      const serverError = extractServerError(err);
      setCellError(rowId, field, serverError);
      void refetch();
    } finally {
      setOpCount(c => c - 1);
    }
  }, [model, refetch, customInlineChange, deferRemoteChanges, validateCell, setCellError]);

  const toggleInlineEditing = useCallback(() => setInlineEditing(prev => !prev), []);

  // ── updateLocalRow — патч нескольких полей строки локально ──────────────
  const updateLocalRow = useCallback((row: TDataItem, patch: Record<string, unknown>) => {
    const rowId = getRowId(row);
    // Валидируем каждое поле из patch
    for (const [field, value] of Object.entries(patch)) {
      const error = validateCell(row, field, value);
      setCellError(rowId, field, error);
    }

    cachedRowsRef.current = cachedRowsRef.current.map(r => {
      if (!isSameRow(r, row)) return r;
      const next: PendingRow = { ...r, ...patch };
      if (next._pendingAction !== "create") next._pendingAction = "update";
      // Строка была отредактирована — снимаем маркер «нетронутая»
      delete next._untouched;
      return next;
    });
    setCacheVersion(v => v + 1);
    notifyParent(cachedRowsRef.current);
  }, [validateCell, setCellError]);

  // ── Refs для фокуса после добавления строки ──────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  // 'first' — деферред-режим (новая строка с отриц. id идёт первой при сортировке ASC)
  // 'last'  — немедленный режим (новая строка с макс. id идёт последней)
  const newRowFocusRef = useRef<'first' | 'last' | null>(null);

  useEffect(() => {
    if (!newRowFocusRef.current || !containerRef.current) return;
    const position = newRowFocusRef.current;
    newRowFocusRef.current = null;
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const allTrs = containerRef.current.querySelectorAll<HTMLElement>('tbody tr');
      if (allTrs.length === 0) return;
      const tr = position === 'first' ? allTrs[0] : allTrs[allTrs.length - 1];
      const input = tr.querySelector<HTMLInputElement>('input:not([disabled]):not([type="checkbox"])');
      if (input) {
        input.focus();
        try { input.select(); } catch { /* ignore */ }
      }
    });
  }, [cacheVersion]);

  // ── Контекст для кастомных колбэков ────────────────────────────────────
  // Используем ref для rows, чтобы ctx.rows всегда возвращал свежие данные
  // (избегаем stale closure после delete → refetch)
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // const definedModels = new Set(rowsRef.current.map(r => r.modelName).filter(Boolean));
  // const toAddModels = 
  // console.log(rowsRef.current.filter(r => r.modelName && r.modelName !== model).map(r => r.modelName));

  // Ref для cellErrors — чтобы ctx.cellErrors не вызывал пересоздание useMemo
  const cellErrorsRef = useRef(cellErrors);
  cellErrorsRef.current = cellErrors;

  // ── handleLookupChange — универсальный хелпер для lookup-полей ─────────
  const handleLookupChange = useCallback(async (
    row: TDataItem,
    fkField: string,
    value: string | null,
    extraPatch?: Record<string, unknown>,
  ) => {
    if (deferRemoteChanges) {
      updateLocalRow(row, { [fkField]: value, ...(extraPatch ?? {}) });
      return;
    }
    // Немедленный режим — оптимистичный апдейт + PUT на сервер
    if (!row.uuid) return;
    // Оптимистичный локальный апдейт — включаем relation-объекты для правильного отображения
    cachedRowsRef.current = cachedRowsRef.current.map(r =>
      isSameRow(r, row) ? { ...r, [fkField]: value, ...(extraPatch ?? {}) } : r
    );
    setCacheVersion(v => v + 1);
    setOpCount(c => c + 1);
    try {
      const { default: apiClient } = await import("src/services/api/client");
      // Включаем примитивные значения из extraPatch (числа, строки, null)
      // Вложенные объекты (relations) не отправляем на сервер
      const primitiveExtras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(extraPatch ?? {})) {
        if (v === null || typeof v !== "object") primitiveExtras[k] = v;
      }
      await apiClient.put(`/${model}/${row.uuid}`, { [fkField]: value, ...primitiveExtras });
      // refetch не нужен — оптимистичный кэш актуален
    } catch (err: unknown) {
      const serverError = extractServerError(err);
      const rowId = getRowId(row);
      setCellError(rowId, fkField, serverError);
      void refetch(); // откатываем к серверному состоянию
    } finally {
      setOpCount(c => c - 1);
    }
  }, [deferRemoteChanges, updateLocalRow, model, refetch, setCellError]);

  const ctx: SubTableContext = useMemo(() => ({
    get rows() { return rowsRef.current; },
    refetch, inlineEditing, disabled, handleInlineChange,
    updateLocalRow, deferRemoteChanges,
    get cellErrors() { return cellErrorsRef.current; },
    setCellError,
    handleLookupChange,
    expandedRowIds,
    toggleExpandRow,
  }), [refetch, inlineEditing, disabled, handleInlineChange, updateLocalRow, deferRemoteChanges, setCellError, handleLookupChange, expandedRowIds, toggleExpandRow]);

  // ── Фронтенд-фильтрация (всегда на фронте) ─────────────────────────────
  const displayRows = useMemo(() => {
    // 1. Скрываем строки, помеченные на удаление
    let visible: PendingRow[] = deferRemoteChanges
      ? rows.filter(r => r._pendingAction !== "delete")
      : rows;


    // 2. Фильтруем по владельцу (parentKey) — защитный слой на фронтенде,
    //    даже если сервер вернул лишние строки или данные из кеша
    if (parentUuid && parentKey) {
      visible = visible.filter(r => {
        // Пропускаем новые temp-строки (id < 0) — у них parentKey всегда правильный
        if (typeof r.id === "number" && r.id < 0) return true;
        return r[parentKey] === parentUuid;
      });
    }

    // 3. Применяем клиентскую сортировку: корректно обрабатывает ссылочные поля
    //    (напр. "unitOfMeasure.shortName") и pending-строки, не отправленные на сервер.
    //    sortTableRows использует getNestedValue → поддерживает dot-notation.
    const sorted = sortTableRows(visible, sort);

    if (!search) return sorted;
    // Если задан кастомный filterRows — используем его
    if (filterRows) return filterRows(sorted, search);
    // Иначе — дефолтный поиск по всем полям строки (включая вложенные объекты)
    // Нормализуем слова поиска: заменяем запятую на точку, чтобы "3,5" находило числа "3.5"
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
      .map(w => w.replace(',', '.'));
    return sorted.filter((row: TDataItem) => {
      const parts: string[] = [];
      const collect = (obj: unknown) => {
        if (obj == null) return;
        if (typeof obj === "object") {
          for (const v of Object.values(obj as Record<string, unknown>)) collect(v);
        } else {
          parts.push(String(obj as string | number | boolean).toLowerCase());
        }
      };
      collect(row);
      const haystack = parts.join(" ");
      return words.every(w => haystack.includes(w));
    });
  }, [rows, search, filterRows, deferRemoteChanges, parentUuid, parentKey, sort]);

  // console.log(displayRows)
  // ── openModelForm ─────────────────────────────────────────────────────
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    if (openFormFor) {
      openFormFor(formProps.data ?? undefined, ctx);
    }
  }, [openFormFor, ctx]);

  // ── renderCell wrapper ─────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn): ReactNode | undefined => {
    // Для несохранённых (temp) строк скрываем служебные поля id / uuid
    if (deferRemoteChanges && typeof row.id === "number" && row.id < 0) {
      if (col.identifier === "id") return <span className={styles.TempIdBadge}>Новый</span>;
      if (col.identifier === "uuid") return <span className={styles.TempIdBadge}>—</span>;
    }

    // Получаем контент ячейки от кастомного renderCell или возвращаем undefined (дефолтный рендер)
    const content = renderCellProp ? renderCellProp(row, col, ctx) : undefined;

    // Проверяем наличие ошибки для этой ячейки
    const rowId = getRowId(row);
    const errorMsg = cellErrors[rowId]?.[col.identifier];

    // Проверяем обязательность поля (только в режиме редактирования)
    const isRequired = requiredFields?.includes(col.identifier) ?? false;
    const isCellEmpty = isRequired && (() => {
      // Для вложенных идентификаторов ("product.shortName") смотрим по точке
      const parts = col.identifier.split(".");
      let val: unknown = row;
      for (const p of parts) {
        if (val == null || typeof val !== "object") return true;
        val = (val as Record<string, unknown>)[p];
      }
      return val === null || val === undefined || val === "" || val === 0;
    })();

    // Нет кастомного контента и нет ошибки и не обязательное пустое → используем дефолтный рендер Table
    if (content === undefined && !errorMsg && !isCellEmpty) return undefined;

    // Если кастомного контента нет, но есть ошибка — показываем отформатированное значение
    const displayContent = content !== undefined
      ? content
      : <ReadOnlyCell row={row} column={col} inlineEditing={inlineEditing} />;

    // ВСЕГДА оборачиваем в div когда есть кастомный контент или ошибка.
    // Постоянная структура DOM предотвращает ремонт input-ов при изменении состояния ошибки:
    // React видит одинаковый тип элемента (div) и только обновляет стили.
    const wrapClass = errorMsg
      ? `${styles.CellWrap} ${styles.CellWrap_error}`
      : isCellEmpty
        ? `${styles.CellWrap} ${styles.CellWrap_required}`
        : styles.CellWrap;
    return (
      <div className={wrapClass} title={errorMsg || undefined}>
        {displayContent}
        {errorMsg && <div className={styles.CellErrorTooltip}>{errorMsg}</div>}
      </div>
    );
  }, [renderCellProp, ctx, deferRemoteChanges, cellErrors, requiredFields]);

  // ── handleInlineAdd wrapper ────────────────────────────────────────────
  const handleInlineAdd = useCallback(async () => {
    // Резолвим defaultNewRow: поддерживаем как объект, так и функцию (rows) => {...}
    const resolvedDefaultNewRow = typeof defaultNewRow === "function"
      ? defaultNewRow(cachedRowsRef.current)
      : defaultNewRow;

    if (deferRemoteChanges) {
      // создаём локальную временную строку и не отправляем на сервер
      const tmpId = tempIdRef.current--;
      const tmpUuid = `tmp-${Date.now()}-${Math.abs(tmpId)}`;
      const newRow: PendingRow = { id: tmpId, uuid: tmpUuid, [parentKey]: parentUuid, ...(extraQueryParams ?? {}) };
      // инициализация полей из columns
      columns.forEach((c) => {
        if (!(c.identifier in newRow)) newRow[c.identifier] = c.type === "number" ? null : "";
      });
      // Применяем resolvedDefaultNewRow поверх (если задан) — чтобы дефолтные значения были в строке
      if (resolvedDefaultNewRow) {
        Object.assign(newRow, resolvedDefaultNewRow);
      }
      newRow._pendingAction = "create";
      // Маркер «нетронутая»: строка создана кнопкой «+» без пользовательских данных.
      // Снимается при первом редактировании ячейки (handleInlineChange).
      // НЕ ставим маркер если задан resolvedDefaultNewRow — там уже есть осмысленные значения,
      // строка должна сохраняться даже без дополнительного редактирования.
      if (!resolvedDefaultNewRow) {
        newRow._untouched = true;
      }
      cachedRowsRef.current = [newRow, ...cachedRowsRef.current];
      newRowFocusRef.current = 'first';
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current);
      return;
    }

    if (onInlineAddProp) {
      setOpCount(c => c + 1);
      try {
        await onInlineAddProp(ctx);
      } catch {
        // Ошибку обрабатывает сам onInlineAdd (alert и т.д.)
      } finally {
        // Всегда обновляем данные после попытки добавления строки
        void refetch();
        setOpCount(c => c - 1);
      }
    } else if (resolvedDefaultNewRow) {
      // Стандартное добавление строки через POST с дефолтными значениями
      setOpCount(c => c + 1);
      try {
        const { default: apiClient } = await import("src/services/api/client");
        await apiClient.post(`/${model}`, { ...resolvedDefaultNewRow, [parentKey]: parentUuid, ...(extraQueryParams ?? {}) });
        newRowFocusRef.current = 'last';
      } catch (err: unknown) {
        alert(extractServerError(err) || "Ошибка создания записи");
      } finally {
        void refetch();
        setOpCount(c => c - 1);
      }
    }
  }, [deferRemoteChanges, tempIdRef, columns, parentKey, parentUuid, extraQueryParams, onInlineAddProp, defaultNewRow, model, ctx, refetch]);

  // ── Кнопки ─────────────────────────────────────────────────────────────
  const extraButtons = useMemo(() => (
    <>
      {!readonly && showEditModeToggle && (
        <>
          <Toolbar.Divider />
          <Toolbar.InlineEditButton
            onClick={toggleInlineEditing}
            active={inlineEditing}
            title={inlineEditing ? "Редактирование через форму" : "Редактирование в таблице"}
          />
        </>
      )}
      {extraButtonsProp}
    </>
  ), [toggleInlineEditing, inlineEditing, extraButtonsProp, readonly, showEditModeToggle]);

  // ── Table props ────────────────────────────────────────────────────────
  const combinedLoading = isAnythingLoading || opLoading;
  const tableProps = useMemo(() => ({
    variant: "embedded" as TTableVariant,
    enableDateRange: false,
    componentName,
    rows: displayRows,
    columns,
    total: displayRows.length,
    totalPages: Math.ceil(displayRows.length / adaptiveLimit),
    isLoading: combinedLoading,
    isFetching: combinedLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => { }, onLimitChange: () => { } },
    sorting: { sort, onSortChange: handleSortChange },
    filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
    search: { value: search, onChange: handleSearch },
    actions: { openModelForm: readonly ? undefined : openModelForm, refetch: handleCleanRefresh, setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
    onDelete: handleDelete,
    extraButtons,
    inlineEditing,
    renderCell,
    onInlineAdd: !readonly && inlineEditing && (onInlineAddProp || defaultNewRow) ? handleInlineAdd : undefined,
    readonly,
    expandedRowIds: renderExpandedRowProp ? expandedRowIds : undefined,
    renderExpandedRow: renderExpandedRowProp
      ? (row: TDataItem) => renderExpandedRowProp(row, ctx)
      : undefined,
  }), [
    componentName, displayRows, columns, adaptiveLimit, combinedLoading, error,
    sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters,
    openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit,
    handleCleanRefresh, handleDelete, extraButtons, inlineEditing, renderCell, handleInlineAdd, onInlineAddProp, defaultNewRow,
    renderExpandedRowProp, expandedRowIds, ctx,
  ]);

  // ── Рендер ─────────────────────────────────────────────────────────────
  if (!parentUuid) {
    return <div className={styles.EmptyParent}>{emptyMessage}</div>;
  }

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>Ошибка загрузки</h3>
        <p>{error?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">Повторить</button>
      </div></div>
    );
  }

  return <div ref={containerRef} className={styles.SubTableHost}><SubTableInternalContext.Provider value={ctx}><Table {...tableProps} /></SubTableInternalContext.Provider></div>;
};

SubTable.displayName = "SubTable";
export default SubTable;
