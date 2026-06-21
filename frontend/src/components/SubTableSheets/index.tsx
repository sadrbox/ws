/**
 * SubTableSheets — облегчённая «табличная простыня» (sheet) для чтения данных.
 *
 * Визуально и по поведению повторяет SubTable: переиспользует классы
 * Table.module.scss (TableScrollContainer / TableScrollWrapper / TableHeaderCell /
 * TableBodyCell / Justify* / activeRow / activeCell / ResizeHandle) и ту же
 * DOM-структуру (colgroup + thead/tbody + filler-row).
 *
 * Поддерживает (как в SubTable):
 *   • activeRow / activeCell — выделение строки и ячейки по клику + навигация
 *     стрелками (↑↓ — строка, ←→ — ячейка);
 *   • resize колонок перетаскиванием ручки в заголовке (ширины — в локальном state);
 *   • клиентскую сортировку по клику на заголовок (если sortable !== false).
 *
 * Отличия (природа «простыни», только чтение): нет чекбоксов/редактирования/
 * серверных запросов; строки переносят текст и тянутся под содержимое ДО 147px,
 * далее — многоточие (см. .wrapCell).
 *
 * Значение ячейки берётся из renderCell; если он вернул undefined — из
 * getFormatColumnValue (как в обычной таблице).
 */
import { FC, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { sortTableRows, getFormatColumnValue, getColumnAlignment, computeFooterValue } from "src/components/Table/services";
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
  /** Кастомное содержимое ячейки футера: (col, rows) => ReactNode | undefined.
   *  Если не задано или вернул undefined — берётся стандартный итог по col.footer
   *  (sum/avg/min/max/count), как в SubTable/Table. Футер показывается, если задан
   *  этот колбэк ИЛИ у какой-то колонки есть col.footer. */
  footerRender?: (col: TColumn, rows: TDataItem[]) => ReactNode | undefined;
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
  footerRender,
  maxHeight,
  className,
}) => {
  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible !== false),
    [columns],
  );
  const [sort, setSort] = useState<Record<string, "asc" | "desc">>(defaultSort ?? {});

  // Активная строка/ячейка (как в Table). Строку держим по ключу — устойчиво к сортировке.
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [activeCol, setActiveCol] = useState<string | null>(null);
  // Переопределённые ширины колонок (resize). Идентификатор → "NNNpx".
  const [colWidths, setColWidths] = useState<Record<string, string>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{ startX: number; startWidth: number; minW: number; colId: string; th: HTMLElement; colEl: HTMLElement | null } | null>(null);
  const isResizingRef = useRef(false);

  const sortedRows = useMemo(
    () => (Object.keys(sort).length ? sortTableRows(rows, sort) : rows),
    [rows, sort],
  );

  const toggleSort = (col: TColumn) => {
    if (isResizingRef.current || col.sortable === false) return;
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
  // Inline justify для ячеек футера (перебивает baked-in flex-end у .TableFooterCell).
  const footerJustify = (col: TColumn): "flex-start" | "center" | "flex-end" => {
    const a = getColumnAlignment(col);
    return a === "right" ? "flex-end" : a === "center" ? "center" : "flex-start";
  };

  // Футер показываем, если задан footerRender или у колонок есть итоги (col.footer).
  const hasFooter = !!footerRender || visibleColumns.some((c) => c.footer && c.footer !== "none");

  // ── Клик по ячейке → активная строка + ячейка (фокус контейнера для стрелок) ──
  const handleCellClick = useCallback((key: string, colId: string) => {
    if (isResizingRef.current) return;
    setActiveRowKey(key);
    setActiveCol(colId);
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  // ── Навигация стрелками: ↑↓ — строка, ←→ — ячейка (как activeRow/activeCell) ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (activeRowKey == null) return;
    const rIdx = sortedRows.findIndex((r, i) => rowKey(r, i) === activeRowKey);
    if (rIdx < 0) return;
    const cIdx = Math.max(0, visibleColumns.findIndex((c) => c.identifier === activeCol));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = Math.min(sortedRows.length - 1, rIdx + 1);
      setActiveRowKey(rowKey(sortedRows[n], n));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, rIdx - 1);
      setActiveRowKey(rowKey(sortedRows[n], n));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveCol(visibleColumns[Math.min(visibleColumns.length - 1, cIdx + 1)].identifier);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveCol(visibleColumns[Math.max(0, cIdx - 1)].identifier);
    }
  }, [activeRowKey, activeCol, sortedRows, visibleColumns]);

  // Подскролл активной строки в видимую область при навигации.
  useEffect(() => {
    if (!activeRowKey || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-rowkey="${CSS.escape(activeRowKey)}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }, [activeRowKey]);

  // ── Resize колонки: тянем ручку в th, во время drag правим DOM напрямую,
  //    на отпускании фиксируем ширину в state (как handleResizeMouseDown в Table). ──
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, colIndex: number, col: TColumn) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th") as HTMLElement | null;
    if (!th) return;
    const colEl = (th.closest("table")?.querySelector("colgroup")?.children[colIndex] as HTMLElement) ?? null;
    const minW = parseInt(col.minWidth ?? "50", 10);
    resizingRef.current = { startX: e.clientX, startWidth: th.getBoundingClientRect().width, minW, colId: col.identifier, th, colEl };
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const w = Math.max(r.minW, r.startWidth + (ev.clientX - r.startX));
      r.th.style.width = `${w}px`;
      if (r.colEl) r.colEl.style.width = `${w}px`;
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const r = resizingRef.current;
      if (r) {
        const w = Math.max(r.minW, r.startWidth + (ev.clientX - r.startX));
        setColWidths((prev) => ({ ...prev, [r.colId]: `${w}px` }));
      }
      resizingRef.current = null;
      // Сброс флага после текущего click-цикла — чтобы клик по th не сортировал.
      setTimeout(() => { isResizingRef.current = false; }, 0);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  if (!rows.length) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  return (
    <div className={[tableStyles.TableScrollContainer, className].filter(Boolean).join(" ")}>
      <div
        ref={scrollRef}
        className={tableStyles.TableScrollWrapper}
        style={maxHeight != null ? { maxHeight } : undefined}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <table>
          <colgroup>
            {visibleColumns.map((col, i) => {
              const isLast = i === visibleColumns.length - 1;
              const w = colWidths[col.identifier] ?? (isLast ? "auto" : col.width);
              return (
                <col
                  key={col.identifier + (isLast ? "-last" : "")}
                  style={{ width: w, minWidth: col.minWidth ?? "150px" }}
                />
              );
            })}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((col, i) => {
                const sortable = col.sortable !== false;
                const dir = sort[col.identifier];
                const isLast = i === visibleColumns.length - 1;
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
                    {!isLast && (
                      <div
                        className={tableStyles.ResizeHandle}
                        onMouseDown={(e) => handleResizeMouseDown(e, i, col)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => {
              const key = rowKey(row, i);
              const isActiveRow = key === activeRowKey;
              return (
                <tr key={key} data-rowkey={key} className={isActiveRow ? tableStyles.activeRow : undefined}>
                  {visibleColumns.map((col) => {
                    const content = renderCell?.(row, col);
                    const isActiveCell = isActiveRow && col.identifier === activeCol;
                    const cellClass = [
                      tableStyles.TableBodyCell,
                      alignClass(col),
                      wrap ? styles.wrapCell : null,
                      isActiveCell ? tableStyles.activeCell : null,
                    ].filter(Boolean).join(" ");
                    return (
                      <td key={col.identifier} onClick={() => handleCellClick(key, col.identifier)}>
                        {/* Кастомный renderCell отдаёт готовый узел (часто уже <span>) — рендерим
                            как есть, без обёртки. Fallback-значение оборачиваем в <span> (под него
                            заточены стили .TableBodyCell span / .wrapCell span). Как в Table. */}
                        <div className={cellClass}>
                          {content !== undefined
                            ? content
                            : <span>{String(getFormatColumnValue(row, col) ?? "")}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Filler-row — забирает остаток высоты, чтобы строки не растягивались
                (table { height:100% } в Table.module.scss). Как .TableFillerRow в Table. */}
            <tr className={tableStyles.TableFillerRow} aria-hidden="true">
              <td colSpan={visibleColumns.length} />
            </tr>
          </tbody>
          {/* Футер с итогами — sticky bottom, как tfoot в Table. */}
          {hasFooter && (
            <tfoot>
              <tr>
                {visibleColumns.map((col) => {
                  const custom = footerRender?.(col, sortedRows);
                  const fallback = computeFooterValue(col, sortedRows);
                  return (
                    <td key={col.identifier} style={{ borderTop: "0px" }}>
                      <div className={tableStyles.TableFooterCell} style={{ justifyContent: footerJustify(col) }}>
                        {custom !== undefined
                          ? custom
                          : (fallback !== null && <span>{fallback}</span>)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

SubTableSheets.displayName = "SubTableSheets";
export default SubTableSheets;
