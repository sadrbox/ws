import { FC, ButtonHTMLAttributes, MouseEventHandler, useContext } from 'react';
import { Icon, type IconName } from 'src/components/IconButton/icons';
import styles from "./Button.module.scss";
import { ButtonSizeContext, type ButtonSize } from "./sizeContext";

/**
 * ЕДИНСТВЕННАЯ кнопка приложения. Иконка — её опция, а не повод завести соседний
 * компонент: своя «кнопка с иконкой» неизбежно разойдётся с этой по высоте, отступам и
 * цветам, и в одном ряду тулбара окажутся две кнопки разного роста. Кнопка с вложенными
 * командами — отдельный компонент (Toolbar.ActionsDropdownButton), но рисует он ЭТУ же
 * кнопку, добавляя каретку и меню.
 *
 * Иконки — из общего реестра (src/components/IconButton/icons), все 16×16.
 */
type TProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  /**
   * Размер кнопки: sm (маленькая) | md (средняя, по умолчанию) | lg (большая) | min (по контенту).
   * Не задан — берётся из области (ButtonSizeContext: тулбар пейна задаёт sm), иначе md.
   */
  size?: ButtonSize;
  /** Ведущая иконка 16×16 из общего реестра. */
  icon?: IconName;
  /** Замыкающая иконка: каретка у кнопки с вложенными командами, и только. */
  trailingIcon?: IconName;
  onClick?: () => void;
  active?: boolean;
};

const SIZE_CLASS: Record<NonNullable<TProps['size']>, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
  min: styles.sizeMin,
};

export const Button: FC<TProps> = ({
  variant = 'secondary', size, icon, trailingIcon, children, onClick, active, onMouseDown, ...props
}) => {
  const areaSize = useContext(ButtonSizeContext);
  const effectiveSize = size ?? areaSize ?? 'md';
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
      className={[styles.Button, styles[variant], SIZE_CLASS[effectiveSize], classActive].filter(Boolean).join(" ")}
      onClick={onClick}
      onMouseDown={handleMouseDown}
      {...props}
    >
      {icon && <Icon name={icon} className={styles.Glyph} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} className={styles.Glyph} />}
    </button>
  );
};
