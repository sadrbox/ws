import { isoToLocalInput } from "src/utils/datetime";

/**
 * ДАТА ЗАКРЫТИЯ МЕСЯЦА ПО УМОЛЧАНИЮ — КОНЕЦ ЗАКРЫВАЕМОГО ПЕРИОДА (аудит 26.09, У6).
 *
 * Раньше по умолчанию стояло «сейчас»: закрытие сентября, сделанное 05.10, датировалось
 * октябрём, и его проводки (и амортизация) падали в октябрь — ОСВ сентября без закрытия,
 * финрезультат 0. Датируем последним днём периода, 23:59 по местному времени; сервер
 * со своей стороны тоже датирует проводки концом периода (зона «учёт»).
 */
export function monthCloseDefaultDate(period: string): string {
	const m = /^(\d{4})-(\d{2})$/.exec(period.trim());
	if (!m) return "";
	const y = Number(m[1]);
	const mo = Number(m[2]);
	if (mo < 1 || mo > 12) return "";
	const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
	return `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}T23:59`;
}

/**
 * Период по умолчанию — предыдущий месяц (обычно закрывают завершившийся). Считается от
 * МЕСТНОЙ даты: по UTC с 00:00 до 05:00 первого числа «сейчас» — ещё прошлый месяц, и
 * по умолчанию предлагался позапрошлый.
 */
export function previousMonthPeriod(now: Date = new Date()): string {
	const local = isoToLocalInput(now); // "YYYY-MM-DDTHH:mm" в поясе приложения
	let y = Number(local.slice(0, 4));
	let mo = Number(local.slice(5, 7)) - 1;
	if (mo < 1) { mo = 12; y -= 1; }
	return `${y}-${String(mo).padStart(2, "0")}`;
}
