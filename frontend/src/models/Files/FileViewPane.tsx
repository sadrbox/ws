import { FC, useEffect, useRef, useState } from "react";
import apiClient from "src/services/api/client";
import { DocViewport } from "src/components/DocViewport";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import styles from "./FileView.module.scss";

// ═══════════════════════════════════════════════════════════════════════════
// FileViewPane — УНИВЕРСАЛЬНЫЙ рендерер файла (в DocViewport):
//   изображение → <img>, pdf → pdfjs(canvas), xlsx/xls → SheetJS→таблица,
//   docx → mammoth→html. Прочее (в т.ч. бинарный .doc) → сообщение.
// Чистый компонент: получает файл через проп `file` (или paneProps.data) и
// только отображает его. Списком файлов / скачиванием / шапкой управляет
// обёртка (FileViewerPane) либо родительская панель.
// Тяжёлые библиотеки (pdfjs/xlsx/mammoth) грузятся лениво по типу файла.
// ═══════════════════════════════════════════════════════════════════════════

export interface FileMeta { uuid?: string; fileName?: string; mimeType?: string | null }

type ViewState =
  | { kind: "loading" }
  | { kind: "image"; url: string }
  | { kind: "html"; html: string }
  | { kind: "pdf" }
  | { kind: "message"; msg: string };

const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

async function renderPdf(buf: ArrayBuffer, container: HTMLDivElement): Promise<void> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  container.innerHTML = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.className = styles.PdfPage;
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx) await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  }
}

interface FileViewPaneProps { file?: FileMeta }

const FileViewPane: FC<FileViewPaneProps & Record<string, unknown>> = (props) => {
  const file = (props.file ?? (props.data as FileMeta | undefined) ?? (props as FileMeta)) as FileMeta;
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const pdfRef = useRef<HTMLDivElement>(null);
  const pdfBufRef = useRef<ArrayBuffer | null>(null);

  // Загрузка байтов файла + выбор способа отображения по типу/расширению.
  useEffect(() => {
    const uuid = file?.uuid;
    if (!uuid) { setState({ kind: "message", msg: "Файл не найден" }); return; }
    let cancelled = false;
    let revoke: string | undefined;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await apiClient.get(`/files/download/${uuid}`, { responseType: "arraybuffer" });
        if (cancelled) return;
        const buf = res.data as ArrayBuffer;
        const ext = extOf(file.fileName ?? "");
        const mime = (file.mimeType ?? "").toLowerCase();

        if (mime.startsWith("image/") || IMAGE_EXT.includes(ext)) {
          const url = URL.createObjectURL(new Blob([buf], mime ? { type: mime } : undefined));
          revoke = url;
          setState({ kind: "image", url });
        } else if (mime === "application/pdf" || ext === "pdf") {
          pdfBufRef.current = buf;
          setState({ kind: "pdf" });
        } else if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("ms-excel")) {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
          const html = wb.SheetNames
            .map((n) => `<h3>${escapeHtml(n)}</h3>` + XLSX.utils.sheet_to_html(wb.Sheets[n]))
            .join("");
          if (!cancelled) setState({ kind: "html", html });
        } else if (ext === "docx" || mime.includes("wordprocessingml")) {
          const mammoth = await import("mammoth");
          const result = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setState({ kind: "html", html: result.value });
        } else {
          setState({ kind: "message", msg: `Предпросмотр для «${(ext || "файла").toUpperCase()}» недоступен — скачайте файл.` });
        }
      } catch {
        if (!cancelled) setState({ kind: "message", msg: "Не удалось открыть файл" });
      }
    })();
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [file?.uuid, file?.fileName, file?.mimeType]);

  // PDF рисуем после появления контейнера в DOM (state.kind === "pdf").
  useEffect(() => {
    if (state.kind !== "pdf" || !pdfRef.current || !pdfBufRef.current) return;
    let cancelled = false;
    void renderPdf(pdfBufRef.current, pdfRef.current).catch(() => {
      if (!cancelled) setState({ kind: "message", msg: "Не удалось отрисовать PDF" });
    });
    return () => { cancelled = true; };
  }, [state.kind]);

  return (
    <DocViewport>
      {state.kind === "loading" && <div className={styles.Msg}>Загрузка…</div>}
      {state.kind === "message" && <div className={styles.Msg}>{state.msg}</div>}
      {state.kind === "image" && <img className={styles.Image} src={state.url} alt={file?.fileName ?? ""} />}
      {state.kind === "html" && <div className={styles.HtmlDoc} dangerouslySetInnerHTML={{ __html: state.html }} />}
      {state.kind === "pdf" && <div ref={pdfRef} className={styles.PdfDoc} />}
    </DocViewport>
  );
};
FileViewPane.displayName = "FileViewPane";

export { FileViewPane };
export default FileViewPane;
