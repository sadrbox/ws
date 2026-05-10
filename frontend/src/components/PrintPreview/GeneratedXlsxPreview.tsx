import { FC, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "src/components/Button";
import styles from "src/styles/main.module.scss";

// ═══════════════════════════════════════════════════════════════════════════
// GeneratedXlsxPreview — предпросмотр СГЕНЕРИРОВАННОГО (in-memory) рабочей
// книги Excel с панелью «Сохранить как .xlsx / .pdf / Печать».
// Используется для печатных форм документов: накладных, актов, счетов и т.д.
// ═══════════════════════════════════════════════════════════════════════════

interface GeneratedXlsxPreviewProps {
  /** Готовая рабочая книга SheetJS. */
  workbook: XLSX.WorkBook;
  /** Имя файла без расширения (для диалога Сохранить). */
  fileBaseName: string;
  /** Заголовок над панелью (опционально). */
  title?: string;
}

const DOC_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:15mm}
body{font-family:'Times New Roman',serif;font-size:13px;line-height:1.4;color:#000;margin:0;padding:15mm;background:#fff}
h1{font-size:18px;font-weight:bold;margin:0 0 12px}
h2{font-size:14px;font-weight:bold;margin:14px 0 6px}
table{border-collapse:collapse;width:100%;margin:6px 0}
td,th{border:1px solid #000;padding:3px 6px;font-size:12px;vertical-align:top}
th{background:#f3f4f6;font-weight:bold;text-align:center}
`;

function htmlBlob(html: string) {
  return URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
}

function workbookToHtml(wb: XLSX.WorkBook, title?: string): string {
  const parts: string[] = [];
  if (title) parts.push(`<h1>${title.replace(/</g, "&lt;")}</h1>`);
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const html = XLSX.utils.sheet_to_html(sheet, { id: "sheet" });
    const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
    const tableHtml = tableMatch ? tableMatch[0] : html;
    if (wb.SheetNames.length > 1) {
      parts.push(`<h2>${sheetName.replace(/</g, "&lt;")}</h2>${tableHtml}`);
    } else {
      parts.push(tableHtml);
    }
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>${parts.join("\n")}</body></html>`;
}

const GeneratedXlsxPreview: FC<GeneratedXlsxPreviewProps> = ({ workbook, fileBaseName, title }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [src, setSrc] = useState("");

  const html = useMemo(() => workbookToHtml(workbook, title), [workbook, title]);

  useEffect(() => {
    const url = htmlBlob(html);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);

  const handleSaveXlsx = () => {
    const ab = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const blob = new Blob([ab], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Сохранение как PDF: вызываем нативный диалог печати iframe — пользователь
  // выбирает «Сохранить как PDF» в принтере. Это самый совместимый способ
  // без тяжёлого html2pdf/jspdf, и сохраняет идентичный print-вид.
  const handlePrintOrPdf = () => {
    const frame = iframeRef.current;
    if (!frame) return;
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.print();
    }
  };

  return (
    <div className={styles.PrintPreview}>
      <div className={styles.PrintToolbar}>
        <div className={styles.PrintToolbarLabel}>{title ?? `${fileBaseName}.xlsx`}</div>
        <div className={styles.PrintToolbarActions}>
          <Button onClick={handleSaveXlsx}>Сохранить .xlsx</Button>
          <Button variant="primary" onClick={handlePrintOrPdf}>
            Печать / Сохранить .pdf
          </Button>
        </div>
      </div>
      <div className={styles.PrintViewport}>
        {src && (
          <iframe
            ref={iframeRef}
            className={styles.PrintIframeDoc}
            src={src}
            title={fileBaseName}
          />
        )}
      </div>
    </div>
  );
};

GeneratedXlsxPreview.displayName = "GeneratedXlsxPreview";
export default GeneratedXlsxPreview;
