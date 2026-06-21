/**
 * SubTableSheets — облегчённая «табличная простыня» (sheet) для чтения данных.
 *
 * Визуально ИДЕНТИЧНА SubTable: переиспользует классы Table.module.scss
 * (TableScrollContainer / TableScrollWrapper / TableHeaderCell / TableBodyCell /
 * Justify*) и повторяет ту же DOM-структуру (colgroup + thead/tbody + filler-row),
 * что и компонент Table, через который рендерится SubTable.
 *
 * Отличия от SubTable (природа «простыни», только чтение):
 *   • высота строки тянется под содержимое, текст переносится и уважает \n
 *     (опция wrap, по умолчанию вкл.) — класс-модификатор .wrapCell;
 *   • НЕТ колонки-чекбокса, выделения строк, редактирования и серверных запросов —
 *     отображает переданные `rows` как есть;
 *   • клиентская сортировка по клику на заголовок (если sortable !== false).
 *
 * Значение ячейки берётся из renderCell; если он вернул undefined — из
 * getFormatColumnValue (как в обычной таблице).
 */
import { FC, ReactNode, useMemo, useState } from "react";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { sortTableRows, getFormatColumnValue, getColumnAlignment } from "src/components/Table/services";
import { getTranslateColumn } from "src/i18";
import tableStyles from "src/components/Table/Table.module.scss";
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
  /** Ограничение высоты области прокрутки (тогда шапка «прилипает» при скролле). */
  maxHeight?: string | number;
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
  maxHeight,
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

  // Justify-класс по выравниванию колонки — те же классы, что у Table.
  const alignClass = (col: TColumn) => {
    const a = getColumnAlignment(col);
    return a === "right" ? tableStyles.JustifyRight : a === "center" ? tableStyles.JustifyCenter : tableStyles.JustifyLeft;
  };

  if (!rows.length) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  return (
    <div className={[tableStyles.TableScrollContainer, className].filter(Boolean).join(" ")}>
      <div className={tableStyles.TableScrollWrapper} style={maxHeight != null ? { maxHeight } : undefined}>
        <table>
          <colgroup>
            {visibleColumns.map((col, i) => {
              const isLast = i === visibleColumns.length - 1;
              return (
                <col
                  key={col.identifier + (isLast ? "-last" : "")}
                  style={{ width: isLast ? "auto" : col.width, minWidth: col.minWidth ?? "150px" }}
                />
              );
            })}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((col) => {
                const sortable = col.sortable !== false;
                const dir = sort[col.identifier];
                return (
                  <th
                    key={col.identifier}
                    title={col.hint || undefined}
                    style={{ cursor: sortable ? "pointer" : "default" }}
                    onClick={sortable ? () => toggleSort(col) : undefined}
                  >
                    <div className={tableStyles.TableHeaderCell}>
                      <span>{getTranslateColumn(col)}</span>
                      {dir && (
                        <svg
                          className={`${tableStyles.SortArrow} ${dir === "desc" ? tableStyles.desc : ""}`}
                          width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
                        >
                          <g><path fill="none" d="M0 0h24v24H0z" /><path d="M12 14l-4-4h8z" /></g>
                        </svg>
                      )}
                    </div>
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
                  const value = content !== undefined ? content : String(getFormatColumnValue(row, col) ?? "");
                  const cellClass = [tableStyles.TableBodyCell, alignClass(col), wrap ? styles.wrapCell : null]
                    .filter(Boolean).join(" ");
                  return (
                    <td key={col.identifier}>
                      <div className={cellClass}>
                        <span>{value}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Filler-row — забирает остаток высоты, чтобы строки не растягивались
                (table { height:100% } в Table.module.scss). Как .TableFillerRow в Table. */}
            <tr className={tableStyles.TableFillerRow} aria-hidden="true">
              <td colSpan={visibleColumns.length} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

SubTableSheets.displayName = "SubTableSheets";
export default SubTableSheets;
