/**
 * Tooltip — лёгкая CSS-подсказка с современным видом.
 *
 * Использование:
 *   <Tooltip content={<>Облагаемый оборот = …</>}>
 *     <span>ⓘ</span>
 *   </Tooltip>
 *
 * Реализация: чистый CSS hover/focus-within, без портала и JS-вычислений
 * позиции. Подходит для коротких пояснений (формулы, единицы измерения,
 * нормативные ссылки) рядом с заголовками колонок, лейблами полей.
 *
 * Параметр `placement` управляет позицией popup: top (по умолчанию) /
 * bottom / left / right. Параметр `multiline` включает перенос строк
 * (для длинных формул); по умолчанию контент ужимается до одной строки.
 */
import {
  type FC,
  type ReactNode,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import styles from "./Tooltip.module.scss";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Содержимое подсказки (string | JSX — поддерживает форматирование). */
  content: ReactNode;
  /** Триггер — обычно <span>ⓘ</span> или <button>. */
  children: ReactNode;
  /** Позиция подсказки относительно триггера. */
  placement?: TooltipPlacement;
  /** Максимальная ширина подсказки. По умолчанию 320px. */
  maxWidth?: number | string;
}

const Tooltip: FC<TooltipProps> = ({
  content,
  children,
  placement = "top",
  maxWidth = 320,
  className,
  style,
  ...rest
}) => {
  const cls = [styles.Tooltip, styles[placement], className]
    .filter(Boolean)
    .join(" ");
  const popupStyle: CSSProperties = {
    maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
  };
  return (
    <span className={cls} tabIndex={0} style={style} {...rest}>
      {children}
      <span className={styles.TooltipPopup} role="tooltip" style={popupStyle}>
        {content}
        <span className={styles.TooltipArrow} aria-hidden="true" />
      </span>
    </span>
  );
};

Tooltip.displayName = "Tooltip";
export default Tooltip;
