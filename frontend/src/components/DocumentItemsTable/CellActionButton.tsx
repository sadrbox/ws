/**
 * CellActionButton — компактная кнопка-действие в ячейке таблицы строк документа.
 *
 * Визуально повторяет ghost-стиль FieldActions (прозрачный фон, мягкий hover,
 * то же скругление и focus-ring, что у IconButton): кнопки «Серии»/«Партии» и
 * кнопки внутри LookupField читаются как один тип управляющего элемента.
 *
 * От чистого IconButton отличается тем, что несёт иконку + короткий статус
 * (count/qty у серий, номер партии у партий), поэтому это не квадрат, а пилюля.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "src/components/IconButton/icons";
import styles from "./CellActionButton.module.scss";

export interface CellActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Статус: «5/5», номер партии и т.п. Отражает состояние заполнения. */
  status: ReactNode;
  /** true — статус «в норме» (зелёный), false — «требует внимания» (янтарный). */
  ok?: boolean;
}

const CellActionButton = forwardRef<HTMLButtonElement, CellActionButtonProps>(
  ({ icon, status, ok, className, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={[styles.CellActionButton, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <Icon name={icon} />
      <span className={ok ? styles.StatusOk : styles.StatusBad}>{status}</span>
    </button>
  ),
);
CellActionButton.displayName = "CellActionButton";

export default CellActionButton;
