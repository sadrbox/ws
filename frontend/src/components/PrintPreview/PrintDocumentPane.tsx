/**
 * PrintDocumentPane — единая панель предпросмотра печатной формы документа.
 *
 * Кнопки управления (Сохранить ▾ / Печать) перенесены в шапку панели
 * (PaneItemHeaderToolbar) через `usePaneHeaderActions(paneId, ...)`.
 * Сам PrintDocumentPane содержит только iframe-предпросмотр A4.
 *
 * Принимает HTML-строку макета (предварительно отрендеренного из React-
 * компонента *Print через renderToStaticMarkup) и опционально готовый
 * SheetJS Workbook для точного xlsx/xls.
 */
import { FC, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { WorkBook } from "xlsx";
import { Toolbar } from "src/components/Toolbar";
import SaveDropdownButton, { type SaveDropdownOption } from "src/components/Toolbar/SaveDropdownButton";
import { Icon } from "src/components/IconButton/icons";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import styles from "./PrintPreview.module.scss";
import { translate } from "src/i18";

// ── CSS макета (применяется к содержимому iframe) ──────────────────────────
// PRINT_CSS зависит от ориентации листа (portrait | landscape).
// При альбомной ориентации A4 разворачивается: 297mm × 210mm.
export type PageOrientation = "portrait" | "landscape";
function buildPrintCss(orientation: PageOrientation): string {
  const isLandscape = orientation === "landscape";
  const sheetW = isLandscape ? "297mm" : "210mm";
  const sheetH = isLandscape ? "210mm" : "297mm";
  return `
  @page { size: A4 ${isLandscape ? "landscape" : "portrait"}; margin: 12mm 12mm 14mm 16mm; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{margin:0;padding:0;background:#fff;color:#000;
    font-family:"Times New Roman",Times,serif;font-size:10pt;
    overflow-x:hidden;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .a4-sheet{width:${sheetW};max-width:100%;min-height:${sheetH};margin:0 auto;background:#fff;
    padding:12mm 12mm 14mm 16mm;overflow:hidden}
  table{border-collapse:collapse;width:100%;table-layout:fixed}
  td,th{padding:3px 4px;vertical-align:top;word-wrap:break-word;overflow-wrap:break-word}
  img{max-width:100%;height:auto}
  @media screen{body{padding:16px;background:#f0f0f0}
    .a4-sheet{box-shadow:0 0 8px rgba(0,0,0,0.15)}}
  @media print{body{padding:0;background:#fff}
    .a4-sheet{box-shadow:none;padding:0;width:auto;min-height:0}}
`;
}

export interface PrintDocumentPaneData {
  /** HTML-строка тела документа (без <html>/<body>). */
  bodyHtml: string;
  /** Базовое имя файла без расширения. */
  fileBaseName: string;
  /** Заголовок (опционально). */
  title?: string;
  /** Опциональный готовый workbook для xlsx/xls. */
  workbook?: WorkBook;
  /** Начальная ориентация листа (по умолчанию portrait). */
  orientation?: PageOrientation;
}

interface PaneProps {
  data?: PrintDocumentPaneData;
  uniqId?: string;
}

// ─── Утилиты ──────────────────────────────────────────────────────────────

function buildFullHtml(body: string, orientation: PageOrientation): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${buildPrintCss(orientation)}</style></head><body><div class="a4-sheet">${body}</div></body></html>`;
}

function htmlBlobUrl(html: string, mime = "text/html;charset=utf-8") {
  return URL.createObjectURL(new Blob([html], { type: mime }));
}

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

function buildWordHtml(body: string, title: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeXml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page WordSection1{size:210mm 297mm;margin:12mm 12mm 14mm 16mm}div.WordSection1{page:WordSection1}
body{font-family:'Times New Roman',serif;font-size:10pt;color:#000}
table{border-collapse:collapse;width:100%}td,th{padding:3px 4px;vertical-align:top}
</style></head><body><div class="WordSection1">${body}</div></body></html>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "\"" ? "&quot;" : "&apos;");
}

function workbookFromHtml(html: string): WorkBook | null {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tables = doc.querySelectorAll("table");
    if (!tables.length) return null;
    const wb = XLSX.utils.book_new();
    tables.forEach((t, i) => {
      const ws = XLSX.utils.table_to_sheet(t as HTMLTableElement);
      XLSX.utils.book_append_sheet(wb, ws, `Sheet${i + 1}`);
    });
    return wb;
  } catch {
    return null;
  }
}

// ─── Компонент ────────────────────────────────────────────────────────────

const PrintDocumentPane: FC<PaneProps> = ({ data, uniqId }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [src, setSrc] = useState("");
  const [orientation, setOrientation] = useState<PageOrientation>(
    data?.orientation ?? "portrait",
  );

  const fullHtml = useMemo(
    () => (data ? buildFullHtml(data.bodyHtml, orientation) : ""),
    [data?.bodyHtml, orientation], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!fullHtml) return;
    const url = htmlBlobUrl(fullHtml);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [fullHtml]);

  const baseName = data?.fileBaseName || "document";
  const title = data?.title || baseName;

  const handlePrintPdf = () => {
    const frame = iframeRef.current;
    if (!frame) return;
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.print();
    }
  };

  const exportXlsx = (bookType: "xlsx" | "biff8") => {
    const wb = data?.workbook ?? workbookFromHtml(fullHtml);
    if (!wb) {
      alert(translate("printDocumentExportError"));
      return;
    }
    const ab = XLSX.write(wb, { type: "array", bookType });
    const mime = bookType === "biff8"
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const ext = bookType === "biff8" ? "xls" : "xlsx";
    download(new Blob([ab], { type: mime }), `${baseName}.${ext}`);
  };

  const exportDoc = () => {
    if (!data) return;
    const wordHtml = buildWordHtml(data.bodyHtml, title);
    download(new Blob([wordHtml], { type: "application/msword" }), `${baseName}.doc`);
  };

  const onSelectFormat = (id: string) => {
    if (id === "xlsx") return exportXlsx("xlsx");
    if (id === "xls") return exportXlsx("biff8");
    if (id === "doc") return exportDoc();
    if (id === "pdf") return handlePrintPdf();
  };

  const saveOptions: SaveDropdownOption[] = [
    { id: "xlsx", label: translate("excelXlsx"), icon: <Icon name="save" /> },
    { id: "xls", label: translate("excelXls"), icon: <Icon name="save" /> },
    { id: "doc", label: translate("wordDoc"), icon: <Icon name="save" /> },
    { id: "pdf", label: translate("pdf"), icon: <Icon name="print" />, hint: translate("printSaveHint") },
  ];

  // Регистрируем кнопки «Сохранить ▾», переключатель ориентации и «Печать»
  // в шапке панели.
  const headerActionsPortal = usePaneHeaderActions(
    uniqId,
    data ? (
      <>
        <SaveDropdownButton
          options={saveOptions}
          onSelect={onSelectFormat}
          title={translate("saveAs")}
        />
        <select
          className={styles.PrintOrientationSelect}
          value={orientation}
          onChange={(e) => setOrientation(e.target.value as PageOrientation)}
          title={translate("pageOrientation")}
          aria-label={translate("pageOrientation")}
        >
          <option value="portrait">{translate("portrait")}</option>
          <option value="landscape">{translate("landscape")}</option>
        </select>
        <Toolbar.PrintButton onClick={handlePrintPdf} title={translate("print")} />
      </>
    ) : null,
  );

  if (!data) return <div style={{ padding: 16 }}>{translate("noPrintData")}</div>;

  return (
    <div className={styles.PrintPreview}>
      {headerActionsPortal}
      <div className={styles.PrintViewport}>
        {src && (
          <iframe
            ref={iframeRef}
            className={styles.PrintIframeDoc}
            style={orientation === "landscape" ? { width: "297mm", minHeight: "210mm" } : undefined}
            src={src}
            title={baseName}
          />
        )}
      </div>
    </div>
  );
};

PrintDocumentPane.displayName = "PrintDocumentPane";
export default PrintDocumentPane;
