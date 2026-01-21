import { FC, ButtonHTMLAttributes } from 'react';
import styles from "./Button.module.scss";

type TProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  onClick?: () => void;
  active?: boolean;
};

export const Button: FC<TProps> = ({ variant = 'secondary', children, onClick, active, ...props }) => {
  const classActive = active && styles.Active;
  return (
    <button
      className={[styles.Button, styles[variant], classActive].join(" ")}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
};


export const ButtonImage: FC<TProps> = ({ variant = 'secondary', children, onClick, active, ...props }) => {
  const classActive = active && styles.Active;
  return (
    <button
      className={[styles.ButtonImage, styles[variant], classActive].join(" ")}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
};