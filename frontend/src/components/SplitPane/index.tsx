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
   * МИНИМУМ ОБЕИХ ОБЛАСТЕЙ В ПИКСЕЛЯХ — предел, который и виден человеку.
   *
   * Проценты говорят о доле, а невместимость измеряется не долей: 20 % от полутора тысяч
   * пикселей — удобная колонка, от шестисот — полоска, в которую не влезает и кнопка.
   * Поэтому предел задаётся в пикселях и считается по РЕАЛЬНОМУ размеру контейнера.
   *
   * Окно уже двух минимумов — делим пополам: лучше две тесные области, чем одна нормальная
   * и одна в ноль. Ноль (по умолчанию) — предел только процентный, как было.
   */
  minPx?: number;
  /**
   * CSS-переменная контейнера, которой задаётся размер области («--tech-width»).
   *
   * Передана — во время перетаскивания хук пишет размер ПРЯМО В DOM, не трогая состояние
   * React: перерисовывать на каждое движение указателя область, в которой открыт список
   * задач или переписка, — это и есть те самые рывки. Состояние догоняет один раз, когда
   * движение закончилось.
   */
  cssVar?: string;
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
  minPx = 0,
  cssVar,
}: UseSplitResizeOptions): SplitResizeApi {
  const [percent, setPercent] = useState<number>(() => {
    const v = Number(localStorage.getItem(storageKey));
    return v >= min && v <= max ? v : defaultPercent;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  // Зеркало текущего процента: обработчики перетаскивания живут вне React-рендера и
  // не должны от него зависеть — иначе каждое движение пересоздавало бы их.
  const percentRef = useRef(percent);
  percentRef.current = percent;

  const vertical = side === "top" || side === "bottom";
  /** Панель у дальнего края (right/bottom) меряется от конца контейнера, у ближнего — от начала. */
  const far = side === "right" || side === "bottom";

  /**
   * Свести желаемый размер панели (в пикселях) к возможному.
   *
   * ПРЕДЕЛ — ПИКСЕЛЬНЫЙ И ВИДИМЫЙ. Обе области обязаны остаться пригодными для работы, поэтому
   * ни одна не становится уже `minPx`. Процентные `min`/`max` остаются как грубая рамка (и как
   * прежнее поведение там, где `minPx` не задан), но решает именно пиксельный предел: он не
   * зависит от того, насколько широко окно.
   *
   * ОКНО УЖЕ ДВУХ МИНИМУМОВ — делим пополам. Иначе пришлось бы выбирать, какая из областей
   * останется полноценной, а какая схлопнется в ноль, — а это не выбор, это поломка.
   */
  const clampPx = useCallback((wanted: number, size: number): number => {
    const lo = Math.min(minPx, size / 2);
    const hi = Math.max(lo, size - Math.min(minPx, size / 2));
    const byPercent = { lo: (min / 100) * size, hi: (max / 100) * size };
    // Пиксельный предел строже процентного там, где они спорят: он про пригодность к работе.
    const low = minPx > 0 ? Math.max(lo, Math.min(byPercent.lo, hi)) : byPercent.lo;
    const high = minPx > 0 ? Math.min(hi, Math.max(byPercent.hi, low)) : byPercent.hi;
    return Math.min(high, Math.max(low, wanted));
  }, [min, max, minPx]);

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const startClient = vertical ? e.clientY : e.clientX;
      /*
       * ОТСЧЁТ ОТ ФАКТИЧЕСКОГО РАЗМЕРА ОБЛАСТИ, А НЕ ОТ КРАЁВ КОНТЕЙНЕРА.
       *
       * Считать «сколько осталось от указателя до края» нельзя: между полосой и областью есть
       * зазор, сама полоса имеет ширину, у контейнера бывают отступы — всё это складывалось в
       * постоянное смещение, и разделитель ехал не там, где курсор.
       *
       * Здесь размер области меняется РОВНО на столько, на сколько сдвинулся указатель: полоса
       * остаётся под курсором в той же точке, за которую её взяли, чем бы ни была обставлена
       * вёрстка. Отсчёт при этом абсолютный — от размера на момент нажатия, — поэтому
       * накопленной ошибки, из-за которой обратный ход «залипал», не возникает.
       */
      const box = container.getBoundingClientRect();
      // Размер на момент нажатия — из доли, которой область сейчас и нарисована (flex-basis:
      // X% контейнера). Мерить сам элемент значило бы знать, который он по счёту, а порядок
      // детей у контейнеров разный: где-то первым идёт портал шапки, где-то сама область.
      const startSize = (percentRef.current / 100) * (vertical ? box.height : box.width);

      let frame = 0;
      let last = percentRef.current;
      const apply = (pct: number) => {
        last = pct;
        /*
         * ВО ВРЕМЯ ДВИЖЕНИЯ — МИМО REACT. Размер пишется в CSS-переменную контейнера: браузер
         * перекладывает флексы сам, без перерисовки поддерева. Перерисовывать на каждое
         * движение область, в которой открыты переписка или список задач, — это и есть рывки,
         * из-за которых разделитель «залипал».
         */
        if (cssVar) container.style.setProperty(cssVar, `${pct}%`);
        else setPercent(pct);
      };

      const move = (ev: PointerEvent) => {
        // Не чаще кадра: события указателя приходят пачками, а показать можно только один раз.
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const now = container.getBoundingClientRect();
          const size = vertical ? now.height : now.width;
          if (!size) return;
          const moved = (vertical ? ev.clientY : ev.clientX) - startClient;
          // Область у дальнего края растёт, когда указатель идёт «к себе», у ближнего — наоборот.
          const wanted = startSize + (far ? -moved : moved);
          apply((clampPx(wanted, size) / size) * 100);
        });
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        // Состояние догоняет один раз — и оно же уходит в localStorage.
        if (cssVar) {
          container.style.removeProperty(cssVar);
          setPercent(last);
        }
      };

      // Пока тянем — гасим выделение текста и держим курсор col-resize,
      // иначе он мигает при уходе указателя с узкой полоски разделителя.
      document.body.style.userSelect = "none";
      document.body.style.cursor = vertical ? "row-resize" : "col-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      // Системная отмена жеста (окно потеряло фокус, палец ушёл за экран) — тот же конец:
      // без этого слушатели оставались висеть, а курсор — col-resize на всём приложении.
      window.addEventListener("pointercancel", up);
    },
    [vertical, far, cssVar, clampPx],
  );

  const reset = useCallback(() => setPercent(defaultPercent), [defaultPercent]);

  // Клавиатурный сдвиг живёт здесь, а не в разделителе: границы и персист — забота хука.
  const nudge = useCallback(
    (delta: number) => setPercent((p) => {
      const box = containerRef.current?.getBoundingClientRect();
      const size = box ? (vertical ? box.height : box.width) : 0;
      const wanted = p + delta;
      // Без контейнера (в тестах и до первой раскладки) остаётся процентная рамка.
      return size ? (clampPx((wanted / 100) * size, size) / size) * 100 : Math.min(max, Math.max(min, wanted));
    }),
    [vertical, clampPx, min, max],
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
