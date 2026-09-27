/**
 * Ctrl+C (⌘C) по активной ячейке: копирование её значения и анимация «скопировано».
 *
 * Копируется то, что ячейка ПОКАЗЫВАЕТ, а не сырое значение строки: у списков свои
 * рендеры (перевод перечислений, подписи ссылок, формат чисел и дат), и в буфер должно
 * попасть ровно то, что человек видит. У поля ввода (SubTable) — его значение.
 *
 * Анимация — атрибут data-copied на .TableBodyCell (стили в Table.module.scss), по тому
 * же приёму, что и data-pulse: атрибут ставится в DOM, минуя React, поэтому копирование
 * не перерисовывает строки и переживает их перерисовку.
 */
import { showToast } from 'src/components/UIToast';
import { translate } from 'src/i18';
import { copyText } from 'src/utils/clipboard';
import { getFormatColumnValue } from './services';
import type { TColumn, TDataItem } from './types';

/** Сколько держится атрибут анимации; самая длинная анимация в стилях — не дольше. */
export const COPY_FLASH_MS = 900;

type TKeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * Ctrl+C / ⌘C в любой раскладке. В латинской (в том числе Dvorak) — по символу клавиши,
 * в нелатинской (русская: key = «с») — по физической клавише C, как это делает сам браузер.
 * Shift и Alt исключены: Ctrl+Shift+C — инструменты разработчика, Ctrl+Alt — это AltGr.
 */
export function isCopyShortcut(e: TKeyLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  const key = e.key.toLowerCase();
  return key === 'c' || (!/^[a-z]$/.test(key) && e.code === 'KeyC');
}

/** Выделен ли мышью текст внутри таблицы: тогда копирует браузер, как обычно. */
export function hasTextSelectionIn(root: HTMLElement): boolean {
  const sel = window.getSelection?.();
  return !!sel && !sel.isCollapsed && sel.toString() !== '' && !!sel.anchorNode && root.contains(sel.anchorNode);
}

/** Ячейка тела ЭТОЙ таблицы (не вложенной в раскрытую строку) или null, если строка вне виртуального окна. */
export function findBodyCell(scroller: HTMLElement, rowId: number, colId: string): HTMLElement | null {
  const cells = scroller.querySelectorAll<HTMLElement>(`:scope > table > tbody > tr[data-row-id="${rowId}"] > td[data-col-id]`);
  for (const td of cells) {
    if (td.getAttribute('data-col-id') === colId) return td;
  }
  return null;
}

// Не значение ячейки: кнопки (шеврон, действия поля), иконки, подсказки ошибок SubTable.
const COPY_SKIP = 'button, svg, [aria-hidden="true"], [data-copy-skip]';
const VALUE_CONTROL = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), textarea, select';

function visibleText(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue ?? '';
    else if (child instanceof HTMLBRElement) out += '\n';
    else if (child instanceof Element && !child.matches(COPY_SKIP) && !(child as HTMLElement).hidden) out += visibleText(child);
  });
  return out;
}

/** Текст, который показывает ячейка: значение поля ввода, иначе её видимый текст. */
export function readCellText(cell: HTMLElement): string {
  const control = cell.querySelector(VALUE_CONTROL);
  if (control instanceof HTMLSelectElement) return (control.selectedOptions[0]?.text ?? '').trim();
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) return control.value.trim();
  const text = visibleText(cell).trim();
  if (text) return text;
  // Флажок без подписи (булево поле SubTable) — как булева колонка списка.
  const box = cell.querySelector('input[type="checkbox"]');
  return box instanceof HTMLInputElement && box.checked ? '✔' : '';
}

const flashTimers = new WeakMap<HTMLElement, number>();

/** Анимация результата на ячейке: ok — вспышка и значок «Скопировано», error — «не вышло». */
export function flashCellCopy(cell: HTMLElement, outcome: 'ok' | 'error'): void {
  // .TableBodyCell — единственный ребёнок td (TableBody): подсветка активной ячейки живёт на нём.
  const box = (cell.firstElementChild as HTMLElement | null) ?? cell;
  window.clearTimeout(flashTimers.get(box));
  box.removeAttribute('data-copied');
  // Перезапуск анимации при повторном нажатии: без чтения раскладки браузер склеит
  // снятие и установку атрибута в одно изменение, и анимация не начнётся заново.
  void box.offsetWidth;
  if (outcome === 'ok') box.setAttribute('data-copy-label', translate('cellCopied'));
  else box.removeAttribute('data-copy-label');
  box.setAttribute('data-copied', outcome);
  flashTimers.set(box, window.setTimeout(() => {
    box.removeAttribute('data-copied');
    box.removeAttribute('data-copy-label');
    flashTimers.delete(box);
  }, COPY_FLASH_MS));
}

/**
 * Скопировать значение ячейки. Ячейку ищем в DOM; если строка ушла за виртуальное окно
 * (прокрутили колесом), берём значение из данных в формате списка — без анимации, её
 * некуда показать.
 */
export async function copyTableCell(scroller: HTMLElement | null, row: TDataItem, column: TColumn): Promise<void> {
  const cell = scroller ? findBodyCell(scroller, row.id, column.identifier) : null;
  const text = cell ? readCellText(cell) : String(getFormatColumnValue(row, column));
  const ok = await copyText(text);
  if (cell) flashCellCopy(cell, ok ? 'ok' : 'error');
  if (!ok) showToast(translate('cellCopyError'), 'error');
}
