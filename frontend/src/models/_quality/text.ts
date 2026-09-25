/**
 * Тексты экранов качества: подстановка значений в переведённый шаблон и экранирование для окна
 * подтверждения.
 */

/**
 * «Закрыть месяц {month}?» → «Закрыть месяц Сентябрь 2026?». Шаблон — из словаря, значения
 * подставляются по именам: порядок слов в казахском другой, и склейка строк его бы сломала.
 */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
	return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** Экранировать текст для окна подтверждения: оно показывает сообщение как HTML. */
export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
