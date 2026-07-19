/**
 * SplitPane — перетаскиваемый разделитель двух областей.
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
  /** С какой стороны находится панель, размером которой управляем. */
  side: "left" | "right";
  /** Размер по умолчанию, % от контейнера. */
  defaultPercent: number;
  /** Границы, % — обе области обязаны оставаться видимыми. */
  min?: number;
  max?: number;
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
}

export function useSplitResize({
  storageKey,
  side,
  defaultPercent,
  min = 15,
  max = 70,
}: UseSplitResizeOptions): SplitResizeApi {
  const [percent, setPercent] = useState<number>(() => {
    const v = Number(localStorage.getItem(storageKey));
    return v >= min && v <= max ? v : defaultPercent;
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const move = (ev: PointerEvent) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (!box || box.width === 0) return;
        const raw =
          side === "right"
            ? ((box.right - ev.clientX) / box.width) * 100
            : ((ev.clientX - box.left) / box.width) * 100;
        setPercent(Math.min(max, Math.max(min, raw)));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      // Пока тянем — гасим выделение текста и держим курсор col-resize,
      // иначе он мигает при уходе указателя с узкой полоски разделителя.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [side, min, max],
  );

  const reset = useCallback(() => setPercent(defaultPercent), [defaultPercent]);

  useEffect(() => {
    localStorage.setItem(storageKey, String(Math.round(percent)));
  }, [storageKey, percent]);

  return { percent, containerRef, startResize, reset };
}

export interface SplitResizerProps {
  onPointerDown: (e: ReactPointerEvent) => void;
  onDoubleClick?: () => void;
  title?: string;
}

/** Полоска-разделитель. Клавиатурой не управляется — размер не влияет на данные. */
export const SplitResizer: FC<SplitResizerProps> = ({ onPointerDown, onDoubleClick, title }) => (
  <div
    className={styles.SplitResizer}
    role="separator"
    aria-orientation="vertical"
    title={title ?? translate("resizePanels")}
    onPointerDown={onPointerDown}
    onDoubleClick={onDoubleClick}
  />
);

SplitResizer.displayName = "SplitResizer";

export default SplitResizer;
