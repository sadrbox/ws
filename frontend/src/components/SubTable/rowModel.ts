/**
 * rowModel — чистые примитивы модели строк SubTable (без React/состояния).
 *
 * Вынесено из SubTable/index.tsx (#5 — разгрузка SubTable), чтобы:
 *   • переиспользовать в хуке useSubTableRows без циклического импорта;
 *   • тестировать конвейер отображения и логику маркеров в изоляции.
 *
 * Здесь только функции «вход → выход» над строками; вся работа с состоянием
 * (кэш, эффекты синхронизации, оповещение родителя) — в useSubTableRows.
 */
import type { TColumn, TDataItem } from "src/components/Table/types";
import { sortTableRows, matchRowBySearch } from "src/components/Table/services";
import { stableStringify } from "src/utils/normalize";

/**
 * Внутренний тип строки таблицы с pending-маркерами.
 * Расширяет TDataItem полями, которые SubTable добавляет локально
 * для отслеживания несохранённых изменений (`deferRemoteChanges`).
 */
export type PendingRow = TDataItem & {
  _pendingAction?: "create" | "update" | "delete";
  _untouched?: boolean;
  /** Визуальная позиция строки (1-based) в момент отправки родителю. */
  _lineNumber?: number;
  /** Снимок исходных (чистых) значений строки — фиксируется при первом
   *  редактировании, чтобы no-op правку (изменили и вернули) не считать Dirty. */
  _baseline?: string;
};

/** Хелпер: безопасный каст к PendingRow (TDataItem уже типизирован, но без приватных полей) */
export const asPending = (r: TDataItem): PendingRow => r as PendingRow;

/**
 * Строка ещё НЕ сохранена на сервере (добавлена inline и не закоммичена).
 * Признаки: маркер _pendingAction:"create", отрицательный числовой id ИЛИ
 * uuid вида "tmp-…" (SubTable выдаёт временной строке и то, и другое).
 *
 * ВАЖНО: наличие uuid НЕ означает «существует на сервере» — временный uuid
 * тоже "tmp-…". Поэтому isEdit нельзя вычислять как `!!uuid`: иначе форма
 * попытается загрузить запись по фейковому uuid (GET /…/tmp-… → 404).
 */
export const isUnsavedRow = (r: { id?: unknown; uuid?: unknown; _pendingAction?: unknown } | null | undefined): boolean =>
  !!r && (
    r._pendingAction === "create" ||
    (typeof r.id === "number" && r.id < 0) ||
    (typeof r.uuid === "string" && r.uuid.startsWith("tmp-"))
  );

// Производные (вычисляемые) поля строки — функции от редактируемых значений,
// на сервер напрямую не пишутся. Исключаем из сравнения, иначе расхождение
// округления сервер/клиент мешало бы распознать возврат к исходным значениям.
const DERIVED_ROW_KEYS = new Set([
  "amount", "vatAmount", "amountWithoutVat", "discountAmount", "total", "sum",
]);

// Снимок скалярных «бизнес-значений» строки (без служебных _-полей, без
// relation-объектов/массивов и без производных полей) — для сравнения с исходным
// состоянием. Числовые строки нормализуются (stableStringify): "100.00" === 100.
const businessSnapshot = (row: Record<string, unknown>): string => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (k.startsWith("_") || DERIVED_ROW_KEYS.has(k)) continue;
    const v = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date)) continue;
    out[k] = v;
  }
  return stableStringify(out);
};

/**
 * Применяет patch к строке и проставляет/снимает маркер pending.
 * Если после правки скалярные значения вернулись к исходным (зафиксированным
 * при первом редактировании) — снимаем `_pendingAction`, чтобы форма не была
 * Dirty при фактически неизменённых значениях. Строки create всегда остаются
 * pending (их ещё нет на сервере).
 */
export const applyEditMarker = (r: PendingRow, patch: Record<string, unknown>): PendingRow => {
  if (r._pendingAction === "create") return { ...r, ...patch };
  // Базовый снимок: при первом редактировании = текущее (чистое) состояние строки.
  const baseline = r._pendingAction ? r._baseline : businessSnapshot(r);
  const next: PendingRow = { ...r, ...patch, _pendingAction: "update" };
  delete next._untouched;
  if (baseline != null) {
    next._baseline = baseline;
    if (businessSnapshot(next) === baseline) {
      // Значения вернулись к исходным — строка снова «чистая».
      delete next._pendingAction;
      delete next._baseline;
    }
  }
  return next;
};

/**
 * Конвейер отображаемых строк таблицы (извлечён из SubTable, #5 — useTableSortFilter):
 *   1) скрыть строки, помеченные на удаление (deferRemoteChanges);
 *   2) защитный фильтр по владельцу (parentKey === parentUuid), кроме temp-строк;
 *   3) обогащение computeRow → клиентская сортировка. Новые (несохранённые) строки
 *      приклеиваются В КОНЕЦ, чтобы только что добавленная «+» не «прыгала» — КРОМЕ
 *      режима clientSort (инъектированный набор: сортируем все строки);
 *   4) поиск (кастомный filterRows либо по видимым колонкам).
 * Чистая функция — тестируется отдельно (computeDisplayRows.test.ts).
 */
/** Ключ строки для снимка порядка: uuid (у новых — `tmp-…`), иначе id. */
export const displayRowKey = (r: TDataItem): string => String(r.uuid ?? r.id);

/**
 * Т4. СНИМОК ПОРЯДКА: строки из снимка — в запомненном порядке (правка значения их не двигает), строки, которых
 * в снимке нет (добавлены после щелчка по заголовку), — в конце.
 */
export function applyFrozenOrder<T extends TDataItem>(rows: T[], order: Map<string, number>): T[] {
  const rank = (r: T) => order.get(displayRowKey(r)) ?? 0;
  const known = rows.filter((r) => order.has(displayRowKey(r))).sort((a, b) => rank(a) - rank(b));
  const fresh = rows.filter((r) => !order.has(displayRowKey(r)));
  return [...known, ...fresh];
}

/**
 * Сортировка, уходящая на сервер. Без неё: несортируемые (`sortable: false`), вычисляемые (`dynamic`) и колонки
 * с подписью (`sortValue`, Т3) — сервер сортирует их по ключу, а таблица всё равно пересортирует по подписи,
 * так что запрос бесполезен и только сбрасывает загруженное.
 */
export function serverSortOf(
  sort: Record<string, "asc" | "desc">,
  columns: Pick<TColumn, "identifier" | "sortable" | "dynamic">[],
  sortValue?: Record<string, unknown>,
): Record<string, "asc" | "desc"> | undefined {
  const skip = new Set([
    ...columns.filter((c) => c.sortable === false || c.dynamic === true).map((c) => c.identifier),
    ...Object.keys(sortValue ?? {}),
  ]);
  if (skip.size === 0) return sort;
  const filtered = Object.fromEntries(Object.entries(sort).filter(([k]) => !skip.has(k)));
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/** В кэше есть локальные строки — новые (в т.ч. нетронутые), изменённые или помеченные на удаление (Т1). */
export const hasLocalRows = (rows: PendingRow[]): boolean => rows.some((r) => !!r._pendingAction || !!r._untouched);

/** Есть что терять: несохранённые изменения, кроме пустых нетронутых строк (Т6). */
export const hasUnsavedChanges = (rows: PendingRow[]): boolean => rows.some((r) => !!r._pendingAction && !r._untouched);

/** Группа строки: `key` — общий для группы, `order` — место внутри группы (0 — головная строка). */
export type RowGroup = { key: string; order: number };

const getNestedValue = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown> | null | undefined)?.[key], obj);

/**
 * СТРОКИ ГРУППЫ — ВМЕСТЕ. Группа встаёт на место своей первой строки в общем порядке (сортировка по колонке
 * двигает группу целиком), внутри — по `order`. Новые (ещё не сохранённые) строки группы тоже попадают к ней,
 * а не в конец таблицы. Строки без группы остаются на своих местах.
 */
export function groupDisplayRows<T extends TDataItem>(rows: T[], groupOf: (row: TDataItem) => RowGroup | null | undefined): T[] {
  const groups = new Map<string, { row: T; order: number; idx: number }[]>();
  const info = rows.map((row, idx) => {
    const g = groupOf(row);
    if (g) {
      const list = groups.get(g.key) ?? [];
      list.push({ row, order: g.order, idx });
      groups.set(g.key, list);
    }
    return g;
  });
  if (!groups.size) return rows;
  const out: T[] = [];
  const placed = new Set<string>();
  rows.forEach((row, idx) => {
    const g = info[idx];
    if (!g) { out.push(row); return; }
    if (placed.has(g.key)) return;
    placed.add(g.key);
    const list = groups.get(g.key) ?? [];
    list.sort((a, b) => a.order - b.order || a.idx - b.idx);
    for (const x of list) out.push(x.row);
  });
  return out;
}

export function computeDisplayRows(params: {
  rows: PendingRow[];
  deferRemoteChanges: boolean;
  parentUuid: string;
  parentKey: string;
  computeRow?: (row: TDataItem) => Partial<TDataItem>;
  clientSort: boolean;
  sort: Record<string, "asc" | "desc">;
  search: string;
  filterRows?: (rows: TDataItem[], search: string) => TDataItem[];
  columns: TColumn[];
  /** Значение для сортировки по колонке — вместо сырого поля (см. SubTableProps.sortValue). */
  sortValue?: Record<string, (row: TDataItem) => unknown>;
  /** Группа строки — строки группы стоят вместе (см. SubTableProps.groupRows). */
  groupRows?: (row: TDataItem) => RowGroup | null | undefined;
  /**
   * Т4: пользователь сам выбрал сортировку (щелчок по заголовку) — сортируются и новые строки, а не только
   * сохранённые. Без неё новые строки стоят в конце в порядке добавления.
   */
  sortPending?: boolean;
  /** Снимок порядка (ключ строки → позиция) с последнего щелчка: при вводе строки не переезжают. */
  frozenOrder?: Map<string, number>;
  /** Вызывается, когда снимка ещё нет: SubTable запоминает порядок до следующего щелчка или ответа сервера. */
  captureOrder?: (order: Map<string, number>) => void;
}): PendingRow[] {
  const { rows, deferRemoteChanges, parentUuid, parentKey, computeRow, clientSort, sort, search, filterRows, columns, sortValue, groupRows, sortPending, frozenOrder, captureOrder } = params;

  let visible: PendingRow[] = deferRemoteChanges
    ? rows.filter(r => r._pendingAction !== "delete")
    : rows;

  if (parentUuid && parentKey) {
    visible = visible.filter(r => {
      if (typeof r.id === "number" && r.id < 0) return true; // temp-строки — всегда свои
      return r[parentKey] === parentUuid;
    });
  }

  const enriched = computeRow ? visible.map(r => ({ ...r, ...computeRow(r) })) : visible;
  const isTmpRow = (r: PendingRow) =>
    r._pendingAction === "create" ||
    (typeof r.id === "number" && r.id < 0) ||
    (typeof r.uuid === "string" && r.uuid.startsWith("tmp-"));
  const pendingCreates = clientSort || sortPending ? [] : enriched.filter(isTmpRow);
  const others = pendingCreates.length ? enriched.filter(r => !isTmpRow(r)) : enriched;
  const getValue = sortValue
    ? (r: PendingRow, id: string) => (sortValue[id] ? sortValue[id](r) : getNestedValue(r, id))
    : undefined;
  const sortedOthers = sortTableRows(others, sort, "default", getValue);
  let flat = pendingCreates.length ? [...sortedOthers, ...pendingCreates] : sortedOthers;
  if (sortPending) {
    if (frozenOrder) flat = applyFrozenOrder(flat, frozenOrder);
    else captureOrder?.(new Map(flat.map((r, i) => [displayRowKey(r), i])));
  }
  const sorted = groupRows ? groupDisplayRows(flat, groupRows) : flat;

  if (!search) return sorted;
  if (filterRows) return filterRows(sorted, search) as PendingRow[];
  const words = search.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(',', '.'));
  const visibleCols = columns.filter(c => c.visible);
  return sorted.filter((row: TDataItem) => matchRowBySearch(row, visibleCols, words));
}

/** Сравнение по бизнес-id (uuid приоритетнее, fallback на числовой id) */
export function isSameRow(a: TDataItem, b: TDataItem): boolean {
  return (!!a.uuid && a.uuid === b.uuid) || a.id === b.id;
}

/**
 * Мерж серверных строк с pending-строками (update/delete/create).
 * Возвращает объединённый массив.
 */
export function mergeServerWithPending(serverItems: TDataItem[], pendingRows: TDataItem[]): PendingRow[] {
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

  // 2. Добавляем temp-строки (create), которых нет на сервере — В КОНЕЦ списка,
  //    чтобы новые строки всегда появлялись после последней существующей.
  for (const p of pendingRows as PendingRow[]) {
    if (p._pendingAction === "create" && !serverUuidSet.has(p.uuid)) {
      merged.push(p);
    }
  }

  return merged;
}

/**
 * Слияние нового состава колонок с текущим.
 *
 * Нужно, когда набор колонок меняется на лету (напр. «Серии»/«Партии» появляются,
 * как только в строках оказывается товар с таким учётом). Пересчитать колонки через
 * getModelColumns нельзя: при смене набора идентификаторов он считает кэш устаревшим
 * и стирает сохранённые пользователем ширины и видимость.
 *
 * Правила:
 *   • колонка была — сохраняем её ширину и видимость (настройки пользователя);
 *   • колонка новая — берём дефолты из JSON-определения;
 *   • служебные колонки (`__*`) инжектируются в рантайме, в defs их нет — переносим
 *     из текущего состава в конец.
 */
export function mergeColumnDefs(prev: TColumn[], defs: TColumn[]): TColumn[] {
  const prevById = new Map(prev.map((c) => [c.identifier, c]));
  const merged = defs.map((def) => {
    const kept = prevById.get(def.identifier);
    return kept ? { ...def, width: kept.width, visible: kept.visible } : def;
  });
  return [...merged, ...prev.filter((c) => c.identifier.startsWith("__"))];
}
