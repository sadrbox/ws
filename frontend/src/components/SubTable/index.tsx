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
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { SubTableInternalContext } from "./context";
import { translate } from "src/i18";
import {
  CHECKBOX_COL_ID,
  computeNextActiveColId,
  computeNextActiveRowId,
  getCellNavDirection,
  getTableNavDirection,
} from "src/components/Table/tableKeyboardNav";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps, type TableApi } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import { useModelDelete } from "src/hooks/useModelDelete";
import { useAppContext } from "src/app/context";
import Toolbar from "src/components/Toolbar";
import { useQueryClient } from "@tanstack/react-query";
import styles from "./SubTable.module.scss";
import { getRowId, extractServerError, ReadOnlyCell, type ReadOnlyCellProps } from "./SubTableCells";
// Ре-экспорт: внешние импортируют ReadOnlyCell из "src/components/SubTable".
export { ReadOnlyCell };
export type { ReadOnlyCellProps };
import {
  applyEditMarker, computeDisplayRows, isSameRow, isUnsavedRow, type PendingRow,
} from "./rowModel";
import { useSubTableRows } from "./useSubTableRows";
import { useSubTableColumns } from "./useSubTableColumns";
import { useSubTableToolbar } from "./useSubTableToolbar";


// ═══════════════════════════════════════════════════════════════════════════
// Типы
// ═══════════════════════════════════════════════════════════════════════════

// Примитивы модели строк (PendingRow, applyEditMarker, computeDisplayRows,
// isSameRow, mergeServerWithPending) вынесены в ./rowModel — см. импорт выше.

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
  columnsJson: TColumn[];
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
   * Режим "только чтение" (Разрешения пользователей).
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
  // sourceRow — исходная НЕСОХРАНЁННАЯ строка (если форму открыли из temp-строки
  // inline-таблицы). После успешного сохранения формы её нужно убрать из таблицы
  // (ctx.removeRow(sourceRow)), иначе останется дублем рядом с созданным элементом.
  openFormFor?: (data: TDataItem | undefined, ctx: SubTableContext, sourceRow?: TDataItem) => void;
  /** Колбэк для создания новой inline-записи */
  onInlineAdd?: (ctx: SubTableContext) => void | Promise<void>;
  /**
   * Показывать ли кнопку переключения режима редактирования (таблица ↔ форма).
   * По умолчанию true. Передайте false чтобы скрыть кнопку.
   */
  showEditModeToggle?: boolean;
  /** Дополнительные кнопки в панель (кроме toggle inline edit) */
  extraButtons?: ReactNode;
  /** Если false — убирает жирное выделение строки с isPrimary=true (data-primary) */
  disablePrimaryRowHighlight?: boolean;
  /**
   * Таблица отображает чисто клиентский набор строк (инъекция через
   * initialPendingRows, parentUuid=""), а не серверную выборку. В этом режиме
   * сортировка применяется ко ВСЕМ строкам на клиенте: инъектированные create-
   * строки НЕ приклеиваются к концу (иначе сортировка «не работает»). Серверного
   * refetch нет, поэтому кэш при смене сортировки не сбрасывается.
   */
  clientSort?: boolean;
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
   * Пример: ["product.name", "quantity"]
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
  defaultNewRow?: Record<string, unknown> | ((rows: TDataItem[]) => Record<string, unknown> | null);
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
  /** Если true — кнопка «Добавить» отображается как disabled */
  disableAdd?: boolean;
  /** Если true — удаление строк недоступно (onDelete не вызывается), но редактирование разрешено */
  disableDelete?: boolean;
  /** Если true — скрыть кнопки «Добавить»/«Удалить» в тулбаре (inline-редактирование сохраняется). */
  hideAddDelete?: boolean;
  /** Если true — скрыть кнопку «Обновить» в тулбаре. */
  hideReload?: boolean;
  /** Колбэк при любом обновлении кэша строк (включая загрузку с сервера). Используется для печати. */
  onAllItemsChange?: (rows: TDataItem[]) => void;
  /** Переопределяет кнопку «Обновить» в тулбаре (вместо handleCleanRefresh). */
  onRefresh?: () => void;
  /**
   * Вычисляет дополнительные (динамические) поля строки, которые
   * отсутствуют в БД, но нужны для клиентской сортировки/фильтрации.
   * Результат мержится в строку (`{ ...row, ...computeRow(row) }`) перед
   * сортировкой в displayRows. Используется вместе с `dynamic: true` на колонке.
   */
  computeRow?: (row: TDataItem) => Partial<TDataItem>;
  /**
   * Императивный API для внешнего управления строками (см. SubTableApi).
   * Нужен, когда строки добавляются ИЗВНЕ (скан/лукап в терминале), а не кнопкой «+».
   */
  apiRef?: React.MutableRefObject<SubTableApi | null>;
  /**
   * Рендер замыкающей колонки действий строки (кнопки в ячейке, например ✕ удалить).
   * Если задан — добавляется служебная колонка `__rowActions`. По умолчанию нет.
   */
  rowActions?: (row: TDataItem, ctx: SubTableContext) => ReactNode;
  /** false — скрыть колонку чекбоксов выбора строк (напр. таблица-настройка). По умолчанию true. */
  selectable?: boolean;
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
  /**
   * Удалить ОДНУ строку (для кнопки ✕ в ячейке). deferred → create-строку убрать,
   * существующую пометить delete; иначе DELETE на сервере + refetch.
   */
  removeRow: (row: TDataItem) => void | Promise<void>;
}

/**
 * Императивный API SubTable (через проп `apiRef`) — для ВНЕШНЕГО управления
 * строками клиентской таблицы (например корзина терминала: скан добавляет строки).
 */
export interface SubTableApi {
  /** Добавить строку с готовыми данными (deferred create / POST). Возвращает строку. */
  addRow: (data?: Record<string, unknown>) => TDataItem | undefined;
  /** Удалить строку (как ctx.removeRow). */
  removeRow: (row: TDataItem) => void | Promise<void>;
  /** Обновить поля строки локально. */
  updateRow: (row: TDataItem, patch: Record<string, unknown>) => void;
  /** Очистить все строки. */
  clear: () => void;
  /** Текущие видимые строки (без delete-маркеров). */
  getRows: () => TDataItem[];
}


// ═══════════════════════════════════════════════════════════════════════════
// React-контекст SubTable (SubTableInternalContext) и хук useSubTableContext
// вынесены в ./context — чтобы этот модуль экспортировал только компоненты
// (Fast Refresh / HMR без полной перезагрузки). См. context.ts.
// ═══════════════════════════════════════════════════════════════════════════


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
  computeRow,
  disableAdd = false,
  disableDelete = false,
  hideAddDelete = false,
  hideReload = false,
  onAllItemsChange,
  onRefresh,
  disablePrimaryRowHighlight = false,
  clientSort = false,
  apiRef,
  rowActions,
  selectable = true,
}) => {
  const queryClient = useQueryClient();
  // Глобальный confirm (модалка вопроса пользователю) — для подтверждения
  // удаления при нажатии клавиши Delete.
  const { actions: { confirm } } = useAppContext();

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

  // Состав колонок (Серии/Партии появляются на лету) + служебная обёртка сеттера —
  // в хуке useSubTableColumns (синхронизация через mergeColumnDefs).
  const { columns, setColumns, setColumnsForTable } = useSubTableColumns(colJson, componentName);
  const [sort, setSort] = useState<Record<string, "asc" | "desc">>(defaultSort);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Record<string, { value: unknown; operator: string }> | undefined>(undefined);
  // Inline-режим (редактирование в таблице ↔ через форму) + доп-кнопки тулбара —
  // в useSubTableToolbar.
  const { inlineEditing, extraButtons } = useSubTableToolbar({
    readonly, disabled, showEditModeToggle, hasFormMode: !!openFormFor,
    defaultInlineEditing, extraButtons: extraButtonsProp,
  });
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
  // или dynamic === true (вычисляемые колонки, отсутствующие в БД — сортируются клиентски).
  const serverSort = useMemo(() => {
    const skip = new Set(
      columns.filter(c => c.sortable === false || c.dynamic === true).map(c => c.identifier),
    );
    if (skip.size === 0) return sort;
    const filtered = Object.fromEntries(Object.entries(sort).filter(([k]) => !skip.has(k)));
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }, [sort, columns]);

  const params = useMemo(() => ({
    sort: serverSort, filter,
    extra: parentUuid ? { [parentKey]: parentUuid, ...(extraQueryParams ?? {}) } : undefined,
  }), [serverSort, filter, parentUuid, parentKey, extraQueryParams]);

  const { allItems, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage, cancelAllRequests, dataUpdatedAt } =
    useInfiniteModelList<TDataItem>({ model, params, queryOptions: { enabled: !!parentUuid } });

  const handleDeleteRaw = useModelDelete(model, refetch);

  // ── Машина состояния строк (#5 — вынесена в useSubTableRows) ───────────
  // Кэш строк, мерж pending-строк, синхронизация с сервером и оповещение
  // родителя. Обработчики ниже патчат cachedRowsRef и вызывают
  // setCacheVersion/notifyParent, как и раньше.
  const {
    rows, cacheVersion, setCacheVersion, cachedRowsRef,
    notifyParent, tempIdRef, pendingAppliedRef,
  } = useSubTableRows({
    deferRemoteChanges, initialPendingRows, parentUuid,
    allItems, isAnythingLoading, dataUpdatedAt,
    onItemsChange, onAllItemsChange,
  });

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
  }, [handleDeleteRaw, deferRemoteChanges, cachedRowsRef, setCacheVersion, notifyParent]);

  // Удаление ОДНОЙ строки (кнопка ✕ в ячейке) — тонкая обёртка над handleDelete.
  const removeRow = useCallback((row: TDataItem) => {
    const id = typeof row.id === "number" ? row.id : NaN;
    return handleDelete(new Set<number>(Number.isNaN(id) ? [] : [id]), [row]);
  }, [handleDelete]);

  // ── Обработчики ────────────────────────────────────────────────────────
  const handleSortChange = useCallback((s: typeof sort) => {
    const next = s ?? defaultSort;
    // Сбрасываем кэш и адаптивный лимит ТОЛЬКО если изменился
    // serverSort (это приведёт к refetch). Для динамических (dynamic:true)
    // колонок serverSort не меняется — сортируем текущие строки
    // клиентски, и сброс кэша оставил бы таблицу пустой (refetch
    // не будет тригериться, т. к. params не меняются).
    const skipIds = new Set(
      columns.filter(c => c.sortable === false || c.dynamic === true).map(c => c.identifier),
    );
    const nextServerSort = Object.fromEntries(
      Object.entries(next).filter(([k]) => !skipIds.has(k)),
    );
    const prevServerSort = serverSort ?? {};
    const serverChanged = JSON.stringify(nextServerSort) !== JSON.stringify(prevServerSort);
    // Сбрасываем кэш только если реально будет серверный refetch (есть parentUuid
    // и не клиентская сортировка). Иначе (инъектированные данные, parentUuid="")
    // refetch не сработает и таблица просто опустеет.
    if (serverChanged && parentUuid && !clientSort) {
      cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500);
    }
    setSort(next);
  }, [updateAdaptiveLimit, defaultSort, columns, serverSort, parentUuid, clientSort, cachedRowsRef, setCacheVersion]);

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
  }, [queryClient, updateAdaptiveLimit, cancelAllRequests, defaultSort, model, deferRemoteChanges, notifyParent, cachedRowsRef, setCacheVersion, pendingAppliedRef]);

  // ── Inline-редактирование ──────────────────────────────────────────────
  const handleInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    // Запускаем валидацию
    const error = validateCell(row, field, value);
    const rowId = getRowId(row);
    setCellError(rowId, field, error);

    // Если режим отложенных изменений — изменяем локальную копию и помечаем строку как обновлённую
    if (deferRemoteChanges) {
      cachedRowsRef.current = cachedRowsRef.current.map(r =>
        isSameRow(r, row) ? applyEditMarker(r, { [field]: value }) : r
      );
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
  }, [model, refetch, customInlineChange, deferRemoteChanges, validateCell, setCellError, cachedRowsRef, setCacheVersion, notifyParent]);


  // ── updateLocalRow — патч нескольких полей строки локально ──────────────
  const updateLocalRow = useCallback((row: TDataItem, patch: Record<string, unknown>) => {
    const rowId = getRowId(row);
    // Валидируем каждое поле из patch
    for (const [field, value] of Object.entries(patch)) {
      const error = validateCell(row, field, value);
      setCellError(rowId, field, error);
    }

    cachedRowsRef.current = cachedRowsRef.current.map(r =>
      isSameRow(r, row) ? applyEditMarker(r, patch) : r
    );
    setCacheVersion(v => v + 1);
    notifyParent(cachedRowsRef.current);
  }, [validateCell, setCellError, cachedRowsRef, setCacheVersion, notifyParent]);

  // ── Refs для фокуса после добавления строки ──────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  /** Императивный API нижележащей Table — позволяет двигать activeRow без фокуса. */
  const tableApiRef = useRef<TableApi>(null);
  // Новая строка ВСЕГДА добавляется в конец таблицы (как в деферред-режиме,
  // так и в немедленном режиме), поэтому фокусируем последнюю строку.
  const newRowFocusRef = useRef<'first' | 'last' | null>(null);

  useEffect(() => {
    if (!newRowFocusRef.current || !containerRef.current) return;
    const position = newRowFocusRef.current;
    newRowFocusRef.current = null;
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const allTrs = Array.from(containerRef.current.querySelectorAll<HTMLElement>('tbody tr'));
      if (allTrs.length === 0) return;
      // Ищем строку с РЕДАКТИРУЕМЫМ полем (с нужного конца), пропуская строки без
      // input — например строку итогов в tbody. Первый input такой строки — это
      // первая редактируемая ячейка (для торговых документов — «Номенклатура»).
      const ordered = position === 'first' ? allTrs : allTrs.reverse();
      for (const tr of ordered) {
        const input = tr.querySelector<HTMLInputElement>('input:not([disabled]):not([type="checkbox"])');
        if (input) {
          input.focus();
          try { input.select(); } catch { /* ignore */ }
          break;
        }
      }
    });
  }, [cacheVersion]);

  // ── Контекст для кастомных колбэков ────────────────────────────────────
  // Используем ref для rows, чтобы ctx.rows всегда возвращал свежие данные
  // (избегаем stale closure после delete → refetch)
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Ref для cellErrors — чтобы ctx.cellErrors не вызывал пересоздание useMemo
  const cellErrorsRef = useRef(cellErrors);
  cellErrorsRef.current = cellErrors;

  // Ref на видимые строки — присваивается ниже, после useMemo для displayRows.
  // Используется в ctx.rows (нужен для renderCell вычисляемых колонок) и
  // в обработчике клавиатурной навигации.
  const displayRowsRef = useRef<TDataItem[]>([]);

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
  }, [deferRemoteChanges, updateLocalRow, model, refetch, setCellError, cachedRowsRef, setCacheVersion]);

  const ctx: SubTableContext = useMemo(() => ({
    // Важно: возвращаем именно displayRows (отображаемые строки в их видимом
    // порядке и с computeRow-обогащением) через ref. Это нужно чтобы
    // renderCell (напр. lineNumber) мог найти row через indexOf:
    // в сырых rows были бы другие объекты (без computeRow-полей).
    get rows() { return displayRowsRef.current; },
    refetch, inlineEditing, disabled, handleInlineChange,
    updateLocalRow, deferRemoteChanges,
    get cellErrors() { return cellErrorsRef.current; },
    setCellError,
    handleLookupChange,
    expandedRowIds,
    toggleExpandRow,
    removeRow,
  }), [refetch, inlineEditing, disabled, handleInlineChange, updateLocalRow, deferRemoteChanges, setCellError, handleLookupChange, expandedRowIds, toggleExpandRow, removeRow]);

  // ── Фронтенд-фильтрация (всегда на фронте) ─────────────────────────────
  // Конвейер отображаемых строк вынесен в чистую computeDisplayRows (см. выше),
  // useMemo лишь кеширует результат по тем же зависимостям.
  const displayRows = useMemo(
    () => computeDisplayRows({ rows, deferRemoteChanges, parentUuid, parentKey, computeRow, clientSort, sort, search, filterRows, columns }),
    [rows, search, filterRows, deferRemoteChanges, parentUuid, parentKey, sort, computeRow, columns, clientSort],
  );

  // Синхронизируем ref c актуальным displayRows (используется в ctx.rows
  // и в клавиатурном обработчике для навигации).
  displayRowsRef.current = displayRows;

  // ── openModelForm ─────────────────────────────────────────────────────
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    if (!openFormFor) return;
    let data = (formProps.data as TDataItem | undefined) ?? undefined;
    // Ссылку на ИСХОДНУЮ temp-строку сохраняем ДО санитизации: когда форма создаст
    // реальный элемент, эту несохранённую строку надо убрать из таблицы, иначе она
    // останется дублем рядом с сохранённым элементом (см. sourceRow → onSave).
    const sourceRow = isUnsavedRow(data) ? data : undefined;
    // Несохранённая (temp) строка, добавленная inline: у неё отрицательный id и
    // служебные поля (_pendingAction/_paneToken/_untouched), а uuid ещё нет.
    // Открывать её как СУЩЕСТВУЮЩУЮ запись нельзя — сервер её не знает (отсюда
    // ошибка при попытке открыть «Новую» строку в форменном режиме). Снимаем
    // служебные поля и отрицательный id, оставляя введённые значения, — форма
    // откроется как новая, с уже набранными данными.
    if (isUnsavedRow(data)) {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (k.startsWith("_")) continue;               // служебные _pendingAction/_paneToken/…
        if (k === "id" && typeof v === "number" && v < 0) continue; // temp-id
        if (k === "uuid" && typeof v === "string" && v.startsWith("tmp-")) continue; // temp-uuid
        clean[k] = v;
      }
      data = clean as TDataItem;
    }
    openFormFor(data, ctx, sourceRow);
  }, [openFormFor, ctx]);

  // ── renderCell wrapper ─────────────────────────────────────────────────
  // Возвращает ТОЛЬКО внутренний контент ячейки. error-tooltip собирает
  // Table через getCellMeta; required/error стили применяются Field-компонентами
  // через CellFieldStateScope → useCellFieldState.
  const renderCell = useCallback((row: TDataItem, col: TColumn): ReactNode | undefined => {
    // Служебная колонка действий строки (кнопки в ячейке, например ✕ удалить).
    if (col.identifier === "__rowActions") return rowActions ? rowActions(row, ctx) : null;
    // Для несохранённых (temp) строк скрываем служебные поля id / uuid
    if (deferRemoteChanges && typeof row.id === "number" && row.id < 0) {
      if (col.identifier === "id") return <span className={styles.TempIdBadge}>{translate("new")}</span>;
      if (col.identifier === "uuid") return <span className={styles.TempIdBadge}>—</span>;
    }

    const content = renderCellProp ? renderCellProp(row, col, ctx) : undefined;
    if (content !== undefined) return content;

    // Кастомного контента нет. Если у ячейки есть ошибка или требование
    // заполнения — нужно явно показать значение (ReadOnlyCell), чтобы
    // визуально различать «строка отображения сформирована» и
    // «пустая ячейка с подсветкой required». Иначе — отдаём дефолтный
    // рендер Table (getFormatColumnValue) через возврат undefined.
    const rowId = getRowId(row);
    const hasError = !!cellErrors[rowId]?.[col.identifier];
    const isRequired = requiredFields?.includes(col.identifier) ?? false;
    const isCellEmpty = isRequired && (() => {
      const parts = col.identifier.split(".");
      let val: unknown = row;
      for (const p of parts) {
        if (val == null || typeof val !== "object") return true;
        val = (val as Record<string, unknown>)[p];
      }
      return val === null || val === undefined || val === "";
    })();
    if (!hasError && !isCellEmpty) return undefined;
    return <ReadOnlyCell row={row} column={col} />;
  }, [renderCellProp, ctx, deferRemoteChanges, cellErrors, requiredFields, inlineEditing, rowActions]);

  // ── getCellMeta ────────────────────────────────────────────────────────
  // Возвращает required/error-флаги и визуальный errorTooltip. Table передаёт
  // их в CellFieldStateScope, откуда Field-компоненты читают через
  // useCellFieldState() и применяют стили на FieldWrapper.
  const getCellMeta = useCallback((row: TDataItem, col: TColumn) => {
    const rowId = getRowId(row);
    const errorMsg = cellErrors[rowId]?.[col.identifier];
    const isRequired = requiredFields?.includes(col.identifier) ?? false;
    const isCellEmpty = isRequired && (() => {
      const parts = col.identifier.split(".");
      let val: unknown = row;
      for (const p of parts) {
        if (val == null || typeof val !== "object") return true;
        val = (val as Record<string, unknown>)[p];
      }
      if (val === null || val === undefined || val === "") return true;
      const n = Number(val);
      return !isNaN(n) && n === 0;
    })();
    if (!errorMsg && !isCellEmpty) return null;
    return {
      required: !errorMsg && isCellEmpty,
      error: !!errorMsg,
      errorMessage: errorMsg || undefined,
      errorTooltip: errorMsg
        ? <div className={styles.CellErrorTooltip}>{errorMsg}</div>
        : null,
    };
  }, [cellErrors, requiredFields]);

  // ── handleInlineAdd wrapper ────────────────────────────────────────────
  const handleInlineAdd = useCallback(async () => {
    // Резолвим defaultNewRow: поддерживаем как объект, так и функцию (rows) => {...}
    const resolvedDefaultNewRow = typeof defaultNewRow === "function"
      ? defaultNewRow(cachedRowsRef.current)
      : defaultNewRow;

    if (deferRemoteChanges) {
      // Если defaultNewRow — функция и вернула null, значит добавление невозможно прямо сейчас.
      // isAddDisabled (derived) уже отключил кнопку; возврат здесь — защита от гонки.
      if (typeof defaultNewRow === "function" && resolvedDefaultNewRow === null) return;
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
      cachedRowsRef.current = [...cachedRowsRef.current, newRow];
      newRowFocusRef.current = 'last';
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
  }, [deferRemoteChanges, tempIdRef, columns, parentKey, parentUuid, extraQueryParams, onInlineAddProp, defaultNewRow, model, ctx, refetch, cachedRowsRef, setCacheVersion, notifyParent]);

  // ── Императивный API (apiRef): внешнее добавление/очистка строк ─────────
  // Нужен, когда строки приходят ИЗВНЕ (скан/лукап в терминале): initialPendingRows
  // мержится один раз, поэтому инкрементальные добавления делаем через addRow.
  const addRowExternal = useCallback((data?: Record<string, unknown>): TDataItem | undefined => {
    if (deferRemoteChanges) {
      const tmpId = tempIdRef.current--;
      const tmpUuid = `tmp-${Date.now()}-${Math.abs(tmpId)}`;
      const newRow: PendingRow = { id: tmpId, uuid: tmpUuid, [parentKey]: parentUuid, ...(extraQueryParams ?? {}) };
      columns.forEach((c) => { if (!(c.identifier in newRow)) newRow[c.identifier] = c.type === "number" ? null : ""; });
      if (data) Object.assign(newRow, data);
      newRow._pendingAction = "create"; // данные осмысленные → без _untouched (строка сохранится)
      cachedRowsRef.current = [...cachedRowsRef.current, newRow];
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current);
      return newRow;
    }
    void (async () => {
      try {
        const { default: apiClient } = await import("src/services/api/client");
        await apiClient.post(`/${model}`, { ...(data ?? {}), [parentKey]: parentUuid, ...(extraQueryParams ?? {}) });
      } catch { /* ignore */ } finally { void refetch(); }
    })();
    return undefined;
  }, [deferRemoteChanges, tempIdRef, parentKey, parentUuid, extraQueryParams, columns, model, refetch, cachedRowsRef, setCacheVersion, notifyParent]);

  const clearExternal = useCallback(() => {
    cachedRowsRef.current = cachedRowsRef.current
      .map((r): PendingRow | null => r._pendingAction === "create" ? null : { ...r, _pendingAction: "delete" })
      .filter((r): r is PendingRow => r !== null);
    setCacheVersion(v => v + 1);
    notifyParent(cachedRowsRef.current);
  }, [cachedRowsRef, setCacheVersion, notifyParent]);

  const getRowsExternal = useCallback(() => cachedRowsRef.current.filter(r => r._pendingAction !== "delete"), [cachedRowsRef]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { addRow: addRowExternal, removeRow, updateRow: updateLocalRow, clear: clearExternal, getRows: getRowsExternal };
    return () => { if (apiRef) apiRef.current = null; };
  }, [apiRef, addRowExternal, removeRow, updateLocalRow, clearExternal, getRowsExternal]);

  // ── Обработчик клавиатуры на контейнере таблицы ───────────────────────
  // Поведение (только в inline-режиме редактирования; в readonly — не работает):
  //
  //  - Insert  → добавить новую строку и сфокусировать её первое поле.
  //              Работает независимо от текущего фокуса (можно из input).
  //  - Delete  → удалить ВЫБРАННЫЕ через чекбоксы строки (с подтверждением).
  //              Внутри input не перехватываем — Delete стандартно удаляет символ.
  //  - Enter   → если фокус НЕ в input → перевести фокус в первое редактируемое
  //              поле текущей activeRow (вход в режим редактирования строки).
  //              Если фокус на последнем редактируемом поле → blur (выход из
  //              редактирования). Новых строк Enter НЕ создаёт.
  //  - ArrowUp/Down/Left/Right, Home, End, PgUp, PgDn →
  //              перемещение activeRow по строкам ТАБЛИЦЫ (без перевода фокуса
  //              на конкретное поле). Если фокус был в input — input блюрится.
  //              Left/Right работают как Up/Down (предыдущая/следующая строка) —
  //              ячеечной навигации больше нет.
  //
  // Все клавиши работают единообразно: если в данный момент пользователь печатает
  // в input, нажатие любой навигационной клавиши снимает фокус с input и двигает
  // только activeRow. Это намеренно унифицирует поведение с *List и убирает
  // прежнюю «cell-level» навигацию фокусом.
  const handleContainerKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (readonly) return;
    const target = e.target as HTMLElement | null;
    const isInputTarget = target instanceof HTMLInputElement && !target.disabled && target.type !== "checkbox";
    const isSelectTarget = target instanceof HTMLSelectElement && !target.disabled;
    const isTextAreaTarget = target instanceof HTMLTextAreaElement;
    const isLookupOpen = target?.getAttribute("aria-expanded") === "true";
    const container = containerRef.current;
    const tableApi = tableApiRef.current;
    if (!container) return;

    // ── Escape: выйти из редактирования input/textarea и вернуть фокус
    // на контейнер таблицы, чтобы клавиатурная навигация (Up/Down/Left/Right
    // /Insert/Delete/Home/End/PgUp/PgDn) продолжала работать. Без этого
    // фокус остаётся «нигде», и события клавиатуры не достигают onKeyDown.
    if (e.key === "Escape" && (isInputTarget || isTextAreaTarget || isSelectTarget)) {
      e.preventDefault();
      e.stopPropagation();
      (target as HTMLElement).blur();
      // Синхронизируем activeRow с строкой текущего input (если был).
      const tr = (target as HTMLElement).closest("tr[data-row-id]");
      const td = (target as HTMLElement).closest("td[data-col-id]");
      const rid = tr ? Number(tr.getAttribute("data-row-id")) : NaN;
      if (Number.isFinite(rid)) tableApi?.setActiveRow(rid);
      const cid = td?.getAttribute("data-col-id");
      if (cid) tableApi?.setActiveCell(cid);
      tableApi?.focusContainer();
      return;
    }

    // ── Режим «Редактирование через форму» (inlineEditing === false) ────
    // В этом режиме SubTable работает как обычный список: клавиатурное
    // редактирование ячеек отключено, но Enter на активной строке должен
    // открывать форму выбранной записи (аналог двойного клика). Остальные
    // навигационные клавиши (стрелки/Home/End/PgUp/PgDn) обрабатывает Table
    // через handleScrollKeyDown — здесь дублировать не нужно.
    if (!inlineEditing) {
      if (e.key !== "Enter") return;
      if (isInputTarget || isTextAreaTarget || isSelectTarget || isLookupOpen) return;
      const activeId = tableApi?.getActiveRow() ?? null;
      if (activeId === null) return;
      const row = displayRowsRef.current.find(r => r.id === activeId);
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      openModelForm({ data: row });
      return;
    }

    // ── Insert: добавить строку ────────────────────────────────────────
    // Если фокус в input/textarea — НЕ перехватываем (поле в фокусе должно
    // работать штатно, управление таблицей отключено). Insert работает
    // только когда фокус на контейнере таблицы.
    if (e.key === "Insert" && !isInputTarget && !isTextAreaTarget && !isSelectTarget) {
      if (!onInlineAddProp && !defaultNewRow) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        await handleInlineAdd();
        // Двойной rAF — чтобы дождаться React commit + браузерного layout.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const cont = containerRef.current;
            if (!cont) return;
            const trs = cont.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row-id]');
            const lastTr = trs[trs.length - 1];
            if (!lastTr) return;
            // Синхронизируем activeRow с новой строкой, чтобы клавиатурная
            // навигация продолжила работать корректно после редактирования.
            const ridStr = lastTr.getAttribute("data-row-id");
            const rid = ridStr ? Number(ridStr) : NaN;
            if (Number.isFinite(rid)) tableApi?.setActiveRow(rid);
            const input = lastTr.querySelector<HTMLInputElement>(
              'input:not([disabled]):not([type="checkbox"]), textarea:not([disabled])'
            );
            if (input) {
              input.focus();
              try { (input).select?.(); } catch { /* ignore */ }
            }
          });
        });
      })();
      return;
    }

    // ── Delete: удалить ВЫБРАННЫЕ чекбоксом строки (с подтверждением) ──
    // Внутри input/textarea — пропускаем (стандартное удаление символа).
    if (e.key === "Delete" && !isInputTarget && !isTextAreaTarget && !isSelectTarget) {
      const rows = displayRowsRef.current;
      if (rows.length === 0) return;
      const selectedIds = new Set<number>();
      const selectedTrs = container.querySelectorAll<HTMLTableRowElement>(
        'tbody tr[data-selected="true"][data-row-id]'
      );
      selectedTrs.forEach((tr) => {
        const id = Number(tr.getAttribute("data-row-id"));
        if (Number.isFinite(id)) selectedIds.add(id);
      });
      if (selectedIds.size === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const message = selectedIds.size === 1
          ? "Удалить выбранную строку?"
          : `Удалить выбранные строки (${selectedIds.size} шт.)?`;
        const ok = await confirm(message);
        if (!ok) return;
        await handleDelete(selectedIds, rows);
      })();
      return;
    }

    // ── Навигация по строкам/ячейкам (activeRow + activeCell) ──────────
    // Up/Down/PgUp/PgDn — перемещение activeRow (та же колонка).
    // Left/Right/Home/End — перемещение activeCell внутри текущей строки.
    //
    // ВАЖНО: если фокус в input/textarea — навигационные клавиши НЕ
    // перехватываются. Поле в фокусе должно использовать клавиши штатно
    // (каретка влево/вправо, выделение Home/End внутри текста, ввод символов).
    // Управление таблицей работает ТОЛЬКО когда фокус на контейнере таблицы
    // (после Escape или клика по строке). Это унифицирует поведение с Table.
    if (!isLookupOpen && !isInputTarget && !isTextAreaTarget && !isSelectTarget) {
      const rowDir = getTableNavDirection(e.key);
      const cellDir = getCellNavDirection(e.key);
      if (rowDir || cellDir) {
        const rows = displayRowsRef.current;
        e.preventDefault();
        e.stopPropagation();
        if (rows.length === 0) return;
        const startRowId: number | null = tableApi?.getActiveRow() ?? null;
        const startColId: string | null = tableApi?.getActiveCell() ?? null;
        if (cellDir) {
          // Колоночная навигация — строка остаётся, меняем activeCell.
          // Учитываем виртуальную колонку чекбокса (CHECKBOX_COL_ID).
          const visibleCols = columns.filter(c => c.visible !== false);
          let nextCol: string | null;
          if (cellDir === 'right' && startColId === CHECKBOX_COL_ID) {
            nextCol = visibleCols.length > 0 ? visibleCols[0].identifier : CHECKBOX_COL_ID;
          } else if (cellDir === 'left' && startColId === CHECKBOX_COL_ID) {
            nextCol = CHECKBOX_COL_ID;
          } else if (cellDir === 'left') {
            const firstVisibleId = visibleCols.length > 0 ? visibleCols[0].identifier : null;
            nextCol = startColId === firstVisibleId
              ? CHECKBOX_COL_ID
              : computeNextActiveColId(columns, startColId, cellDir);
          } else {
            nextCol = computeNextActiveColId(columns, startColId, cellDir);
          }
          if (startRowId !== null) tableApi?.setActiveRow(startRowId);
          if (nextCol !== null) tableApi?.setActiveCell(nextCol);
          tableApi?.focusContainer();
        } else if (rowDir) {
          // Построчная навигация — колонка сохраняется.
          const nextId = computeNextActiveRowId(rows, startRowId, rowDir);
          if (nextId !== null) {
            tableApi?.setActiveRow(nextId);
            if (startColId !== null) tableApi?.setActiveCell(startColId);
            tableApi?.focusContainer();
          }
        }
        return;
      }
    }

    // ── Enter: вход/выход из редактирования строки ─────────────────────
    if (e.key !== "Enter") return;
    if (isLookupOpen) return;
    // Когда фокус на select — не перехватываем Enter, браузер сам обрабатывает
    // открытие/закрытие dropdown. Попытка вмешаться заблокировала бы нативное поведение.
    if (isSelectTarget) return;

    // Хелпер: все редактируемые input-ы внутри tbody / строки.
    const collectInputs = (root: ParentNode): HTMLInputElement[] =>
      Array.from(
        root.querySelectorAll<HTMLInputElement>(
          'input:not([disabled]):not([type="checkbox"])'
        )
      );

    if (!isInputTarget) {
      // Фокус НЕ в input → войти в редактирование.
      // Логика:
      //  - activeCell задан → ищем редактируемый input/textarea в этой td.
      //    Если он есть — фокусируем его.
      //    Если в td нет редактируемого поля (computed/readonly колонка) —
      //    НИЧЕГО не открываем (поведение как у onClick на нередактируемую
      //    ячейку), но запускаем короткую визуальную индикацию «пульс»
      //    на td через атрибут data-pulse, чтобы пользователь понимал что
      //    Enter был обработан, но ячейка не редактируется.
      //  - activeCell НЕ задан → fallback: фокус на первое редактируемое
      //    поле активной строки (старое поведение «войти в редактирование»).
      const activeId = tableApi?.getActiveRow() ?? null;
      if (activeId === null) return;
      const tr = container.querySelector<HTMLTableRowElement>(
        `tbody tr[data-row-id="${activeId}"]`
      );
      if (!tr) return;
      const activeColId = tableApi?.getActiveCell() ?? null;
      if (activeColId) {
        const td = tr.querySelector<HTMLTableCellElement>(
          `td[data-col-id="${activeColId}"]`
        );
        if (!td) return;
        const cellInput = td.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          'input:not([disabled]):not([type="checkbox"]), textarea:not([disabled])'
        );
        const cellSelect = !cellInput
          ? td.querySelector<HTMLSelectElement>('select:not([disabled])')
          : null;
        e.preventDefault();
        e.stopPropagation();
        if (cellInput) {
          cellInput.focus();
          try { (cellInput as HTMLInputElement).select?.(); } catch { /* ignore */ }
        } else if (cellSelect) {
          cellSelect.focus();
        } else {
          // Нередактируемая ячейка — индикация «пульс» (data-pulse="true"),
          // снимаем атрибут после короткой задержки, чтобы CSS-анимация
          // могла отыграть ещё раз при следующем нажатии Enter.
          td.setAttribute("data-pulse", "true");
          window.setTimeout(() => td.removeAttribute("data-pulse"), 300);
        }
        return;
      }
      // Нет activeCell — старое поведение: первое редактируемое поле строки.
      const firstInput = collectInputs(tr)[0];
      if (!firstInput) return;
      e.preventDefault();
      e.stopPropagation();
      firstInput.focus();
      try { firstInput.select(); } catch { /* ignore */ }
      return;
    }

    // Фокус В input: Enter → следующее редактируемое поле в той же строке.
    // Если текущее поле последнее в строке → первое поле следующей строки
    // (пропуская строки без редактируемых полей). Если редактируемых полей
    // больше нет (последний input последней строки) → blur, чтобы вернуть
    // управление клавиатурой контейнеру таблицы.
    //
    // Ранее эта логика дублировалась в каждой *Table (SaleItemsTable и т.п.)
    // через `focusNextInRow` на каждом input'е. Теперь единое поведение
    // обеспечивается на уровне SubTable — все SubTable получают его автоматически.
    const currentTr = (target as HTMLElement).closest("tr");
    if (!currentTr) {
      // Фолбэк — старое поведение для нестандартных DOM (target не в tr).
      const allInputs = collectInputs(
        container.querySelector("tbody") ?? container
      );
      if (allInputs.length === 0) return;
      if (target !== allInputs[allInputs.length - 1]) return;
      e.preventDefault();
      e.stopPropagation();
      (target).blur();
      return;
    }

    const rowInputs = collectInputs(currentTr);
    const idxInRow = rowInputs.indexOf(target);
    // Есть следующее поле в этой же строке — перейти на него.
    if (idxInRow >= 0 && idxInRow < rowInputs.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      const next = rowInputs[idxInRow + 1];
      next.focus();
      try { next.select(); } catch { /* ignore */ }
      return;
    }

    // Поле — последнее в строке. Ищем первое редактируемое поле следующей
    // строки (с непустым списком input'ов). Если такой строки нет — blur.
    let nextTr = currentTr.nextElementSibling as HTMLElement | null;
    while (nextTr && nextTr.tagName === "TR") {
      const nextInputs = collectInputs(nextTr);
      if (nextInputs.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const first = nextInputs[0];
        // Синхронизируем activeRow с новой строкой, чтобы при последующем
        // Esc/нав. клавишах работа продолжилась с правильной строки.
        const ridStr = (nextTr as HTMLTableRowElement).getAttribute("data-row-id");
        const rid = ridStr ? Number(ridStr) : NaN;
        if (Number.isFinite(rid)) tableApi?.setActiveRow(rid);
        first.focus();
        try { first.select(); } catch { /* ignore */ }
        return;
      }
      nextTr = nextTr.nextElementSibling as HTMLElement | null;
    }

    // Редактируемых полей дальше нет — выходим из режима редактирования.
    e.preventDefault();
    e.stopPropagation();
    (target).blur();
  }, [readonly, inlineEditing, onInlineAddProp, defaultNewRow, handleInlineAdd, handleDelete, confirm, columns, openModelForm]);

  // ── Кнопки ─────────────────────────────────────────────────────────────
  // ── Table props ────────────────────────────────────────────────────────
  const combinedLoading = isAnythingLoading || opLoading;
  const tableProps = useMemo(() => ({
    variant: "embedded" as TTableVariant,
    selectable,
    enableDateRange: false,
    componentName,
    rows: disablePrimaryRowHighlight ? displayRows.map(r => ({ ...r, isPrimary: false })) : displayRows,
    // Дедуп: служебная колонка действий добавляется РОВНО один раз. Фильтруем
    // возможные ранее просочившиеся `__rowActions` (resize Table пишет columns с ней
    // в state/localStorage) — иначе колонка дублируется при изменении настроек.
    columns: rowActions
      ? [...columns.filter((c) => c.identifier !== "__rowActions"), { identifier: "__rowActions", name: "", type: "string", visible: true, inlist: false, width: "44px", minWidth: "44px", alignment: "center" } as TColumn]
      : columns,
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
    actions: { openModelForm: readonly ? undefined : openModelForm, refetch: onRefresh ?? handleCleanRefresh, setColumns: rowActions ? setColumnsForTable : setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
    onDelete: (disabled || disableDelete) ? undefined : handleDelete,
    extraButtons,
    inlineEditing,
    renderCell,
    onInlineAdd: !readonly && inlineEditing && (onInlineAddProp || defaultNewRow) ? handleInlineAdd : undefined,
    readonly,
    disableAdd,
    hideAddDelete,
    hideReload,
    expandedRowIds: renderExpandedRowProp ? expandedRowIds : undefined,
    renderExpandedRow: renderExpandedRowProp
      ? (row: TDataItem) => renderExpandedRowProp(row, ctx)
      : undefined,
    apiRef: tableApiRef,
    getCellMeta,
  }), [
    componentName, displayRows, columns, adaptiveLimit, combinedLoading, error,
    sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters,
    openModelForm, setColumns, setColumnsForTable, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit,
    handleCleanRefresh, onRefresh, handleDelete, disabled, extraButtons, inlineEditing, renderCell, getCellMeta, handleInlineAdd, onInlineAddProp, defaultNewRow,
    renderExpandedRowProp, expandedRowIds, ctx, readonly, disableAdd, disableDelete, hideAddDelete, hideReload, disablePrimaryRowHighlight, rowActions, selectable,
  ]);

  // ── Рендер ─────────────────────────────────────────────────────────────
  if (!parentUuid && !deferRemoteChanges) {
    return <div className={styles.EmptyParent}>{emptyMessage}</div>;
  }

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{translate("errorTitle")}</h3>
        <p>{error?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{translate("retry")}</button>
      </div></div>
    );
  }

  return <div ref={containerRef} className={`${styles.SubTableHost}${disabled ? ` ${styles.DisabledMode}` : ""}`} onKeyDownCapture={handleContainerKeyDown}><SubTableInternalContext.Provider value={ctx}><Table {...tableProps} /></SubTableInternalContext.Provider></div>;
};

SubTable.displayName = "SubTable";
export default SubTable;
