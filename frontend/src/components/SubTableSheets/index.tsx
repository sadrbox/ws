/**
 * SubTableSheets — облегчённая «табличная простыня» (sheet) для чтения данных.
 *
 * Подобие SubTable, но:
 *   • высота ячеек автоматическая (строка растёт под содержимое);
 *   • текст переносится и уважает \n (white-space: pre-wrap);
 *   • НЕТ колонки-чекбокса и выделения строк (только чтение);
 *   • без серверного запроса / редактирования / pending — отображает переданные
 *     `rows` как есть.
 *
 * Клиентская сортировка по клику на заголовок (если у колонки sortable !== false).
 * Значение ячейки берётся из renderCell; если он вернул undefined — из
 * getFormatColumnValue (как в обычной таблице).
 */
import { FC, ReactNode, useMemo, useState } from "react";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { sortTableRows, getFormatColumnValue, getColumnAlignment } from "src/components/Table/services";
import { getTranslateColumn } from "src/i18";
import styles from "./SubTableSheets.module.scss";

export type SheetCellRenderer = (row: TDataItem, col: TColumn) => ReactNode | undefined;

export interface SubTableSheetsProps {
  /** Конфиг колонок (как columnsJson в SubTable). */
  columns: TColumn[];
  /** Строки для отображения (только чтение). */
  rows: TDataItem[];
  /** Кастомный рендер ячейки: (row, col) => ReactNode | undefined. */
  renderCell?: SheetCellRenderer;
  /** Текст при отсутствии строк. */
  emptyMessage?: ReactNode;
  /** Начальная сортировка. */
  defaultSort?: Record<string, "asc" | "desc">;
  /** Переносить текст и тянуть высоту ячеек (по умолчанию true). */
  wrap?: boolean;
  className?: string;
}

const rowKey = (row: TDataItem, i: number): string =>
  (typeof row.uuid === "string" && row.uuid) ||
  (typeof row.id === "number" ? `id-${row.id}` : `i-${i}`);

const SubTableSheets: FC<SubTableSheetsProps> = ({
  columns,
  rows,
  renderCell,
  emptyMessage = "Нет данных",
  defaultSort,
  wrap = true,
  className,
}) => {
  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible !== false),
    [columns],
  );
  const [sort, setSort] = useState<Record<string, "asc" | "desc">>(defaultSort ?? {});

  const sortedRows = useMemo(
    () => (Object.keys(sort).length ? sortTableRows(rows, sort) : rows),
    [rows, sort],
  );

  const toggleSort = (col: TColumn) => {
    if (col.sortable === false) return;
    setSort((prev) => {
      const cur = prev[col.identifier];
      // asc → desc → нет сортировки
      const next = cur === "asc" ? "desc" : cur === "desc" ? undefined : "asc";
      return next ? { [col.identifier]: next } : {};
    });
  };

  if (!rows.length) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <table className={styles.table}>
        <thead>
          <tr>
            {visibleColumns.map((col) => {
              const sortable = col.sortable !== false;
              const dir = sort[col.identifier];
              return (
                <th
                  key={col.identifier}
                  className={styles.th}
                  style={{
                    textAlign: getColumnAlignment(col),
                    width: col.width,
                    minWidth: col.minWidth,
                    cursor: sortable ? "pointer" : "default",
                  }}
                  title={col.hint || undefined}
                  onClick={sortable ? () => toggleSort(col) : undefined}
                >
                  {getTranslateColumn(col)}
                  {dir && <span className={styles.sortArrow}>{dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr key={rowKey(row, i)}>
              {visibleColumns.map((col) => {
                const content = renderCell?.(row, col);
                return (
                  <td
                    key={col.identifier}
                    className={wrap ? styles.tdWrap : styles.td}
                    style={{ textAlign: getColumnAlignment(col) }}
                  >
                    {content !== undefined ? content : String(getFormatColumnValue(row, col) ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

SubTableSheets.displayName = "SubTableSheets";
export default SubTableSheets;
