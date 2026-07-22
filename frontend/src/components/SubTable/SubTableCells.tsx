/**
 * Ячейки/хелперы табличных частей (вынесено из SubTable/index.tsx — T4).
 *   getRowId              — идентификатор строки для cellErrors;
 *   ReadOnlyCell          — универсальная ячейка «только чтение» (форматирование
 *                           по типу колонки + локаль ru-RU, флеш-подсказка в inline);
 *   extractServerError    — извлечение сообщения ошибки из axios-подобного err.
 *
 * Всё self-contained (Table/services + стили), поэтому вынос безопасен и без циклов.
 * index.tsx ре-экспортирует ReadOnlyCell — внешние импорты `from
 * "src/components/SubTable"` не меняются.
 */
import type { FC } from "react";
import { getFormatColumnValue, getColumnAlignment } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import styles from "./SubTable.module.scss";

/** Получить rowId для идентификации строки в cellErrors. */
export function getRowId(row: TDataItem): string {
  return row.uuid || String(row.id);
}

// ─── ReadOnlyCell ───────────────────────────────────────────────────────
// Универсальная ячейка «только чтение» для табличных частей. Используется
// дефолтным рендером SubTable и кастомными *Table-компонентами (saleItems и т.п.)
// для вычисляемых/read-only колонок (lineNumber, vatAmount, amount, …).
//
//   <ReadOnlyCell row column />       // значение из row[column.identifier]
//   <ReadOnlyCell value={x} column /> // override значения
//   <ReadOnlyCell value={x} />        // без column: number → ru-RU, иначе String
export interface ReadOnlyCellProps {
  /** Строка таблицы. Если задан column и не задан value — значение берётся отсюда. */
  row?: TDataItem;
  /** Колонка — для форматирования по типу (number/date/datetime/string/boolean). */
  column?: TColumn;
  /** Override значения (используется для вычисляемых полей, напр. lineNumber). */
  value?: unknown;
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
  // Примитивы, для которых String() осмысленна (boolean/bigint). Объекты,
  // функции и symbol в readonly-ячейке не отображаем — возвращаем "".
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

export const ReadOnlyCell: FC<ReadOnlyCellProps> = ({
  row,
  column,
  value,
}) => {
  const display = formatReadOnlyValue(value, row, column);
  const cls = styles.ReadOnlyCell;

  // Горизонтальное выравнивание: number/position → справа, boolean → по центру,
  // остальные → слева. Реализуется через justify-content (.ReadOnlyCell — flex).
  const align = column ? getColumnAlignment(column) : "left";
  const justify = align === "right" ? "flex-end"
    : align === "center" ? "center"
      : "flex-start";

  return (
    <span className={cls} style={{ justifyContent: justify, textAlign: align }}>
      {display}
    </span>
  );
};
ReadOnlyCell.displayName = "ReadOnlyCell";

/** Безопасное извлечение сообщения ошибки сервера из axios-подобного err. */
export function extractServerError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    return e.response?.data?.message || e.message || "Ошибка сохранения";
  }
  return "Ошибка сохранения";
}
