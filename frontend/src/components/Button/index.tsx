import { FC, ButtonHTMLAttributes } from 'react';
import styles from "./Button.module.scss";

type TProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  onClick?: () => void;
};

export const Button: FC<TProps> = ({ variant = 'secondary', children, onClick, ...props }) => {
  return (
    <button
      className={[styles.Button, styles[variant]].join(" ")}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
};


export const ButtonImage: FC<TProps> = ({ variant = 'secondary', children, onClick, ...props }) => {
  return (
    <button
      className={[styles.ButtonImage, styles[variant]].join(" ")}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
};