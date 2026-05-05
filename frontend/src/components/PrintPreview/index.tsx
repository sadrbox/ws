import { FC, useCallback, useEffect, useState, useRef } from "react";
import mammoth from "mammoth";
import apiClient from "src/services/api/client";
import { Button } from "src/components/Button";
import styles from "src/styles/main.module.scss";

// ═══════════════════════════════════════════════════════════════════════════
// PrintPreview — вкладка «Печать»
// Все форматы → единый iframe на тёмном фоне.
// PDF — blob (нативный viewer браузера).
// DOCX — mammoth → HTML. TXT/HTML — as-is. IMG — HTML-обёртка.
// ═══════════════════════════════════════════════════════════════════════════

interface FileItem { uuid: string; fileName: string }

interface PrintPreviewProps {
  ownerUuid: string;
  ownerType?: string;
  filesRevision?: number;
}

const PRINTABLE_EXT = /\.(docx|doc|txt|html|htm|pdf|png|jpg|jpeg|gif|bmp|webp|svg)$/i;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|bmp|webp|svg)$/i;
const PDF_EXT = /\.pdf$/i;

const DOC_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:20mm}
body{font-family:'Times New Roman',serif;font-size:14px;line-height:1.6;color:#000;margin:0;padding:20mm;background:#fff}
h1{font-size:18px;font-weight:bold;margin:0 0 12px}
h2{font-size:16px;font-weight:bold;margin:0 0 10px}
h3{font-size:14px;font-weight:bold;margin:0 0 8px}
p{margin:0 0 8px}
table{border-collapse:collapse;width:100%;margin:8px 0}
td,th{border:1px solid #000;padding:4px 8px;font-size:13px}
th{background:#f3f4f6;font-weight:bold}
ul,ol{margin:4px 0 8px 20px;padding:0}
li{margin:2px 0}
img{max-width:100%;height:auto}
strong,b{font-weight:bold}
em,i{font-style:italic}
pre{white-space:pre-wrap;word-wrap:break-word}
`;

const IMG_CSS = `
*{margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center}
img{width:100%;height:100%;object-fit:contain;display:block}
@page{size:A4;margin:10mm}
@media print{img{max-width:100%;max-height:100%;object-fit:contain}}
`;

// ── Утилиты ───────────────────────────────────────────────────────────────

function ext(name: string) { return (name.match(/\.(\w+)$/) ?? [])[1]?.toLowerCase() ?? ""; }

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function htmlBlob(html: string) { return URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); }

function wrap(body: string, css = DOC_CSS) { return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`; }

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = fail; r.readAsDataURL(blob); });
}

// ── Компонент ─────────────────────────────────────────────────────────────

const PrintPreview: FC<PrintPreviewProps> = ({ ownerUuid, ownerType = "contract", filesRevision = 0 }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selected, setSelected] = useState("");
  const [src, setSrc] = useState("");           // blob URL для iframe
  const [isPdf, setIsPdf] = useState(false);    // PDF отображается иначе (нативный viewer)
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const srcRef = useRef(src); srcRef.current = src;
  const filesRef = useRef(files); filesRef.current = files;
  const selRef = useRef(selected); selRef.current = selected;
  const genRef = useRef(0);

  // Очистка blob при unmount
  useEffect(() => () => { if (srcRef.current) URL.revokeObjectURL(srcRef.current); }, []);

  const revoke = useCallback(() => {
    if (srcRef.current) { URL.revokeObjectURL(srcRef.current); setSrc(""); }
  }, []);

  // ── Список файлов ──────────────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/files?ownerType=${encodeURIComponent(ownerType)}&ownerUuid=${encodeURIComponent(ownerUuid)}`);
      const items: FileItem[] = (res.data?.items ?? []).filter((f: FileItem) => PRINTABLE_EXT.test(f.fileName));
      setFiles(items);
      const ids = new Set(items.map(i => i.uuid));
      const cur = selRef.current;
      if (cur && !ids.has(cur)) setSelected(items[0]?.uuid ?? "");
      else if (!cur && items.length) setSelected(items[0].uuid);
    } catch { setError("Не удалось загрузить список файлов"); }
    finally { setLoading(false); }
  }, [ownerUuid, ownerType]);

  useEffect(() => { if (ownerUuid) void loadFiles(); }, [ownerUuid, filesRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Конвертация файла → blob URL ───────────────────────────────────────
  const convert = useCallback(async (uuid: string) => {
    const file = filesRef.current.find(f => f.uuid === uuid);
    if (!file) return;
    const gen = ++genRef.current;
    setConverting(true); setError(null); setIsPdf(false); revoke();

    try {
      const e = ext(file.fileName);
      const stale = () => gen !== genRef.current;
      const dl = (type: string) => apiClient.get(`/files/download/${uuid}`, { responseType: type as any });

      if (PDF_EXT.test(file.fileName)) {
        const r = await dl("blob"); if (stale()) return;
        setSrc(URL.createObjectURL(r.data as Blob));
        setIsPdf(true);

      } else if (IMAGE_EXT.test(file.fileName)) {
        const r = await dl("blob"); if (stale()) return;
        const du = await toDataUrl(r.data as Blob); if (stale()) return;
        setSrc(htmlBlob(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IMG_CSS}</style></head><body><img src="${du}" alt="${esc(file.fileName)}"/></body></html>`));

      } else if (e === "txt") {
        const r = await dl("blob"); if (stale()) return;
        const t = await (r.data as Blob).text(); if (stale()) return;
        setSrc(htmlBlob(wrap(`<pre>${esc(t)}</pre>`)));

      } else if (e === "html" || e === "htm") {
        const r = await dl("blob"); if (stale()) return;
        const t = await (r.data as Blob).text(); if (stale()) return;
        const lc = t.trim().toLowerCase();
        setSrc(htmlBlob((lc.startsWith("<!doctype") || lc.startsWith("<html")) ? t : wrap(t)));

      } else if (e === "docx") {
        const r = await dl("arraybuffer"); if (stale()) return;
        const m = await mammoth.convertToHtml({ arrayBuffer: r.data as ArrayBuffer }, {
          styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Heading 1'] => h1:fresh", "p[style-name='Heading 2'] => h2:fresh", "p[style-name='Heading 3'] => h3:fresh"],
        });
        if (stale()) return;
        if (m.messages.length) console.warn("mammoth:", m.messages);
        setSrc(htmlBlob(wrap(m.value)));

      } else if (e === "doc") {
        setError("Формат .doc не поддерживается — сохраните как .docx");
      } else {
        setError(`Формат .${e} не поддерживается`);
      }
    } catch (err: any) {
      if (gen !== genRef.current) return;
      console.error("PrintPreview:", err);
      setError("Ошибка загрузки файла");
    } finally {
      if (gen === genRef.current) setConverting(false);
    }
  }, [revoke]);

  useEffect(() => { if (selected) void convert(selected); else revoke(); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Печать ─────────────────────────────────────────────────────────────
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const print = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame || !srcRef.current) return;
    try { frame.contentWindow?.print(); } catch { window.print(); }
  }, []);

  // ── Рендер ─────────────────────────────────────────────────────────────
  const busy = loading || converting;

  return (
    <div className={styles.PrintPreview}>
      {/* Тулбар */}
      <div className={styles.PrintToolbar}>
        <select
          className={styles.PrintSelect}
          value={selected}
          onChange={e => setSelected(e.target.value)}
          disabled={busy || !files.length}
        >
          {!files.length && <option value="">{loading ? "Загрузка…" : "Нет файлов"}</option>}
          {files.map(f => <option key={f.uuid} value={f.uuid}>{f.fileName}</option>)}
        </select>

        <div className={styles.PrintToolbarActions}>
          <Button onClick={() => selected && convert(selected)} disabled={!selected || converting}>
            ↻ Обновить
          </Button>
          <Button variant="primary" onClick={print} disabled={!src || converting}>
            🖨️ Печать
          </Button>
        </div>
      </div>

      {/* Статус */}
      {error && <div className={styles.PrintError}>{error}</div>}
      {converting && <div className={styles.PrintLoading}>Загрузка файла…</div>}

      {/* Область просмотра — тёмный фон */}
      <div className={styles.PrintViewport}>
        {src && !converting ? (
          <iframe
            ref={iframeRef}
            className={isPdf ? styles.PrintIframePdf : styles.PrintIframeDoc}
            src={src}
            title="Preview"
          />
        ) : !converting && !error && (
          <div className={styles.PrintPlaceholder}>
            {files.length ? "Выберите файл для предпросмотра" : "Прикрепите файлы на вкладке «Файлы»"}
          </div>
        )}
      </div>
    </div>
  );
};

PrintPreview.displayName = "PrintPreview";
export default PrintPreview;
