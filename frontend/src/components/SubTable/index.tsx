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
} from "react";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import { useModelDelete } from "src/hooks/useModelDelete";
import Toolbar from "src/components/Toolbar";
import { useQueryClient } from "@tanstack/react-query";

// ═══════════════════════════════════════════════════════════════════════════
// Типы
// ═══════════════════════════════════════════════════════════════════════════

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
  return (row as any).uuid || String((row as any).id);
}

/**
 * Мерж серверных строк с pending-строками (update/delete/create).
 * Возвращает объединённый массив.
 */
function mergeServerWithPending(serverItems: TDataItem[], pendingRows: TDataItem[]): TDataItem[] {
  const serverUuidSet = new Set(serverItems.map((r: any) => r.uuid).filter(Boolean));
  const merged: TDataItem[] = [];

  // 1. Обходим серверные строки: если есть pending update/delete — подставляем его
  for (const item of serverItems) {
    const pendingRow = pendingRows.find((p: any) =>
      p._pendingAction && p._pendingAction !== "create" &&
      ((p.uuid && p.uuid === (item as any).uuid) || p.id === (item as any).id)
    );
    merged.push(pendingRow ?? item);
  }

  // 2. Добавляем temp-строки (create), которых нет на сервере
  for (const p of pendingRows) {
    if ((p as any)._pendingAction === "create" && !serverUuidSet.has((p as any).uuid)) {
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
  const params = useMemo(() => ({
    sort, filter,
    extra: parentUuid ? { [parentKey]: parentUuid, ...(extraQueryParams ?? {}) } : undefined,
  }), [sort, filter, parentUuid, parentKey, extraQueryParams]);

  const { allItems, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage, cancelAllRequests, dataUpdatedAt } =
    useInfiniteModelList<TDataItem>({ model, params, queryOptions: { enabled: !!parentUuid } });

  const handleDeleteRaw = useModelDelete(model, refetch);

  // temp id counter for local rows (negative ids)
  // Инициализируем СИНХРОННО: если есть initialPendingRows с отрицательными id —
  // ставим счётчик ниже минимума, чтобы новые строки не получали дублирующиеся ключи.
  const tempIdRef = useRef(
    deferRemoteChanges && initialPendingRows?.length
      ? Math.min(-1, Math.min(...initialPendingRows.map((r: any) => (typeof r.id === "number" ? r.id : 0))) - 1)
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
        .filter((r: any) => !(typeof r.id === "number" && r.id < 0) && !(typeof r.uuid === "string" && r.uuid.startsWith("tmp-")))
        .map((r: any) => {
          if (r._pendingAction) {
            const { _pendingAction, _untouched, ...rest } = r;
            return rest;
          }
          return r;
        });
      setCacheVersion(v => v + 1);

      // Принудительно запрашиваем свежие данные с сервера.
      // Не полагаемся на setTimeout(invalidateQueries) в родителе — SubTable
      // сам гарантирует обновление кэша после коммита.
      queryClient.invalidateQueries({ queryKey: [model] });
    }
  }, [deferRemoteChanges, initialPendingRows, queryClient, model]);

  // Обёртка для delete — показывает спиннер во время удаления
  const handleDelete = useCallback(async (selectedRowIds: Set<number>, tableRows: TDataItem[]) => {
    if (deferRemoteChanges) {
      const toDelete = new Set<number>(selectedRowIds as Set<number>);
      cachedRowsRef.current = cachedRowsRef.current.map((r: any) => {
        if (!r) return r;
        if (toDelete.has(r.id)) {
          if (r._pendingAction === "create") return null; // убрать созданную локально запись
          return { ...r, _pendingAction: "delete" };
        }
        return r;
      }).filter(Boolean);
      // Очищаем ошибки валидации для удалённых строк
      setCellErrors(prev => {
        const next = { ...prev };
        for (const id of toDelete) {
          const row = tableRows.find((r: any) => r.id === id);
          if (row) delete next[getRowId(row)];
        }
        return next;
      });
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current as TDataItem[]);
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
  const notifyParent = useCallback((items: TDataItem[]) => {
    if (!onItemsChangeRef.current) return;
    const filtered = items.filter((r: any) => !r._untouched);
    onItemsChangeRef.current(filtered);
  }, []);

  // ── Кэширование строк ─────────────────────────────────────────────────
  const cachedRowsRef = useRef<TDataItem[]>([]);
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
    const clean = allItems.filter((r: any) =>
      !(typeof r.id === "number" && r.id < 0) && !(typeof r.uuid === "string" && r.uuid.startsWith("tmp-"))
    );

    const prev = cachedRowsRef.current;
    // Собираем dirty-строки, исключая «нетронутые» (новые пустые строки — не были отредактированы)
    const dirtyRows = deferRemoteChanges
      ? prev.filter((r: any) => r._pendingAction && !r._untouched)
      : [];

    // Если есть pending-строки при deferRemoteChanges — мержим с серверными данными,
    // чтобы не потерять локальные изменения при invalidateQueries (например после
    // сохранения формы открытой из SubTable в режиме "Редактирование в форме").
    if (dirtyRows.length > 0) {
      const merged = mergeServerWithPending(clean, dirtyRows);

      cachedRowsRef.current = merged;
      setCacheVersion(v => v + 1);
      // Оповещаем родителя — данные могли обновиться на сервере
      notifyParent(merged);
      return;
    }

    // Нет pending-строк — чистая замена кэша
    const hadDirtyRows = prev.some((r: any) => r._pendingAction);
    const countChanged = prev.length !== clean.length;
    // Сравниваем содержимое: проверяем id, uuid и все скалярные поля (deep compare).
    // Ранее сравнивались только id/uuid, что пропускало обновления содержимого строк.
    const contentChanged = countChanged || prev.some((r: any, i: number) => {
      const c = clean[i] as any;
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
        (r: any) => !r._pendingAction,
      );
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current as TDataItem[]);
    }

    // invalidateQueries помечает кэш как stale и автоматически вызывает refetch
    // для активного (mounted) query — ручной refetch() НЕ нужен, иначе будет два запроса.
    // Кэш cachedRowsRef НЕ сбрасываем — useEffect на [allItems] обновит его когда придут новые данные,
    // а пока пользователь видит предыдущие строки вместо пустой таблицы.
    queryClient.invalidateQueries({ queryKey: [model] });
  }, [queryClient, updateAdaptiveLimit, cancelAllRequests, defaultSort, model, deferRemoteChanges, notifyParent]);

  // ── Inline-редактирование ──────────────────────────────────────────────
  const handleInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    // Запускаем валидацию
    const error = validateCell(row, field, value);
    const rowId = getRowId(row);
    setCellError(rowId, field, error);

    // Если режим отложенных изменений — изменяем локальную копию и помечаем строку как обновлённую
    if (deferRemoteChanges) {
      cachedRowsRef.current = cachedRowsRef.current.map((r: any) => {
        if (!r) return r;
        const idMatch = ((r.uuid && r.uuid === (row as any).uuid) || r.id === (row as any).id);
        if (idMatch) {
          const next = { ...r, [field]: value };
          if (next._pendingAction !== "create") next._pendingAction = "update";
          // Строка была отредактирована — снимаем маркер «нетронутая»
          delete next._untouched;
          return next;
        }
        return r;
      });
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current as TDataItem[]);
      return;
    }

    // В режиме немедленного сохранения — если есть ошибка валидации, не отправляем на сервер
    if (error) return;

    if (!row.uuid) return;

    // Оптимистичный локальный апдейт — немедленный отклик UI без мигания
    cachedRowsRef.current = cachedRowsRef.current.map((r: any) => {
      if (!r) return r;
      const idMatch = ((r.uuid && r.uuid === (row as any).uuid) || r.id === (row as any).id);
      return idMatch ? { ...r, [field]: value } : r;
    });
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
    } catch (err: any) {
      // Сервер вернул ошибку — откатываем через refetch и показываем ошибку в ячейке
      const serverError = err.response?.data?.message || "Ошибка сохранения";
      setCellError(rowId, field, serverError);
      refetch();
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

    cachedRowsRef.current = cachedRowsRef.current.map((r: any) => {
      if (!r) return r;
      const idMatch = ((r.uuid && r.uuid === (row as any).uuid) || r.id === (row as any).id);
      if (idMatch) {
        const next = { ...r, ...patch };
        if (next._pendingAction !== "create") next._pendingAction = "update";
        // Строка была отредактирована — снимаем маркер «нетронутая»
        delete next._untouched;
        return next;
      }
      return r;
    });
    setCacheVersion(v => v + 1);
    notifyParent(cachedRowsRef.current as TDataItem[]);
  }, [validateCell, setCellError]);

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
    cachedRowsRef.current = cachedRowsRef.current.map((r: any) => {
      if (!r) return r;
      const idMatch = ((r.uuid && r.uuid === (row as any).uuid) || r.id === (row as any).id);
      return idMatch ? { ...r, [fkField]: value, ...(extraPatch ?? {}) } : r;
    });
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
    } catch (err: any) {
      const serverError = err.response?.data?.message || "Ошибка сохранения";
      const rowId = getRowId(row);
      setCellError(rowId, fkField, serverError);
      refetch(); // откатываем к серверному состоянию
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
    let visible = deferRemoteChanges
      ? rows.filter((r: TDataItem) => (r as any)._pendingAction !== "delete")
      : rows;

    // 2. Фильтруем по владельцу (parentKey) — защитный слой на фронтенде,
    //    даже если сервер вернул лишние строки или данные из кеша
    if (parentUuid && parentKey) {
      visible = visible.filter((r: TDataItem) => {
        const val = (r as any)[parentKey];
        // Пропускаем новые temp-строки (id < 0) — у них parentKey всегда правильный
        if (typeof (r as any).id === "number" && (r as any).id < 0) return true;
        return val === parentUuid;
      });
    }

    if (!search) return visible;
    // Если задан кастомный filterRows — используем его
    if (filterRows) return filterRows(visible, search);
    // Иначе — дефолтный поиск по всем полям строки (включая вложенные объекты)
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return visible.filter((row: TDataItem) => {
      const parts: string[] = [];
      const collect = (obj: unknown) => {
        if (obj == null) return;
        if (typeof obj === "object") {
          for (const v of Object.values(obj as Record<string, unknown>)) collect(v);
        } else {
          parts.push(String(obj).toLowerCase());
        }
      };
      collect(row);
      const haystack = parts.join(" ");
      return words.every(w => haystack.includes(w));
    });
  }, [rows, search, filterRows, deferRemoteChanges, parentUuid, parentKey]);

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
      if (col.identifier === "id") return <span style={{ color: "#999", fontStyle: "italic" }}>Новый</span>;
      if (col.identifier === "uuid") return <span style={{ color: "#999", fontStyle: "italic" }}>—</span>;
    }

    // Получаем контент ячейки от кастомного renderCell или возвращаем undefined (дефолтный рендер)
    const content = renderCellProp ? renderCellProp(row, col, ctx) : undefined;

    // Проверяем наличие ошибки для этой ячейки
    const rowId = getRowId(row);
    const errorMsg = cellErrors[rowId]?.[col.identifier];
    if (errorMsg) {
      // Оборачиваем ячейку в div с красной рамкой и tooltip
      return (
        <div
          style={{
            border: "1.5px solid #e53935",
            borderRadius: 3,
            padding: "0 2px",
            margin: "-1px -2px",
            position: "relative",
            background: "rgba(229, 57, 53, 0.04)",
          }}
          title={errorMsg}
        >
          {content}
          <div style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            fontSize: 11,
            lineHeight: "14px",
            color: "#e53935",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            padding: "1px 4px",
            background: "#fff3f3",
            borderRadius: "3px 3px 0 0",
            border: "1px solid #e53935",
            borderBottom: "none",
            zIndex: 10,
            maxWidth: 250,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>{errorMsg}</div>
        </div>
      );
    }

    return content;
  }, [renderCellProp, ctx, deferRemoteChanges, cellErrors]);

  // ── handleInlineAdd wrapper ────────────────────────────────────────────
  const handleInlineAdd = useCallback(async () => {
    // Резолвим defaultNewRow: поддерживаем как объект, так и функцию (rows) => {...}
    const resolvedDefaultNewRow = typeof defaultNewRow === "function"
      ? defaultNewRow(cachedRowsRef.current as TDataItem[])
      : defaultNewRow;

    if (deferRemoteChanges) {
      // создаём локальную временную строку и не отправляем на сервер
      const tmpId = tempIdRef.current--;
      const tmpUuid = `tmp-${Date.now()}-${Math.abs(tmpId)}`;
      const newRow: any = { id: tmpId, uuid: tmpUuid, [parentKey]: parentUuid, ...(extraQueryParams ?? {}) };
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
      cachedRowsRef.current = [newRow as TDataItem, ...cachedRowsRef.current];
      setCacheVersion(v => v + 1);
      notifyParent(cachedRowsRef.current as TDataItem[]);
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
        refetch();
        setOpCount(c => c - 1);
      }
    } else if (resolvedDefaultNewRow) {
      // Стандартное добавление строки через POST с дефолтными значениями
      setOpCount(c => c + 1);
      try {
        const { default: apiClient } = await import("src/services/api/client");
        await apiClient.post(`/${model}`, { ...resolvedDefaultNewRow, [parentKey]: parentUuid, ...(extraQueryParams ?? {}) });
      } catch (err: any) {
        alert(err.response?.data?.message || "Ошибка создания записи");
      } finally {
        refetch();
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
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => {}, onLimitChange: () => {} },
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
    return (
      <div style={{ padding: "24px", color: "#999", textAlign: "center" }}>
        {emptyMessage}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>Ошибка загрузки</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">Повторить</button>
      </div></div>
    );
  }

  return <Table {...tableProps} />;
};

SubTable.displayName = "SubTable";
export default SubTable;
