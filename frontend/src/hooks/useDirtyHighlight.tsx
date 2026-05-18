/**
 * useDirtyHighlight — переиспользуемый механизм визуальной подсветки
 * полей/ячеек, значения которых отличаются от последнего сохранённого
 * состояния формы.
 *
 * Архитектура (мини-API на data-атрибутах):
 *  • Корень Pane получает `data-pane-show-diff="true"` при наведении на
 *    DirtyButton (см. UI/index.tsx → setPaneShowDiff).
 *  • Поля формы (Field*) и ячейки SubTable получают `data-pane-dirty="true"`
 *    + `title="Было: …"`, если их значение расходится с saved.
 *    Для обычных полей атрибут находится на FieldWrapper / FieldTextareaWrapper.
 *    Для FieldToggle — на самом label с классом FieldToggle.
 *  • CSS-селектор `[data-pane-show-diff="true"] [data-pane-dirty="true"]`
 *    в main.module.scss даёт фоновую подсветку — без дополнительных классов.
 *
 * Передача paneId в дочерние Field* осуществляется через `PaneScopeProvider`,
 * который оборачивает контент панели в `UI/PaneItem`. Внутри SubTable
 * можно создать вложенный `PaneScopeProvider paneId={null}` чтобы
 * отключить логику form-level diff для табличных ячеек (там используется
 * собственный механизм сравнения с серверной строкой по uuid+column).
 */
import { createContext, useContext, useMemo, type FC, type ReactNode } from "react";
import { usePaneDirtyDiff } from "./useFormStore";

/** Сериализуемые data-* атрибуты + title для подсветки. */
export interface DirtyDomProps {
  "data-pane-dirty"?: "true";
  title?: string;
}

const EMPTY_PROPS: DirtyDomProps = {};

export interface PaneScopeValue {
  /** uniqId панели для подсветки полей; null = подсветка выключена. */
  paneId: string | null;
  /**
   * Явный override для текущего «слота» поля. Если задан — `useFieldDirty`
   * возвращает его как есть, игнорируя сопоставление по имени поля.
   *
   * Назначение: единый механизм `data-pane-dirty` для inline-edit ячеек
   * внутри таблиц/SubTable. Таблица знает per-cell diff (через `getCellDirty`)
   * и оборачивает ячейку в `CellDirtyScope`, чтобы вложенный Field-компонент
   * получил тот же атрибут на своём FieldWrapper / FieldTextareaWrapper / FieldToggle label,
   * что и поля формы верхнего уровня.
   */
  cellOverride?: DirtyDomProps | null;
}

const PaneScopeContext = createContext<PaneScopeValue>({ paneId: null });

export const PaneScopeProvider = ({
  paneId,
  children,
}: {
  paneId: string | null;
  children: ReactNode;
}) => {
  const value = useMemo<PaneScopeValue>(() => ({ paneId }), [paneId]);
  return (
    <PaneScopeContext.Provider value={value}>
      {children}
    </PaneScopeContext.Provider>
  );
};

/**
 * Локальный scope для одной ячейки таблицы. Внутри него `useFieldDirty`
 * вернёт переданный `value` (или `EMPTY_PROPS`, если ячейка не dirty),
 * не пытаясь сопоставлять имя поля с diff формы. Параллельно сбрасывает
 * `paneId` в `null`, чтобы избежать ложных срабатываний матчинга
 * по `endsWith(_field)` (например, `ct_shortName_<row.id>` против
 * поля формы `shortName`).
 */
export const CellDirtyScope = ({
  value,
  children,
}: {
  value: DirtyDomProps | null;
  children: ReactNode;
}) => {
  const memo = useMemo<PaneScopeValue>(
    () => ({ paneId: null, cellOverride: value ?? EMPTY_PROPS }),
    [value],
  );
  return (
    <PaneScopeContext.Provider value={memo}>
      {children}
    </PaneScopeContext.Provider>
  );
};

export const usePaneScope = (): PaneScopeValue => useContext(PaneScopeContext);

// ─── Форматирование значения для tooltip ───────────────────────────────

function formatDiffValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "number" || typeof v === "string") {
    const s = String(v);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  } catch {
    return String(v);
  }
}

/** Сериализуемые data-* атрибуты + title для подсветки. */
// (типы вынесены выше — нужны для PaneScopeValue.cellOverride)

/**
 * Хук для поля формы. Универсален:
 *   • Внутри обычной формы: сравнивает `fieldName` со списком
 *     изменённых полей из `usePaneDirtyDiff(paneId)`.
 *   • Внутри ячейки таблицы, обёрнутой в `CellDirtyScope`: возвращает
 *     явный override (per-cell diff знает Table.getCellDirty).
 *
 * Применение:
 * ```tsx
 * const dirty = useFieldDirty(name);
 * return <div className={wrapperClass} {...dirty}>…</div>;
 * ```
 */
export function useFieldDirty(fieldName: string | undefined): DirtyDomProps {
  const { paneId, cellOverride } = usePaneScope();
  // Хук usePaneDirtyDiff должен вызываться безусловно (правила хуков React).
  // Когда paneId=null — он вернёт EMPTY_DIFF, что эквивалентно «нет diff».
  const diff = usePaneDirtyDiff(paneId ?? "");
  // 1) Явный override от ячейки таблицы имеет наивысший приоритет.
  if (cellOverride !== undefined && cellOverride !== null) {
    return cellOverride;
  }
  if (!paneId || !fieldName) return EMPTY_PROPS;
  // Формы могут использовать `name="<formUid>_<fieldKey>"` для уникальности
  // HTML id между несколькими открытыми панелями. А ключи в diff.fields —
  // без префикса (`shortName`, `bin`, …). Поэтому ищем по трём стратегиям:
  //   1) точное совпадение (формы без префикса);
  //   2) суффикс после `_` (формы вида `<uuid>_<key>`);
  //   3) совпадение по хвосту имени после последнего `_` — fallback для
  //      экзотических случаев (например, ключ с точкой `address.city`).
  const tail = fieldName.includes("_")
    ? fieldName.slice(fieldName.lastIndexOf("_") + 1)
    : fieldName;
  // Не подсвечиваем технические/служебные поля (id/uuid/author и варианты).
  const tailLower = tail.toLowerCase();
  const EXCLUDE_TAILS = new Set([
    "id",
    "uuid",
    "author",
    "authorid",
    "authoruuid",
    "createdby",
    "createdbyid",
    "createdbyuuid",
  ]);
  if (EXCLUDE_TAILS.has(tailLower)) return EMPTY_PROPS;
  const entry =
    diff.fields.find((f) => f.field === fieldName) ??
    diff.fields.find((f) => fieldName.endsWith(`_${f.field}`)) ??
    diff.fields.find((f) => f.field === tail);
  if (!entry) return EMPTY_PROPS;
  return {
    "data-pane-dirty": "true",
    title: `Было: ${formatDiffValue(entry.savedValue)}`,
  };
}

/**
 * Хук для ячейки SubTable. Получает напрямую savedValue/currentValue —
 * сравнение делает вызывающий код (SubTable знает оригинальные серверные
 * строки и текущие pending-значения).
 *
 * `isDirty=true` → возвращает data-pane-dirty + title.
 * Применение:
 * ```tsx
 * const dirty = useCellDirty({ isDirty, savedValue, currentValue });
 * return <td {...dirty}>…</td>;
 * ```
 */
export function useCellDirty(params: {
  isDirty: boolean;
  savedValue: unknown;
  currentValue: unknown;
}): DirtyDomProps {
  if (!params.isDirty) return EMPTY_PROPS;
  return {
    "data-pane-dirty": "true",
    title: `Было: ${formatDiffValue(params.savedValue)}`,
  };
}

export { formatDiffValue };

// ═══════════════════════════════════════════════════════════════════════════
// CELL FIELD STATE — контекст состояния поля внутри ячейки таблицы.
// Передаёт required / error из Table → Field-компоненты, чтобы стили
// required/error применялись на FieldWrapper (не на TableBodyCell).
// ═══════════════════════════════════════════════════════════════════════════

export interface CellFieldState {
  required?: boolean;
  error?: boolean;
  errorMessage?: string;
}

const EMPTY_CELL_STATE: CellFieldState = {};
const CellFieldStateContext = createContext<CellFieldState>(EMPTY_CELL_STATE);

export const CellFieldStateScope: FC<{ value: CellFieldState; children: ReactNode }> = ({ value, children }) => (
  <CellFieldStateContext.Provider value={value}>
    {children}
  </CellFieldStateContext.Provider>
);

export const useCellFieldState = (): CellFieldState => useContext(CellFieldStateContext);
