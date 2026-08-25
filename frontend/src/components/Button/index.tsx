import { FC, ButtonHTMLAttributes, MouseEventHandler } from 'react';
import styles from "./Button.module.scss";

type TProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  /** Размер кнопки: sm (маленькая) | md (средняя, по умолчанию) | lg (большая) | min (по контенту). */
  size?: 'sm' | 'md' | 'lg' | 'min';
  onClick?: () => void;
  active?: boolean;
};

const SIZE_CLASS: Record<NonNullable<TProps['size']>, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
  min: styles.sizeMin,
};

export const Button: FC<TProps> = ({ variant = 'secondary', size = 'md', children, onClick, active, onMouseDown, ...props }) => {
  const classActive = active && styles.Active;
  // Не отнимаем фокус у предыдущего элемента (TableScrollWrapper) при клике мышью —
  // см. подробное обоснование в IconButton: preventDefault на mousedown сохраняет
  // клавиатурную навигацию по таблице после нажатия «Добавить» / «Удалить».
  const handleMouseDown: MouseEventHandler<HTMLButtonElement> = (e) => {
    onMouseDown?.(e);
    if (!e.defaultPrevented) e.preventDefault();
  };
  return (
    <button
      type="button"
      className={[styles.Button, styles[variant], SIZE_CLASS[size], classActive].filter(Boolean).join(" ")}
      onClick={onClick}
      onMouseDown={handleMouseDown}
      {...props}
    >
      {children}
    </button>
  );
};
