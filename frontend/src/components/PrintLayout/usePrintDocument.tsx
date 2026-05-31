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
import { DocSheet, type DocOrientation } from "src/components/DocViewport";
// ?inline — компилированный CSS того же модуля, что стилизует .DocSheet на
// экране. Единый источник стилей листа для предпросмотра и печати.
import docSheetCss from "src/components/DocViewport/DocViewport.module.scss?inline";

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
  /* Геометрию/типографику листа задаёт ЕДИНЫЙ источник — .DocSheet
     (DocViewport.module.scss), стили которого переносятся в iframe вместе
     со стилями приложения. Здесь — только @page и общесистемные базовые
     правила. Скрытый iframe-предпросмотр (screen) обрамляем серым фоном. */
  @media screen {
    body { padding: 16px; background: #f0f0f0; }
  }
  /* Нейтрализуем глобальные размеры/отступы из стилей приложения, иначе
     появляется лишняя пустая страница. Геометрию листа в печати задаёт
     @media print .DocSheet (padding:0; width:100%; min-height:0). */
  @media print {
    html, body {
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
    }
    #print-root { height: auto !important; min-height: 0 !important; }
    /* Лист (DocSheet) — высота строго по контенту, ширина по печатной области.
       Селектор по id перебивает любые правила .DocSheet (в т.ч. min-height:297mm),
       поэтому форсированная высота не «вытекает» на лишнюю пустую страницу.
       Физические поля задаёт @page; собственные отступы листа обнуляем. */
    #print-root > * {
      width: auto !important;
      max-width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
    }
  }
`;

export interface PrintOptions {
  /** Заголовок окна печати (отображается в title-bar диалога). */
  title?: string;
  /** Дополнительный CSS, который добавится в iframe. */
  extraCss?: string;
  /** Автоматически закрыть iframe после диалога печати (по умолчанию true). */
  autoClose?: boolean;
  /** Ориентация листа (передаётся в DocSheet — единый источник стилей). */
  orientation?: DocOrientation;
  /** Режим ширины листа (a4 | content) — передаётся в DocSheet. */
  fit?: "a4" | "content";
  /**
   * CSS макета для впрыска в iframe — компилированный текст CSS-модуля(ей)
   * макета, полученный `?inline`-импортом того же .scss, что стилизует экран.
   * Так печать и предпросмотр используют ОДИН источник стилей без копирования
   * всего бандла. Стили листа (.DocSheet) добавляются автоматически.
   */
  styles?: string | string[];
}

/** Создать iframe, отрендерить в него node и вызвать print(). */
function printNode(
  node: ReactNode,
  opts: PrintOptions = {},
  onTriggered?: () => void,
): Promise<void> {
  return new Promise((resolve) => {
    const { title = "Печать", extraCss = "", autoClose = true, orientation = "portrait", fit = "a4", styles = [] } = opts;
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

    // ЕДИНЫЙ источник стилей: в iframe впрыскиваем только релевантный CSS —
    // стили листа (.DocSheet, тот же файл что и в предпросмотре) и CSS-модуль(и)
    // макета, переданные через opts.styles (?inline-импорт того же .scss).
    // Весь бандл приложения НЕ копируется — нет глобальных правил и лишней
    // страницы. PRINT_CSS/extraCss идут ПОСЛЕ (приоритет @page и базовых правил).
    const layoutCss = ([] as string[]).concat(styles).join("\n");

    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style data-sheet-css>${docSheetCss}</style><style data-layout-css>${layoutCss}</style><style data-print-css>${PRINT_CSS}\n${extraCss}</style></head><body><div id="print-root"></div></body></html>`);
    doc.close();

    const mountNode = doc.getElementById("print-root")!;
    let root: Root | null = null;
    try {
      root = createRoot(mountNode);
      // Единый источник стилей листа: тот же DocSheet, что и в предпросмотре.
      root.render(<DocSheet orientation={orientation} fit={fit}>{node}</DocSheet>);
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
