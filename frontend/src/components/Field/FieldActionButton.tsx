/**
 * FieldActionButton — кнопка-действие внутри поля (LookupField и др.).
 *
 * Тонкая обёртка над общим `IconButton` (size="sm") — обеспечивает
 * единый стиль с тулбаром: hover, focus-visible, disabled, цвета.
 *
 * fieldActions описывают только тип, обработчик, состояние и tooltip —
 * визуальное представление полностью инкапсулировано здесь.
 */

import { forwardRef, type ButtonHTMLAttributes } from "react";
import IconButton from "src/components/IconButton/IconButton";
import type { IconName } from "src/components/IconButton/icons";

export interface FieldActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Имя иконки из общего реестра (clear, quickselect, list, open). */
  icon: IconName;
  /** Подпись (title + aria-label). */
  label: string;
}

const FieldActionButton = forwardRef<HTMLButtonElement, FieldActionButtonProps>(
  ({ icon, label, tabIndex = -1, ...rest }, ref) => (
    <IconButton
      ref={ref}
      size="sm"
      icon={icon}
      title={label}
      aria-label={label}
      tabIndex={tabIndex}
      {...rest}
    />
  ),
);
FieldActionButton.displayName = "FieldActionButton";

export default FieldActionButton;
