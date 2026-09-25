// Разбор cron-выражений для регламентных задач (E17 СК1.7) — чистые функции.
//
// Библиотеки cron в backend нет, а нужно немного: пять полей «минута час день месяц
// день-недели», значения `*`, `*/n`, `a-b`, `a-b/n`, списки через запятую. Время — МЕСТНОЕ
// (смещение из настроек): «1-го числа в 9:00» бухгалтер понимает по часам на стене.
// Дни месяца и недели — по правилу классического cron: если заданы оба, срабатывает любой.

import { localParts, localToUtc, addDaysYmd } from "./time.js";

const FIELDS = [
	{ name: "minute", min: 0, max: 59 },
	{ name: "hour", min: 0, max: 23 },
	{ name: "dom", min: 1, max: 31 },
	{ name: "month", min: 1, max: 12 },
	{ name: "dow", min: 0, max: 7 },
];

function parseField(src, { min, max }) {
	const out = new Set();
	for (const part of src.split(",")) {
		const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
		if (!m) throw new Error(`Не разобрать часть «${part}»`);
		let lo = min;
		let hi = max;
		if (m[1] !== "*") {
			const [a, b] = m[1].split("-").map(Number);
			lo = a;
			hi = b ?? (m[2] ? max : a);
		}
		const step = m[2] ? Number(m[2]) : 1;
		if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`Значение вне диапазона: «${part}»`);
		for (let v = lo; v <= hi; v += step) out.add(v);
	}
	return out;
}

/**
 * Разобрать выражение. Бросает Error с понятным текстом — его показывают в форме расписания.
 * @returns {{minute:Set<number>,hour:Set<number>,dom:Set<number>,month:Set<number>,dow:Set<number>,domAny:boolean,dowAny:boolean}}
 */
export function parseCron(expr) {
	const parts = String(expr ?? "").trim().split(/\s+/);
	if (parts.length !== 5) throw new Error("Ожидается пять полей: минута час день месяц день-недели");
	const parsed = {};
	FIELDS.forEach((f, i) => { parsed[f.name] = parseField(parts[i], f); });
	// 7 и 0 — оба воскресенье.
	if (parsed.dow.has(7)) parsed.dow.add(0);
	parsed.domAny = parts[2] === "*";
	parsed.dowAny = parts[4] === "*";
	return parsed;
}

/** Корректно ли выражение (для валидации формы). null — корректно, иначе текст ошибки. */
export function cronError(expr) {
	try {
		parseCron(expr);
		return null;
	} catch (e) {
		return e.message;
	}
}

function dayMatches(c, ymd) {
	const [, mo, d] = ymd.split("-").map(Number);
	if (!c.month.has(mo)) return false;
	const [y] = ymd.split("-").map(Number);
	const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
	const domOk = c.dom.has(d);
	const dowOk = c.dow.has(dow);
	if (c.domAny && c.dowAny) return true;
	if (c.domAny) return dowOk;
	if (c.dowAny) return domOk;
	return domOk || dowOk;
}

/**
 * Ближайший момент срабатывания СТРОГО ПОСЛЕ `after` (с точностью до минуты).
 * Ищет на 400 дней вперёд; не нашёл (например, 31 февраля) — null.
 */
export function nextCronRun(expr, after, offsetMinutes = 0) {
	const c = typeof expr === "string" ? parseCron(expr) : expr;
	const start = localParts(new Date(new Date(after).getTime() + 60_000), offsetMinutes);
	const hours = [...c.hour].sort((a, b) => a - b);
	const minutes = [...c.minute].sort((a, b) => a - b);
	for (let d = 0; d < 400; d++) {
		const ymd = addDaysYmd(start.ymd, d);
		if (!dayMatches(c, ymd)) continue;
		for (const h of hours) {
			if (d === 0 && h < Math.floor(start.minutes / 60)) continue;
			for (const m of minutes) {
				const mod = h * 60 + m;
				if (d === 0 && mod < start.minutes) continue;
				return localToUtc(ymd, mod, offsetMinutes);
			}
		}
	}
	return null;
}

export default { parseCron, cronError, nextCronRun };
