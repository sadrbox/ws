/**
 * SplitPane — перетаскиваемый разделитель двух областей (`VSplitBar`).
 *
 * Вынесен из ModelList: та же механика понадобилась формам отчётов (панель
 * фильтров ↔ область отчёта), и второй копии логики с ручным pointermove,
 * клампом и персистом быть не должно.
 *
 * Управляемая панель задаётся через `side`:
 *   "right" — размер считается от правого края (список ↔ предпросмотр в ModelList);
 *   "left"  — от левого (фильтры ↔ отчёт в ReportPane).
 *
 * Размер хранится в процентах от контейнера, а не в пикселях: панель MDI меняет
 * ширину, и пиксельная величина при сужении съедала бы вторую область целиком.
 */
import {
  FC, useCallback, useEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { translate } from "src/i18";
import styles from "./SplitPane.module.scss";

export interface UseSplitResizeOptions {
  /** Ключ localStorage для запоминания размера (per-list / per-report). */
  storageKey: string;
  /**
   * С какой стороны находится панель, размером которой управляем.
   *
   * "right"/"left" — области стоят в РЯД и делят ширину; "bottom"/"top" — стоят СТОЛБЦОМ и
   * делят высоту. Вертикальное деление понадобилось «Техническим сообщениям»: длинный текст
   * ошибки в узкой колонке справа превращается в лесенку из двух слов, и его уместнее
   * положить полосой внизу.
   */
  side: "left" | "right" | "top" | "bottom";
  /** Размер по умолчанию, % от контейнера. */
  defaultPercent: number;
  /** Границы, % — обе области обязаны оставаться видимыми. */
  min?: number;
  max?: number;
  /**
   * Считаться с тем, сколько места область СМОГЛА занять.
   *
   * Проценты — доля контейнера, но у соседней области бывает собственный минимум
   * (`min-width: min-content` у пейнов), и тогда запрошенная доля недостижима: вёрстка
   * подрезает панель, а хук продолжает думать, что она шире. Указатель уходит дальше,
   * а граница стоит — и на обратном ходе панель не двигается, пока процент не упадёт
   * до реального предела: разделитель выглядит залипшим.
   *
   * Включено — предел вычисляется из разметки: как только панель не добрала
   * запрошенного, выше добранного не поднимаемся. Выключено (по умолчанию) — прежнее
   * поведение для мест, где у соседа минимума нет.
   */
  clampToContent?: boolean;
}

export interface SplitResizeApi {
  /** Текущий размер управляемой панели, % от контейнера. */
  percent: number;
  /** Навесить на контейнер: от него считается доля при перетаскивании. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Обработчик onPointerDown для разделителя. */
  startResize: (e: ReactPointerEvent) => void;
  /** Сброс к значению по умолчанию (двойной клик по разделителю). */
  reset: () => void;
  /** Сдвиг на дельту в процентах — для управления разделителем с клавиатуры. */
  nudge: (deltaPercent: number) => void;
}

export function useSplitResize({
  storageKey,
  side,
  defaultPercent,
  min = 15,
  max = 70,
  clampToContent = false,
}: UseSplitResizeOptions): SplitResizeApi {
  const [percent, setPercent] = useState<number>(() => {
    const v = Number(localStorage.getItem(storageKey));
    return v >= min && v <= max ? v : defaultPercent;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  // Зеркало текущего процента — стартовое значение для дельта-перетаскивания
  // (без зависимости startResize от percent).
  const percentRef = useRef(percent);
  percentRef.current = percent;

  /**
   * Привести запрошенную долю к той, что панель реально заняла. ТОЛЬКО ПО ОТПУСКАНИЮ.
   *
   * Панель — крайний элемент контейнера со стороны `side`: так стоят обе области во всех
   * местах приложения (пейны ↔ сообщения, список ↔ предпросмотр, фильтры ↔ отчёт).
   *
   * ПОЧЕМУ НЕ ВО ВРЕМЯ ПЕРЕТАСКИВАНИЯ. Измерение, поданное обратно в состояние на каждом
   * движении, замыкает круг: доля → разметка → измерение → доля. Пока предел неподвижен,
   * круг сходится, но минимум соседа сам зависит от отданной ему ширины (таблица
   * переносит тулбар, появляется полоса прокрутки) — и панель начинала прыгать между двумя
   * значениями на каждом кадре. Поэтому во время движения доля идёт за указателем и ничем,
   * кроме min/max, не ограничена: за край не пустит вёрстка (`flex-shrink` у панели), а
   * согласуем записанное с действительным один раз, когда движение закончилось.
   */
  const settleToContent = useCallback(() => {
    if (!clampToContent) return;
    const vertical = side === "top" || side === "bottom";
    const box = containerRef.current?.getBoundingClientRect();
    const size = vertical ? box?.height : box?.width;
    const panel = side === "right" || side === "bottom"
      ? containerRef.current?.lastElementChild
      : containerRef.current?.firstElementChild;
    if (!size || !(panel instanceof HTMLElement)) return;
    const rect = panel.getBoundingClientRect();
    const got = ((vertical ? rect.height : rect.width) / size) * 100;
    // Меньше запрошенного — значит упёрлись в соседа: запоминаем достижимое, иначе
    // следующее перетаскивание начнётся с доли, которой на экране никогда не было.
    setPercent((p) => (got < p - 0.5 ? Math.max(min, got) : p));
  }, [clampToContent, side, min]);

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      // ДЕЛЬТА, а не абсолют: двигаем от стартовой позиции/процента, поэтому граница
      // не «прыгает» под курсор при клике не ровно по разделителю (offset схвата).
      const vertical = side === "top" || side === "bottom";
      const startClient = vertical ? e.clientY : e.clientX;
      const startPercent = percentRef.current;
      const move = (ev: PointerEvent) => {
        const box = containerRef.current?.getBoundingClientRect();
        const size = vertical ? box?.height : box?.width;
        if (!box || !size) return;
        const deltaPercent = (((vertical ? ev.clientY : ev.clientX) - startClient) / size) * 100;
        // Панель у дальнего края (right/bottom) от движения «к себе» сужается, у ближнего
        // (left/top) — расширяется: знак дельты зависит только от этого.
        const raw = side === "right" || side === "bottom"
          ? startPercent - deltaPercent
          : startPercent + deltaPercent;
        setPercent(Math.min(max, Math.max(min, raw)));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        // После кадра: последнее движение к этому моменту ещё не разложено в разметку.
        requestAnimationFrame(settleToContent);
      };
      // Пока тянем — гасим выделение текста и держим курсор col-resize,
      // иначе он мигает при уходе указателя с узкой полоски разделителя.
      document.body.style.userSelect = "none";
      document.body.style.cursor = vertical ? "row-resize" : "col-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [side, min, max, settleToContent],
  );

  const reset = useCallback(() => setPercent(defaultPercent), [defaultPercent]);

  // Клавиатурный сдвиг живёт здесь, а не в разделителе: границы и персист — забота хука.
  const nudge = useCallback(
    (delta: number) => {
      setPercent((p) => Math.min(max, Math.max(min, p + delta)));
      // Шаг с клавиатуры — то же движение, только дискретное: согласуем после кадра.
      requestAnimationFrame(settleToContent);
    },
    [min, max, settleToContent],
  );

  useEffect(() => {
    localStorage.setItem(storageKey, String(Math.round(percent)));
  }, [storageKey, percent]);

  return { percent, containerRef, startResize, reset, nudge };
}

export interface VSplitBarProps {
  onPointerDown: (e: ReactPointerEvent) => void;
  onDoubleClick?: () => void;
  title?: string;
  /**
   * Сдвиг стрелками, % за нажатие. Передан — разделитель получает фокус и управляется
   * с клавиатуры; не передан — остаётся чисто мышиным, как был.
   */
  onNudge?: (deltaPercent: number) => void;
  /** Как стоят области: "vertical" — рядом, "horizontal" — одна под другой. */
  orientation?: "vertical" | "horizontal";
}

/**
 * Полоска-разделитель: одна на все раздвоенные области приложения.
 *
 * `orientation` — как СТОЯТ ОБЛАСТИ, а не сама полоса: "vertical" делит экран на левую и
 * правую (полоса вертикальная), "horizontal" — на верхнюю и нижнюю. Зазор вокруг полосы
 * задаёт она сама (см. SplitPane.module.scss): области к ней не прилипают и своих отступов
 * не держат.
 */
export const VSplitBar: FC<VSplitBarProps> = ({
  onPointerDown, onDoubleClick, title, onNudge, orientation = "vertical",
}) => (
  <div
    className={orientation === "horizontal" ? styles.HSplitBar : styles.VSplitBar}
    role="separator"
    aria-orientation={orientation}
    title={title ?? translate("resizePanels")}
    onPointerDown={onPointerDown}
    onDoubleClick={onDoubleClick}
    {...(onNudge ? {
      tabIndex: 0,
      onKeyDown: (e: React.KeyboardEvent) => {
        const back = orientation === "horizontal" ? "ArrowUp" : "ArrowLeft";
        const fwd = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";
        if (e.key === back) onNudge(-2);
        else if (e.key === fwd) onNudge(2);
        else return;
        e.preventDefault();
      },
    } : {})}
  />
);

VSplitBar.displayName = "VSplitBar";

export default VSplitBar;
