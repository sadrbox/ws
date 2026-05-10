/**
 * Переиспользуемый механизм печати документов в формате A4.
 *
 * Используется через хук `usePrintDocument()`:
 * ```tsx
 * const { print } = usePrintDocument();
 * <Button onClick={() => print(<SaleInvoicePrint sale={sale} />)}>Печать</Button>
 * ```
 *
 * Реализация: рендерит ReactNode в скрытый iframe (изолированные стили),
 * дожидается полного рендера и вызывает `iframe.contentWindow.print()`.
 * Так не зависим от шрифтов/стилей основного документа и можем точно
 * контролировать `@page { size: A4 }`.
 */
import { useCallback, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const PRINT_CSS = `
  @page {
    size: A4;
    margin: 12mm 12mm 14mm 16mm;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: "Times New Roman", Times, serif;
    font-size: 10pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  * { box-sizing: border-box; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 3px 4px; vertical-align: top; }
  .a4-sheet {
    width: 210mm;
    min-height: 297mm;
    padding: 0;
    margin: 0 auto;
    background: #fff;
  }
  @media screen {
    body { padding: 16px; background: #f0f0f0; }
    .a4-sheet { box-shadow: 0 0 8px rgba(0,0,0,0.15); padding: 12mm 12mm 14mm 16mm; }
  }
`;

export interface PrintOptions {
  /** Заголовок окна печати (отображается в title-bar диалога). */
  title?: string;
  /** Дополнительный CSS, который добавится в iframe. */
  extraCss?: string;
  /** Автоматически закрыть iframe после диалога печати (по умолчанию true). */
  autoClose?: boolean;
}

/** Создать iframe, отрендерить в него node и вызвать print(). */
function printNode(
  node: ReactNode,
  opts: PrintOptions = {},
  onTriggered?: () => void,
): Promise<void> {
  return new Promise((resolve) => {
    const { title = "Печать", extraCss = "", autoClose = true } = opts;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}\n${extraCss}</style></head><body><div id="print-root"></div></body></html>`);
    doc.close();

    const mountNode = doc.getElementById("print-root")!;
    let root: Root | null = null;
    try {
      root = createRoot(mountNode);
      root.render(<div className="a4-sheet">{node}</div>);
    } catch (e) {
      console.error("[print] render error", e);
      iframe.remove();
      onTriggered?.();
      resolve();
      return;
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { root?.unmount(); } catch { /* noop */ }
      iframe.remove();
      resolve();
    };

    // Дать React смонтироваться + ждать загрузки шрифтов/изображений.
    const trigger = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error("[print] window.print failed", e);
      }
      // Освобождаем UI-блокировку сразу после открытия диалога печати,
      // чтобы повторный клик «Печать» работал, даже если пользователь
      // отменил предыдущий диалог (afterprint в этом случае может не
      // сработать в некоторых браузерах).
      onTriggered?.();
      if (autoClose) {
        const win = iframe.contentWindow;
        if (win) {
          // afterprint — основной сигнал закрытия диалога.
          win.addEventListener("afterprint", cleanup, { once: true });
          // matchMedia("print") — более надёжный кроссбраузерный fallback.
          try {
            const mql = win.matchMedia?.("print");
            if (mql) {
              const onChange = (e: MediaQueryListEvent) => {
                if (!e.matches) cleanup();
              };
              mql.addEventListener?.("change", onChange);
            }
          } catch { /* noop */ }
          // Жёсткий fallback — короткий тайм-аут, если оба сигнала не пришли.
          setTimeout(cleanup, 10_000);
        } else {
          setTimeout(cleanup, 1000);
        }
      } else {
        resolve();
      }
    };

    // Дать DOM-у успеть отрисоваться + загрузиться шрифтам.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const doc2 = iframe.contentDocument as Document & { fonts?: { ready?: Promise<unknown> } };
        if (doc2.fonts?.ready) {
          doc2.fonts.ready.then(trigger).catch(trigger);
        } else {
          setTimeout(trigger, 100);
        }
      });
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/**
 * Хук, возвращающий метод `print(node, opts)` для вызова печати ReactNode на A4.
 * См. также готовый компонент-обёртку `<A4Page>` в `./A4Page.tsx`.
 *
 * Блокировка от двойного клика снимается сразу после открытия системного
 * диалога печати — повторное нажатие после отмены диалога работает мгновенно.
 */
export function usePrintDocument() {
  const busyRef = useRef(false);

  const print = useCallback(async (node: ReactNode, opts?: PrintOptions) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const release = () => { busyRef.current = false; };
    try {
      await printNode(node, opts, release);
    } finally {
      // На случай, если onTriggered не успел сработать (ошибка рендера и т.п.).
      release();
    }
  }, []);

  return { print };
}
