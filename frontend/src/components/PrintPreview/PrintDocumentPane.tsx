/**
 * PrintDocumentPane — единая панель предпросмотра печатной формы документа.
 *
 * Макет (`layout`) рендерится напрямую в DocSheet — без iframe.
 * Печать выполняется через usePrintDocument (скрытый iframe с изолированным CSS),
 * экспорт .doc — через renderToStaticMarkup по требованию.
 */
import { FC, useCallback, useRef, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
import type { WorkBook } from "xlsx";
import { Toolbar } from "src/components/Toolbar";
import SaveDropdownButton, { type SaveDropdownOption } from "src/components/Toolbar/SaveDropdownButton";
import { Icon } from "src/components/IconButton/icons";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import { usePrintDocument } from "src/components/PrintLayout/usePrintDocument";
import { DocViewport, DocSheet } from "src/components/DocViewport";
import styles from "./PrintPreview.module.scss";
import { translate } from "src/i18";

export type PageOrientation = "portrait" | "landscape";

export interface PrintDocumentPaneData {
  /** React-узел печатного макета (рендерится напрямую в DocSheet). */
  layout: ReactNode;
  /** Базовое имя файла без расширения. */
  fileBaseName: string;
  /** Заголовок для диалога печати. */
  title?: string;
  /** Готовый workbook для xlsx/xls; если не передан — строится из DOM. */
  workbook?: WorkBook;
  /** Начальная ориентация листа (по умолчанию portrait). */
  orientation?: PageOrientation;
}

interface PaneProps {
  data?: PrintDocumentPaneData;
  uniqId?: string;
}

// ─── Утилиты ──────────────────────────────────────────────────────────────

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
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

function buildWordHtml(bodyHtml: string, title: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeXml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page WordSection1{size:210mm 297mm;margin:12mm 12mm 14mm 16mm}div.WordSection1{page:WordSection1}
body{font-family:'Times New Roman',serif;font-size:10pt;color:#000}
table{border-collapse:collapse;width:100%}td,th{padding:3px 4px;vertical-align:top}
</style></head><body><div class="WordSection1">${bodyHtml}</div></body></html>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "\"" ? "&quot;" : "&apos;");
}

// ─── Компонент ────────────────────────────────────────────────────────────

const PrintDocumentPane: FC<PaneProps> = ({ data, uniqId }) => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const { print: printNode } = usePrintDocument();

  const baseName = data?.fileBaseName || "document";
  const title = data?.title || baseName;

  const lsKey = `print_orientation_${baseName}`;
  const [orientation, setOrientation] = useState<PageOrientation>(() => {
    try {
      const saved = localStorage.getItem(lsKey);
      if (saved === "portrait" || saved === "landscape") return saved;
    } catch { /* ignore */ }
    return data?.orientation ?? "portrait";
  });

  const handleOrientationChange = useCallback((value: PageOrientation) => {
    setOrientation(value);
    try { localStorage.setItem(lsKey, value); } catch { /* ignore */ }
  }, [lsKey]);

  const handlePrint = useCallback(() => {
    if (!data) return;
    void printNode(data.layout, {
      title,
      extraCss: orientation === "landscape"
        ? "@page { size: A4 landscape; } .a4-sheet { width: 297mm; min-height: 210mm; }"
        : "",
    });
  }, [data, printNode, title, orientation]);

  const handleExport = useCallback((format: "xlsx" | "xls") => {
    const wb = data?.workbook ?? (layoutRef.current ? extractWorkbookFromDom(layoutRef.current) : null);
    if (!wb) {
      alert(translate("printDocumentExportError"));
      return;
    }
    const bookType = format === "xls" ? "biff8" : "xlsx";
    const mime = format === "xls"
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const ab = XLSX.write(wb, { type: "array", bookType });
    download(new Blob([ab], { type: mime }), `${baseName}.${format}`);
  }, [data, baseName]);

  const exportDoc = useCallback(() => {
    if (!data) return;
    const bodyHtml = renderToStaticMarkup(data.layout as React.ReactElement);
    const wordHtml = buildWordHtml(bodyHtml, title);
    download(new Blob([wordHtml], { type: "application/msword" }), `${baseName}.doc`);
  }, [data, title, baseName]);

  const onSelectFormat = (id: string) => {
    if (id === "xlsx") handleExport("xlsx");
    else if (id === "xls") handleExport("xls");
    else if (id === "doc") exportDoc();
    else if (id === "pdf") handlePrint();
  };

  const saveOptions: SaveDropdownOption[] = [
    { id: "xlsx", label: translate("excelXlsx"), icon: <Icon name="save" />, disabled: !data },
    { id: "xls",  label: translate("excelXls"),  icon: <Icon name="save" />, disabled: !data },
    { id: "doc",  label: translate("wordDoc"),   icon: <Icon name="save" />, disabled: !data },
    { id: "pdf",  label: translate("pdf"),        icon: <Icon name="print" />,
      hint: translate("printSaveHint"), disabled: !data },
  ];

  const headerActionsPortal = usePaneHeaderActions(
    uniqId,
    data ? (
      <>
        <SaveDropdownButton
          options={saveOptions}
          onSelect={onSelectFormat}
          title={translate("saveAs")}
          disabled={!data}
        />
        <select
          className={styles.PrintOrientationSelect}
          value={orientation}
          onChange={(e) => handleOrientationChange(e.target.value as PageOrientation)}
          title={translate("pageOrientation")}
          aria-label={translate("pageOrientation")}
        >
          <option value="portrait">{translate("portrait")}</option>
          <option value="landscape">{translate("landscape")}</option>
        </select>
        <Toolbar.PrintButton onClick={handlePrint} title={translate("print")} />
      </>
    ) : null,
  );

  if (!data) return <div style={{ padding: 16 }}>{translate("noPrintData")}</div>;

  return (
    <div className={styles.PrintPreview}>
      {headerActionsPortal}
      <DocViewport>
        <DocSheet ref={layoutRef} orientation={orientation}>
          {data.layout}
        </DocSheet>
      </DocViewport>
    </div>
  );
};

PrintDocumentPane.displayName = "PrintDocumentPane";
export default PrintDocumentPane;
