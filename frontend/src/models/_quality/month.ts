/**
 * Месяц бонуса «ГГГГ-ММ» — общие чистые функции экранов E17 («Итоги месяца», реестр нарушений).
 *
 * МЕСЯЦ МЕСТНЫЙ, А НЕ БРАУЗЕРНЫЙ. Сервер считает месяц выявления по смещению из настроек
 * качества (Казахстан — UTC+5), и в первые часы месяца браузер в другом поясе назвал бы
 * «текущим» соседний. Поэтому текущий месяц считается по смещению, которое приложение уже
 * знает (datetime.getAppUtcOffset), а не по `new Date().getMonth()`.
 *
 * Та же арифметика, что в backend/services/quality/time.js: расхождение здесь дало бы экрану
 * месяц, которого сервер не знает.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** Корректный ли месяц «ГГГГ-ММ». */
export function isMonth(v: unknown): v is string {
	return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** Сдвиг месяца «ГГГГ-ММ» на n (может быть отрицательным). */
export function addMonths(ym: string, n: number): string {
	const [y, m] = ym.split("-").map(Number);
	const idx = y * 12 + (m - 1) + n;
	return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Текущий месяц по местному времени: смещение от UTC в минутах. */
export function currentMonth(offsetMinutes: number, now: number = Date.now()): string {
	const t = new Date(now + offsetMinutes * 60_000);
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

/** Сегодняшняя дата «ГГГГ-ММ-ДД» по местному времени (для поля даты и проверки «не в будущем»). */
export function localYmd(offsetMinutes: number, now: number = Date.now()): string {
	const t = new Date(now + offsetMinutes * 60_000);
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Последние n месяцев, начиная с `from` и назад: для отбора списка по месяцу бонуса. */
export function recentMonths(n: number, from: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(addMonths(from, -i));
	return out;
}

/**
 * Подпись месяца на языке интерфейса: «Сентябрь 2026», «Қыркүйек 2026».
 *
 * Названия месяцев даёт Intl, а не словарь: двенадцать ключей на двух языках ради подписи
 * в выпадающем списке — лишнее, а браузер знает оба языка. Если Intl не справился
 * (урезанная сборка ICU), показываем сам месяц: «2026-09» понятен, пустота — нет.
 */
export function monthLabel(ym: string, lang: "ru" | "kk" = "ru"): string {
	if (!isMonth(ym)) return ym;
	const [y, m] = ym.split("-").map(Number);
	try {
		const name = new Intl.DateTimeFormat(lang === "kk" ? "kk-KZ" : "ru-RU", { month: "long", timeZone: "UTC" })
			.format(new Date(Date.UTC(y, m - 1, 1)));
		if (!name || /^\d+$/.test(name)) return ym;
		return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)} ${y}`;
	} catch {
		return ym;
	}
}
