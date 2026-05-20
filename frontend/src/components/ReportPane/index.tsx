/**
 * ReportPane — единый контейнер для отчётов.
 *
 * Структура:
 *   ┌─────────────────────────────────┐
 *   │ [form]  фильтры / параметры     │  ← не печатается
 *   ├─────────────────────────────────┤
 *   │ viewport (overflow:auto, тёмный)│
 *   │  ┌───────────────────────────┐  │
 *   │  │ A4-лист (белый, тень)     │  │
 *   │  │  [layout] — макет отчёта  │  │  ← идёт в печать / XLSX / PDF
 *   │  └───────────────────────────┘  │
 *   └─────────────────────────────────┘
 *
 * Кнопки «Сохранить ▾» / «Печать» регистрируются в шапке панели через
 * usePaneHeaderActions (uniqId передаётся автоматически пейн-системой).
 *
 * Печать выполняется через usePrintDocument — ReactNode рендерится
 * в скрытый iframe с изолированным print-CSS и вызывается window.print().
 * Это гарантирует правильный @page A4 без участия MDI-chrome.
 *
 * XLSX/XLS — если передан `workbook` (SheetJS WorkBook), используется он;
 * иначе таблицы извлекаются из живого DOM через XLSX.utils.table_to_sheet.
 */
import { FC, useCallback, useRef, type ReactNode } from "react";
import * as XLSX from "xlsx";
import type { WorkBook } from "xlsx";
import { usePrintDocument } from "src/components/PrintLayout/usePrintDocument";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import SaveDropdownButton, { type SaveDropdownOption } from "src/components/Toolbar/SaveDropdownButton";
import { Toolbar } from "src/components/Toolbar";
import { Icon } from "src/components/IconButton/icons";
import { translate } from "src/i18";
import styles from "./ReportPane.module.scss";

// ── Типы ────────────────────────────────────────────────────────────────────

export type ReportPageOrientation = "portrait" | "landscape";

export interface ReportPaneProps {
  /** Форма фильтров / параметров — отображается над областью прокрутки, не попадает в печать. */
  form?: ReactNode;
  /**
   * Макет отчёта — печатная разметка (таблицы, заголовки, подписи).
   * Отображается в белом A4-листе с тёмным фоном-viewport.
   * Этот узел передаётся напрямую в print-iframe (usePrintDocument)
   * и используется для XLSX-экспорта.
   */
  layout: ReactNode;
  /**
   * Готовый SheetJS WorkBook для точного XLSX/XLS-экспорта.
   * Если не передан — workbook строится из <table> DOM-элементов в layout.
   */
  workbook?: WorkBook;
  /** Базовое имя файла без расширения (по умолчанию "report"). */
  fileBaseName?: string;
  /** Показать индикатор загрузки вместо layout. */
  isLoading?: boolean;
  /**
   * Нет данных — показать заглушку вместо layout.
   * При isEmpty=true кнопки экспорта недоступны.
   */
  isEmpty?: boolean;
  /** Текст заглушки (по умолчанию translate("noData")). */
  emptyMessage?: string;
  /**
   * ID панели MDI — регистрирует кнопки Сохранить/Печать в шапке.
   * Пейн-система передаёт его автоматически через {...pane}.
   */
  uniqId?: string;
  /** Ориентация листа для печати (по умолчанию portrait). */
  orientation?: ReportPageOrientation;
  /** Заголовок в диалоге печати. */
  title?: string;
  /**
   * Режим ширины листа:
   *   "a4"      — фиксированная ширина A4 (210mm / 297mm landscape), по умолчанию.
   *   "content" — ширина по содержимому (для XLSX-таблиц с произвольным числом колонок).
   */
  sheetFit?: "a4" | "content";
}

// ── Утилиты ─────────────────────────────────────────────────────────────────

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractWorkbookFromDom(el: HTMLElement): WorkBook | null {
  const tables = el.querySelectorAll<HTMLTableElement>("table");
  if (!tables.length) return null;
  const wb = XLSX.utils.book_new();
  tables.forEach((t, i) => {
    const ws = XLSX.utils.table_to_sheet(t);
    XLSX.utils.book_append_sheet(wb, ws, `Sheet${i + 1}`);
  });
  return wb;
}

// ── Компонент ────────────────────────────────────────────────────────────────

const ReportPane: FC<ReportPaneProps> = ({
  form,
  layout,
  workbook,
  fileBaseName = "report",
  isLoading = false,
  isEmpty = false,
  emptyMessage,
  uniqId,
  orientation = "portrait",
  title,
  sheetFit = "a4",
}) => {
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const { print: printNode } = usePrintDocument();

  const canExport = !isLoading && !isEmpty;

  // ── Печать через изолированный iframe ────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!canExport) return;
    void printNode(layout, {
      title: title ?? fileBaseName,
      extraCss: orientation === "landscape"
        ? "@page { size: A4 landscape; } .a4-sheet { width: 297mm; min-height: 210mm; }"
        : "",
    });
  }, [canExport, printNode, layout, title, fileBaseName, orientation]);

  // ── XLSX / XLS export ────────────────────────────────────────────────────
  const handleExport = useCallback((format: "xlsx" | "xls") => {
    if (!canExport) return;
    const wb = workbook ?? (layoutRef.current ? extractWorkbookFromDom(layoutRef.current) : null);
    if (!wb) {
      alert(translate("printDocumentExportError"));
      return;
    }
    const bookType = format === "xls" ? "biff8" : "xlsx";
    const mime = format === "xls"
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const ab = XLSX.write(wb, { type: "array", bookType });
    download(new Blob([ab], { type: mime }), `${fileBaseName}.${format}`);
  }, [canExport, workbook, fileBaseName]);

  // ── Кнопки в шапке панели ────────────────────────────────────────────────
  const saveOptions: SaveDropdownOption[] = [
    { id: "xlsx", label: translate("excelXlsx"), icon: <Icon name="save" />, disabled: !canExport },
    { id: "xls",  label: translate("excelXls"),  icon: <Icon name="save" />, disabled: !canExport },
    { id: "pdf",  label: translate("pdf"),        icon: <Icon name="print" />,
      hint: translate("printSaveHint"), disabled: !canExport },
  ];

  const onSelectFormat = (id: string) => {
    if (id === "xlsx") handleExport("xlsx");
    else if (id === "xls") handleExport("xls");
    else if (id === "pdf") handlePrint();
  };

  const headerPortal = usePaneHeaderActions(
    uniqId,
    <>
      <SaveDropdownButton
        options={saveOptions}
        onSelect={onSelectFormat}
        title={translate("saveAs")}
        disabled={!canExport}
      />
      <Toolbar.PrintButton
        onClick={handlePrint}
        title={translate("print")}
        disabled={!canExport}
      />
    </>,
  );

  // ── Рендер ───────────────────────────────────────────────────────────────
  return (
    <div className={styles.ReportPane}>
      {headerPortal}

      {form && (
        <div className={styles.ReportForm}>
          {form}
        </div>
      )}

      <div className={styles.ReportViewport}>
        {isLoading ? (
          <div className={styles.ReportStatus}>{translate("loading")}</div>
        ) : isEmpty ? (
          <div className={styles.ReportStatus}>{emptyMessage ?? translate("noData")}</div>
        ) : (
          <div
            className={styles.ReportSheet}
            ref={layoutRef}
            data-orientation={orientation}
            data-fit={sheetFit}
          >
            {layout}
          </div>
        )}
      </div>
    </div>
  );
};

ReportPane.displayName = "ReportPane";
export default ReportPane;
