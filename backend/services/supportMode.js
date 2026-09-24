// РЕЖИМ ПОДДЕРЖКИ: когда оператору установки открыты учётные данные (О5 плана
// PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. `isSuperAdmin` сегодня минует всё: права, модули и изоляцию организаций. На нашей
// единственной установке это терпимо — суперадмин и владелец системы одно лицо. На клиентской
// установке это значит, что тот, кто её обновляет, по умолчанию читает чужую выручку; а на общем
// сервере — что владелец сервера видит учёт всех арендаторов сразу.
//
// РАЗДЕЛЕНИЕ. Обслуживать установку (обновления, бэкапы, модули, агенты 1С) и читать учёт —
// разные полномочия. Второе выдаётся НА ВРЕМЯ и оставляет след: клиент должен иметь возможность
// увидеть, что в его данные заходили, когда и зачем.
//
// ОСТОРОЖНО С УМОЛЧАНИЕМ. Включить разделение разом нельзя: на работающей установке суперадмин
// пользуется сквозным доступом каждый день, и внезапная потеря видимости выглядела бы поломкой.
// Поэтому рубильник `OPERATOR_DATA_ACCESS`:
//
//   always       (по умолчанию) — как было: оператор видит все данные всегда;
//   support-mode                — только при включённом режиме поддержки, и только пока он идёт.
//
// ⚠ ПРОВЕРИТЬ ПОТОМ: перевести в `support-mode` на стенде, убедиться, что администрирование
// (агенты 1С, модули, бэкапы, журналы) работает БЕЗ включения режима, а учётные списки — нет.
import { getSetting, setSetting } from "./appSettings.js";

const KEY = "installation.supportMode";

/** Предел разумного: поддержка «навсегда» — это не поддержка, а тихо возвращённый сквозной доступ. */
export const MAX_MINUTES = 8 * 60;
export const DEFAULT_MINUTES = 60;

export function operatorAccessMode() {
	return process.env.OPERATOR_DATA_ACCESS === "support-mode" ? "support-mode" : "always";
}

/** Разбор сохранённого состояния. Возвращает null, когда режим не включён или истёк. */
export function parseSupportMode(raw, now = Date.now()) {
	if (!raw) return null;
	let v;
	try {
		v = JSON.parse(raw);
	} catch {
		return null;
	}
	const until = Date.parse(v?.until ?? "");
	if (!Number.isFinite(until) || until <= now) return null;
	return { until: new Date(until).toISOString(), by: v.by ?? null, reason: v.reason ?? null };
}

/**
 * Открыты ли оператору учётные данные ПРЯМО СЕЙЧАС.
 *
 * Чистая функция: решение зависит только от режима доступа и состояния — так его можно
 * проверить тестом и повторить в любом другом месте, не заводя второго правила.
 */
export function operatorSeesData({ mode = operatorAccessMode(), support = null } = {}) {
	if (mode === "always") return true;
	return !!support;
}

export async function getSupportMode() {
	return parseSupportMode(await getSetting(KEY));
}

/**
 * Включить режим поддержки на N минут.
 * @param {object} p
 * @param {string} p.by     — кто включил (для следа в аудите и в интерфейсе клиента)
 * @param {string} p.reason — зачем: без причины запись в журнале бесполезна
 */
export async function enableSupportMode({ by, reason, minutes = DEFAULT_MINUTES }) {
	const m = Math.min(Math.max(1, Number(minutes) || DEFAULT_MINUTES), MAX_MINUTES);
	const state = {
		until: new Date(Date.now() + m * 60_000).toISOString(),
		by: by ?? null,
		reason: (reason ?? "").trim() || null,
	};
	await setSetting(KEY, JSON.stringify(state));
	return state;
}

export async function disableSupportMode() {
	await setSetting(KEY, null);
}

export default {
	MAX_MINUTES, DEFAULT_MINUTES, operatorAccessMode, parseSupportMode,
	operatorSeesData, getSupportMode, enableSupportMode, disableSupportMode,
};
