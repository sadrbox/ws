/**
 * IconButton — универсальная иконочная кнопка.
 *
 * Используется в Toolbar, FieldActions (LookupField), и любых других
 * местах где нужна квадратная кнопка-икона с единым стилем.
 *
 * Размер по умолчанию — 24×24 (тулбар). Для компактных мест передавайте
 * size="sm" (20×20) — например, внутри строк таблицы.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import styles from "./IconButton.module.scss";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Имя иконки из реестра. Можно не указывать, если передан children. */
  icon?: IconName;
  /** Активное состояние (подсвечивает кнопку). */
  active?: boolean;
  /** Размер: md (24px, по умолчанию) или sm (20px, для inline-таблиц). */
  size?: "md" | "sm";
  /** Анимация вращения (для long-running операций — пересчёт, reload). */
  loading?: boolean;
  /** Произвольный контент (img или другой SVG) — если icon не указан. */
  children?: ReactNode;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { icon, active, size = "md", loading, className, children, type, ...rest },
    ref,
  ) => {
    const cls = [
      styles.IconButton,
      size === "sm" ? styles.sm : styles.md,
      active ? styles.active : null,
      loading ? styles.loading : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button ref={ref} type={type ?? "button"} className={cls} {...rest}>
        {icon ? <Icon name={icon} /> : children}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";

export default IconButton;
