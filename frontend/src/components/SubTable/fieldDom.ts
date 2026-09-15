/**
 * ПОЛЕ В ЯЧЕЙКЕ ТАБЛИЦЫ — ПО ОБЁРТКЕ, А НЕ ПО ТЕГУ.
 *
 * Каждое Field* (FieldString, FieldNumber, FieldSelect, FieldDate, FieldPeriod, FieldTextarea, LookupField) ставит на
 * свою обёртку `data-field`. Клик и двойной клик в любую часть поля — отступ, значок слева, область кнопок — относятся
 * к полю, а не к «нередактируемой ячейке»; поле без <input> (FieldPeriod — кнопка-список) тоже поле.
 *
 * Кнопки-действия поля («Открыть», «Список», «Очистить») — не поле: клик по ним остаётся нажатием кнопки.
 * Элемент ввода вне Field* («голый» input/textarea/select в ячейке) по-прежнему узнаётся по тегу.
 */
import { focusAtEnd } from "./caret";

const FIELD_SELECTOR = "[data-field]";
const CONTROL_SELECTOR = 'input:not([type="checkbox"]), textarea, select, [role="combobox"][tabindex]';

/** Текстовый элемент ввода: вход — курсор в конце, повторный двойной клик — выделить всё. */
export const isTextControl = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
  (el instanceof HTMLInputElement && el.type !== "checkbox") || el instanceof HTMLTextAreaElement;

/** Поле, в которое пришёлся клик; null — вне поля или по кнопке внутри поля. */
export function fieldOf(target: Element | null): HTMLElement | null {
  const field = target?.closest<HTMLElement>(FIELD_SELECTOR) ?? null;
  if (!field || !target) return null;
  const button = target.closest("button");
  return button && field.contains(button) ? null : field;
}

/** Элемент ввода поля: input, textarea, select или триггер-список (FieldPeriod). */
export const fieldControl = (field: Element): HTMLElement | null => field.querySelector<HTMLElement>(CONTROL_SELECTOR);

/** Элемент ввода под курсором: поле по обёртке, иначе «голый» элемент ввода ячейки; кнопки и прочее — null. */
export function controlAt(target: Element | null): HTMLElement | null {
  const field = fieldOf(target);
  if (field) return fieldControl(field);
  if (!target || target.closest("button")) return null;
  return isTextControl(target) || target instanceof HTMLSelectElement ? target : null;
}

/** В поле не входят: disabled, у триггера-списка — data-disabled или tabIndex -1. */
export function isControlDisabled(control: HTMLElement): boolean {
  if (control.matches(":disabled") || control.getAttribute("data-disabled") === "true") return true;
  return control.getAttribute("role") === "combobox" && !(control instanceof HTMLInputElement) && control.tabIndex < 0;
}

/** Войти в поле: текстовое — фокус с курсором в конце, список и триггер — фокус. */
export function enterControl(control: HTMLElement): void {
  if (isTextControl(control)) focusAtEnd(control);
  else control.focus();
}
