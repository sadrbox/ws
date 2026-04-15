import { FC, useCallback, useEffect, useState, useRef, useLayoutEffect } from "react";
import mammoth from "mammoth";
import apiClient from "src/services/api/client";
import { Button } from "src/components/Button";
import styles from "src/styles/main.module.scss";

// ═══════════════════════════════════════════════════════════════════════════
// PrintPreview — вкладка «Печать» для ContractsForm
// Загружает doc/docx/txt файлы, конвертирует и отображает постранично
// в формате A4 с масштабированием и возможностью печати.
// ═══════════════════════════════════════════════════════════════════════════

interface FileItem {
  uuid: string;
  fileName: string;
  fileSize?: number;
}

interface PrintPreviewProps {
  ownerUuid: string;
  /** Счётчик ревизии — увеличивается при изменении файлов на вкладке «Файлы» */
  filesRevision?: number;
}

/** Расширения, которые можно отобразить */
const PRINTABLE_EXT = /\.(docx|doc|txt|html|htm)$/i;

const ZOOM_STEP = 10;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;
const ZOOM_DEFAULT = 80;

/** Размеры A4 в px (при 96dpi): 210mm ≈ 793.7px, 297mm ≈ 1122.5px */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
/** Padding на странице: 20mm ≈ 75.6px */
const PAGE_PADDING_PX = 76;
/** Высота контентной области на странице */
const CONTENT_HEIGHT_PX = A4_HEIGHT_PX - PAGE_PADDING_PX * 2;

function getFileExt(name: string): string {
  const m = name.match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : "";
}

const PrintPreview: FC<PrintPreviewProps> = ({ ownerUuid, filesRevision = 0 }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedUuid, setSelectedUuid] = useState<string>("");
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [pageCount, setPageCount] = useState(1);

  /** Скрытый div для измерения полной высоты контента */
  const measureRef = useRef<HTMLDivElement>(null);
  /** Ref для контента каждой страницы (для печати) */
  const printRef = useRef<HTMLDivElement>(null);

  // ── Загрузка списка файлов ──────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    setError(null);
    try {
      const res = await apiClient.get(
        `/files?ownerType=contract&ownerUuid=${encodeURIComponent(ownerUuid)}`
      );
      const items: FileItem[] = (res.data?.items ?? []).filter((f: FileItem) =>
        PRINTABLE_EXT.test(f.fileName)
      );
      setFiles(_prev => {
        const uuids = new Set(items.map(i => i.uuid));
        if (selectedUuid && !uuids.has(selectedUuid)) {
          setSelectedUuid(items.length > 0 ? items[0].uuid : "");
        }
        if (!selectedUuid && items.length > 0) {
          setSelectedUuid(items[0].uuid);
        }
        return items;
      });
    } catch (e: any) {
      console.error("PrintPreview loadFiles error:", e);
      setError("Не удалось загрузить список файлов");
    } finally {
      setIsLoadingFiles(false);
    }
  }, [ownerUuid, selectedUuid]);

  useEffect(() => {
    if (ownerUuid) loadFiles();
  }, [ownerUuid, filesRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Загрузка и конвертация выбранного файла ─────────────────────────────
  const loadAndConvert = useCallback(async (fileUuid: string) => {
    const file = files.find(f => f.uuid === fileUuid);
    if (!file) return;

    setIsConverting(true);
    setError(null);
    setHtmlContent("");
    setPageCount(1);

    try {
      const ext = getFileExt(file.fileName);

      if (ext === "txt") {
        const res = await apiClient.get(`/files/download/${fileUuid}`, { responseType: "blob" });
        const text = await (res.data as Blob).text();
        setHtmlContent(`<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:'Times New Roman',serif;font-size:14px;line-height:1.6;">${escapeHtml(text)}</pre>`);
      } else if (ext === "html" || ext === "htm") {
        const res = await apiClient.get(`/files/download/${fileUuid}`, { responseType: "blob" });
        const text = await (res.data as Blob).text();
        setHtmlContent(text);
      } else if (ext === "docx") {
        const res = await apiClient.get(`/files/download/${fileUuid}`, { responseType: "arraybuffer" });
        const result = await mammoth.convertToHtml(
          { arrayBuffer: res.data as ArrayBuffer },
          {
            styleMap: [
              "p[style-name='Title'] => h1:fresh",
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
            ],
          }
        );
        if (result.messages.length > 0) console.warn("mammoth warnings:", result.messages);
        setHtmlContent(result.value);
      } else if (ext === "doc") {
        setError("Формат .doc не поддерживается для предпросмотра. Сохраните файл в формате .docx");
      } else {
        setError(`Формат .${ext} не поддерживается для предпросмотра`);
      }
    } catch (e: any) {
      console.error("PrintPreview convert error:", e);
      setError("Ошибка при загрузке или конвертации файла");
    } finally {
      setIsConverting(false);
    }
  }, [files]);

  useEffect(() => {
    if (selectedUuid) loadAndConvert(selectedUuid);
    else setHtmlContent("");
  }, [selectedUuid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Измерение высоты контента → расчёт количества страниц ───────────────
  useLayoutEffect(() => {
    if (!htmlContent || !measureRef.current) {
      setPageCount(1);
      return;
    }
    // Даём браузеру отрисовать скрытый div
    const frame = requestAnimationFrame(() => {
      if (measureRef.current) {
        const h = measureRef.current.scrollHeight;
        const pages = Math.max(1, Math.ceil(h / CONTENT_HEIGHT_PX));
        setPageCount(pages);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [htmlContent]);

  // ── Масштабирование ─────────────────────────────────────────────────────
  const zoomIn = useCallback(() => setZoom(z => Math.min(z + ZOOM_STEP, ZOOM_MAX)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - ZOOM_STEP, ZOOM_MIN)), []);
  const zoomReset = useCallback(() => setZoom(ZOOM_DEFAULT), []);

  // ── Печать ──────────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!printRef.current) return;

    const printWindow = window.open("", "_blank", "width=800,height=1100");
    if (!printWindow) { window.print(); return; }

    const selectedFile = files.find(f => f.uuid === selectedUuid);
    const title = selectedFile?.fileName ?? "Печать договора";

    // Собираем контент из скрытого измерительного div (полный контент)
    const fullHtml = measureRef.current?.innerHTML ?? printRef.current.innerHTML;

    printWindow.document.write(`<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body {
      font-family: 'Times New Roman', serif;
      font-size: 14px;
      line-height: 1.6;
      color: #000;
      margin: 0; padding: 0;
    }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #000; padding: 4px 8px; }
    h1 { font-size: 18px; } h2 { font-size: 16px; } h3 { font-size: 14px; }
    p { margin: 0 0 8px 0; }
    pre { white-space: pre-wrap; word-wrap: break-word; }
    img { max-width: 100%; }
  </style>
</head><body>${fullHtml}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 400);
  }, [files, selectedUuid]);

  // ── Генерация массива страниц ───────────────────────────────────────────
  const pages = Array.from({ length: pageCount }, (_, i) => i);
  const scaleFactor = zoom / 100;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className={styles.PrintPreview}>
      {/* Скрытый div для измерения полной высоты контента */}
      {htmlContent && (
        <div
          ref={measureRef}
          className={styles.PrintContent}
          style={{
            position: "absolute",
            visibility: "hidden",
            width: `${A4_WIDTH_PX - PAGE_PADDING_PX * 2}px`,
            left: "-9999px",
            top: 0,
            fontFamily: "'Times New Roman', serif",
            fontSize: "14px",
            lineHeight: "1.6",
          }}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      )}

      {/* Панель управления */}
      <div className={styles.PrintPanel}>
        <div className={styles.PrintPanelLeft}>
          <label className={styles.PrintLabel}>Файл:</label>
          <select
            className={styles.PrintSelect}
            value={selectedUuid}
            onChange={e => setSelectedUuid(e.target.value)}
            disabled={isLoadingFiles || files.length === 0}
          >
            {files.length === 0 && (
              <option value="">{isLoadingFiles ? "Загрузка..." : "Нет файлов для просмотра"}</option>
            )}
            {files.map(f => (
              <option key={f.uuid} value={f.uuid}>{f.fileName}</option>
            ))}
          </select>
        </div>

        <div className={styles.PrintPanelCenter}>
          <Button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Уменьшить">−</Button>
          <button className={styles.PrintZoomLabel} onClick={zoomReset} title="Сбросить масштаб">
            {zoom}%
          </button>
          <Button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Увеличить">+</Button>
          {pageCount > 1 && (
            <span className={styles.PrintPageInfo}>{pageCount} стр.</span>
          )}
        </div>

        <div className={styles.PrintPanelRight}>
          <Button
            onClick={() => { if (selectedUuid) loadAndConvert(selectedUuid); }}
            disabled={!selectedUuid || isConverting}
          >↻ Обновить</Button>
          <Button
            variant="primary"
            onClick={handlePrint}
            disabled={!htmlContent || isConverting}
          >🖨️ Печать</Button>
        </div>
      </div>

      {/* Сообщения */}
      {error && <div className={styles.PrintError}>{error}</div>}
      {isConverting && <div className={styles.PrintLoading}>Загрузка и конвертация файла...</div>}

      {/* Область предпросмотра — тёмный фон, страницы */}
      <div className={styles.PrintA4Wrapper} ref={printRef}>
        {htmlContent ? (
          <div
            className={styles.PrintPagesGrid}
            style={{
              // Ширина «плитки» страницы с учётом зума + gap
              gridTemplateColumns: `repeat(auto-fill, ${Math.floor(A4_WIDTH_PX * scaleFactor) + 2}px)`,
            }}
          >
            {pages.map(pageIndex => (
              <div
                key={pageIndex}
                className={styles.PrintPageSlot}
                style={{
                  width: `${A4_WIDTH_PX * scaleFactor}px`,
                  height: `${A4_HEIGHT_PX * scaleFactor}px`,
                }}
              >
                <div
                  className={styles.PrintA4Page}
                  style={{
                    width: `${A4_WIDTH_PX}px`,
                    height: `${A4_HEIGHT_PX}px`,
                    transform: `scale(${scaleFactor})`,
                    transformOrigin: "top left",
                  }}
                >
                  {/* Окно в контент, сдвинутое на нужную страницу */}
                  <div
                    className={styles.PrintPageViewport}
                    style={{
                      height: `${CONTENT_HEIGHT_PX}px`,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      className={styles.PrintContent}
                      style={{
                        transform: `translateY(-${pageIndex * CONTENT_HEIGHT_PX}px)`,
                      }}
                      dangerouslySetInnerHTML={{ __html: htmlContent }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          !isConverting && !error && (
            <div className={styles.PrintA4Page} style={{ width: `${A4_WIDTH_PX}px`, minHeight: `${A4_HEIGHT_PX}px`, transform: `scale(${scaleFactor})`, transformOrigin: "top left" }}>
              <div className={styles.PrintPlaceholder}>
                {files.length === 0
                  ? "Прикрепите файлы .docx или .txt к договору на вкладке «Файлы»"
                  : "Выберите файл для предпросмотра"}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
};

/** Экранирование HTML-символов */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

PrintPreview.displayName = "PrintPreview";
export default PrintPreview;
