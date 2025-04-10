import { FC, ButtonHTMLAttributes } from 'react';
import styles from "./styles.module.scss";

type TProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  onClick?: () => void;
};

const Button: FC<TProps> = ({ variant = 'primary', children, onClick, ...props }) => {
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

export default Button;
