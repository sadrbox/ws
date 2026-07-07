// Системные настройки (key-value) в БД. Напр. конфиг интеграции eGov.
import { prisma } from "../prisma/prisma-client.js";

/** Значение настройки по ключу (или null). */
export async function getSetting(key) {
	const r = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
	return r?.value ?? null;
}

/** Значения по набору ключей → { key: value }. */
export async function getSettings(keys) {
	const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
	const map = {};
	for (const r of rows) map[r.key] = r.value;
	return map;
}

/** Записать настройку (upsert). value=null допустимо (сброс). */
export async function setSetting(key, value) {
	const v = value === undefined || value === null || value === "" ? null : String(value);
	await prisma.appSetting.upsert({
		where: { key }, create: { key, value: v }, update: { value: v },
	});
}

/** Массовая запись { key: value }. */
export async function setSettings(obj) {
	for (const [k, v] of Object.entries(obj || {})) await setSetting(k, v);
}

export default { getSetting, getSettings, setSetting, setSettings };
