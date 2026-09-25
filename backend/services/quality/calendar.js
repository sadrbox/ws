// Производственный календарь (E17) — работа с базой. Правила — в workTime.js.
//
// Календарь общий на установку (РК). Год, которого ещё нет в таблице, заполняется сам по закону
// (праздники + переносы с выходных, computeRkCalendar) при первом обращении — так правила не
// начинают 1 января следующего года считать праздники рабочими днями. Дополнительные переносы по
// постановлению Правительства и дату Курбан айта вносят руками (экран «Производственный календарь»).
import { prisma } from "../../prisma/prisma-client.js";
import { computeRkCalendar, makeDayKind, workOptions } from "./workTime.js";
import { localParts } from "./time.js";

const TTL_MS = 5 * 60_000;
let cache = { at: 0, entries: null };
const seededYears = new Set();

/** Заполнить год по закону, если по нему в календаре ещё нет ни одной записи. */
export async function ensureCalendarYear(year) {
	if (seededYears.has(year)) return 0;
	const count = await prisma.workCalendarDay.count({ where: { date: { startsWith: `${year}-` } } });
	seededYears.add(year);
	if (count > 0) return 0;
	const rows = computeRkCalendar(year).map((d) => ({ ...d, source: "seed" }));
	const r = await prisma.workCalendarDay.createMany({ data: rows, skipDuplicates: true });
	cache = { at: 0, entries: null };
	return r.count;
}

/** Все записи календаря (кэш 5 минут; изменения с экрана сбрасывают кэш). */
export async function loadCalendar() {
	if (cache.entries && Date.now() - cache.at < TTL_MS) return cache.entries;
	const now = new Date();
	const y = localParts(now, 300).year;
	// Текущий и следующий год — всегда в календаре: сроки в декабре заходят в январь.
	await ensureCalendarYear(y);
	await ensureCalendarYear(y + 1);
	const entries = await prisma.workCalendarDay.findMany({ select: { date: true, kind: true, name: true, source: true }, orderBy: { date: "asc" } });
	cache = { at: Date.now(), entries };
	return entries;
}

export function invalidateCalendar() {
	cache = { at: 0, entries: null };
}

/**
 * Параметры рабочего времени для правил: график фирмы из настроек + календарь. Если в настройках
 * отключено «SLA в рабочем времени» — null: правила считают календарно.
 */
export async function getWorkOptions(settings) {
	if (settings?.slaWorkingTime === false) return null;
	const entries = await loadCalendar();
	return workOptions(settings, makeDayKind(entries));
}

/** Только функция «вид дня» — для посещаемости (у неё свой график сотрудника). */
export async function getDayKind() {
	return makeDayKind(await loadCalendar());
}

export function _resetCalendarCache() {
	cache = { at: 0, entries: null };
	seededYears.clear();
}

export default { ensureCalendarYear, loadCalendar, invalidateCalendar, getWorkOptions, getDayKind };
