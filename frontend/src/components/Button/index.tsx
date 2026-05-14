import { FC, ButtonHTMLAttributes, MouseEventHandler } from 'react';
import styles from "./Button.module.scss";

type TProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  onClick?: () => void;
  active?: boolean;
};

export const Button: FC<TProps> = ({ variant = 'secondary', children, onClick, active, onMouseDown, ...props }) => {
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
      className={[styles.Button, styles[variant], classActive].join(" ")}
      onClick={onClick}
      onMouseDown={handleMouseDown}
      {...props}
    >
      {children}
    </button>
  );
};