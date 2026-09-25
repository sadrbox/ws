/**
 * Рабочая неделя и время «ЧЧ:ММ» — общее для экранов качества: графики сотрудников («Посещаемость»),
 * рабочее время фирмы («Настройки качества»), производственный календарь.
 *
 * Разбор — как у сервера (backend/services/quality/time.js parseHm, workTime.js parseWorkDays): иначе
 * экран пропустил бы то, что сервер отвергнет, или наоборот.
 */
import { translate } from "src/i18";

// ── Рабочие дни ──────────────────────────────────────────────────────────────

/** ISO-дни недели: 1 — понедельник … 7 — воскресенье (как WorkSchedule.workDays). */
export const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const DAY_KEYS: Record<number, string> = { 1: "dayMon", 2: "dayTue", 3: "dayWed", 4: "dayThu", 5: "dayFri", 6: "daySat", 7: "daySun" };
export const dayLabel = (d: number): string => translate(DAY_KEYS[d] ?? "");

/** «1,2,3,4,5» → флаги пн…вс. Мусор и повторы отбрасываются. */
export function parseWorkDays(v: string | null | undefined): boolean[] {
	const set = new Set(
		String(v ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7),
	);
	return ISO_DAYS.map((d) => set.has(d));
}

/** Флаги пн…вс → «1,2,3» по возрастанию — в том виде, в каком хранит сервер. */
export function formatWorkDays(flags: readonly boolean[]): string {
	return ISO_DAYS.filter((_, i) => !!flags[i]).join(",");
}

/** Подпись дней: подряд идущие — диапазоном («пн–пт», «пн–ср, пт»). */
export function workDaysText(v: string | null | undefined): string {
	const flags = parseWorkDays(v);
	const parts: string[] = [];
	let i = 0;
	while (i < 7) {
		if (!flags[i]) {
			i++;
			continue;
		}
		let j = i;
		while (j + 1 < 7 && flags[j + 1]) j++;
		const a = dayLabel(ISO_DAYS[i]);
		const b = dayLabel(ISO_DAYS[j]);
		parts.push(j === i ? a : j === i + 1 ? `${a}, ${b}` : `${a}–${b}`);
		i = j + 1;
	}
	return parts.join(", ");
}

// ── Время ────────────────────────────────────────────────────────────────────

/** «ЧЧ:ММ» (час может быть одной цифрой) — как принимает сервер (time.parseHm). Иначе null. */
export function parseHm(s: string | null | undefined): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
	if (!m) return null;
	const h = Number(m[1]);
	const mi = Number(m[2]);
	if (h > 23 || mi > 59) return null;
	return h * 60 + mi;
}

/** «9:05» → «09:05»; не время — как есть (ошибку покажет проверка). */
export function normalizeHm(s: string): string {
	const n = parseHm(s);
	return n === null ? s.trim() : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
