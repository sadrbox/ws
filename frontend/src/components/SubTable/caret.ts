/**
 * Фокус в поле ячейки БЕЗ ВЫДЕЛЕНИЯ ТЕКСТА: курсор — в конце значения. Вход в поле (Enter, переход к следующему
 * полю, новая строка) — это продолжение ввода, а не замена значения; выделить всё — двойной клик.
 */
export function focusAtEnd(el: HTMLInputElement | HTMLTextAreaElement): void {
	el.focus();
	// Значение может смениться в onFocus (FieldNumber показывает «1,5» вместо «1.5») — курсор ставим после перерисовки.
	requestAnimationFrame(() => {
		if (document.activeElement !== el) return;
		try {
			const end = el.value.length;
			el.setSelectionRange(end, end);
		} catch { /* поле без выделения (date) — курсор оставляет браузер */ }
	});
}
