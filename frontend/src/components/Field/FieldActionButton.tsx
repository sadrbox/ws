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
import styles from "./Field.module.scss";

export interface FieldActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Имя иконки из общего реестра (clear, quickselect, list, open). */
  icon: IconName;
  /** Подпись (title + aria-label). */
  label: string;
  /** Спиннер вместо иконки на время длительной операции. */
  loading?: boolean;
  /** Смысловая окраска. warn — действие требует внимания (оранжевая иконка
   *  + точка-маркер): напр. документ разошёлся с основанием. */
  tone?: "warn";
}

const FieldActionButton = forwardRef<HTMLButtonElement, FieldActionButtonProps>(
  ({ icon, label, loading, tone, className, tabIndex = -1, onMouseDown, onClick, ...rest }, ref) => (
    <IconButton
      ref={ref}
      size="sm"
      icon={icon}
      title={label}
      aria-label={label}
      loading={loading}
      className={[tone === "warn" ? styles.FieldActionWarn : null, className].filter(Boolean).join(" ") || undefined}
      tabIndex={tabIndex}
      // Предотвращаем перенос фокуса на кнопку при клике мышью — фокус остаётся
      // на input поля. Иначе после клика по «Быстрый выбор» (или другой field-
      // action) input теряет фокус, и клавиши Up/Down уходят выше (например,
      // в SubTable → перемещение activeRow). Обработчик из props при необходимости
      // вызывается после нашего preventDefault.
      //
      // Также останавливаем всплытие mousedown/click до контейнера строки
      // SubTable. Иначе Table.handleRowClick трактует клик по кнопке как
      // клик по строке, blur()ит активный input и фокусирует scroll-контейнер
      // таблицы — после чего стрелки Up/Down управляют activeRow вместо
      // выпадающего списка LookupField.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMouseDown?.(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      {...rest}
    />
  ),
);
FieldActionButton.displayName = "FieldActionButton";

export default FieldActionButton;
