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
}): PendingRow[] {
  const { rows, deferRemoteChanges, parentUuid, parentKey, computeRow, clientSort, sort, search, filterRows, columns } = params;

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
  const pendingCreates = clientSort ? [] : enriched.filter(isTmpRow);
  const others = pendingCreates.length ? enriched.filter(r => !isTmpRow(r)) : enriched;
  const sortedOthers = sortTableRows(others, sort);
  const sorted = pendingCreates.length ? [...sortedOthers, ...pendingCreates] : sortedOthers;

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
