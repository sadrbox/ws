import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./DocViewport.module.scss";

// ── DocViewport — тёмный контейнер-просмотрщик ─────────────────────────────

const LS_ZOOM_KEY = "doc_viewport_zoom";
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1.0;

function clampZoom(v: number) {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)) * 10) / 10;
}

function readZoom(): number {
  try {
    const v = parseFloat(localStorage.getItem(LS_ZOOM_KEY) ?? "");
    if (!isNaN(v)) return clampZoom(v);
  } catch { /* ignore */ }
  return ZOOM_DEFAULT;
}

function saveZoom(v: number) {
  try { localStorage.setItem(LS_ZOOM_KEY, String(v)); } catch { /* ignore */ }
}

interface DocViewportProps {
  children?: ReactNode;
}

export const DocViewport = ({ children }: DocViewportProps) => {
  const [zoom, setZoom] = useState<number>(readZoom);
  const viewportRef = useRef<HTMLDivElement>(null);

  const adjustZoom = useCallback((delta: number) => {
    setZoom(prev => {
      const next = clampZoom(prev + delta);
      saveZoom(next);
      return next;
    });
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(ZOOM_DEFAULT);
    saveZoom(ZOOM_DEFAULT);
  }, []);

  // Ctrl + колесо мыши
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      adjustZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [adjustZoom]);

  return (
    <div className={styles.DocViewport} ref={viewportRef}>
      <div className={styles.DocScroll}>
        <div className={styles.DocContent} style={{ zoom }}>
          {children}
        </div>
      </div>
      <div className={styles.ZoomControls}>
        <button
          className={styles.ZoomBtn}
          onClick={() => adjustZoom(-ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
          title="Уменьшить (Ctrl + колесо)"
        >−</button>
        <span
          className={styles.ZoomLabel}
          onClick={resetZoom}
          title="Сбросить масштаб (100%)"
        >{Math.round(zoom * 100)}%</span>
        <button
          className={styles.ZoomBtn}
          onClick={() => adjustZoom(ZOOM_STEP)}
          disabled={zoom >= ZOOM_MAX}
          title="Увеличить (Ctrl + колесо)"
        >+</button>
      </div>
    </div>
  );
};

// ── DocSheet — белый A4-лист для React-контента ─────────────────────────────

export type DocOrientation = "portrait" | "landscape";

interface DocSheetProps {
  children?: ReactNode;
  orientation?: DocOrientation;
  fit?: "a4" | "content";
}

export const DocSheet = forwardRef<HTMLDivElement, DocSheetProps>(
  ({ children, orientation = "portrait", fit = "a4" }, ref) => (
    <div
      className={styles.DocSheet}
      ref={ref}
      data-orientation={orientation}
      data-fit={fit}
    >
      {children}
    </div>
  ),
);
DocSheet.displayName = "DocSheet";

// ── DocIframe — белый A4-лист с iframe для HTML-строк ──────────────────────

interface DocIframeProps {
  src?: string;
  title?: string;
  orientation?: DocOrientation;
  iframeRef?: React.Ref<HTMLIFrameElement>;
}

export const DocIframe = ({ src, title, orientation = "portrait", iframeRef }: DocIframeProps) => (
  <iframe
    ref={iframeRef}
    className={styles.DocIframe}
    data-orientation={orientation}
    src={src}
    title={title}
  />
);

// ── DocStatus — заглушка (загрузка / нет данных) ────────────────────────────

interface DocStatusProps {
  children?: ReactNode;
}

export const DocStatus = ({ children }: DocStatusProps) => (
  <div className={styles.DocStatus}>{children}</div>
);
