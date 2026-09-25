// Хранилище настроек E17 — AppSetting, без миграции (как modules.disabled.<org>).
//   quality.settings.<фирма>          — JSON настроек (сливается с умолчаниями settingsRules.js);
//   quality.firmOrganizationUuid      — какая организация установки — фирма, ведущая учёт качества.
import { prisma } from "../../prisma/prisma-client.js";
import { mergeSettings } from "./settingsRules.js";

export const FIRM_KEY = "quality.firmOrganizationUuid";
const keyOf = (org) => `quality.settings.${org || "global"}`;

const TTL_MS = 30_000;
const cache = new Map();

/** Настройки фирмы, слитые с умолчаниями. Кэш 30 с: правила зовут их на каждой задаче. */
export async function getQualitySettings(firmOrgUuid) {
	const key = keyOf(firmOrgUuid);
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
	let stored = null;
	try {
		const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
		stored = row?.value ? JSON.parse(row.value) : null;
	} catch {
		stored = null; // битый JSON — работаем на умолчаниях, а не падаем
	}
	const value = mergeSettings(stored);
	cache.set(key, { at: Date.now(), value });
	return value;
}

/** Сохранить настройки (частичные — сливаются с текущими). Возвращает итоговые. */
export async function saveQualitySettings(firmOrgUuid, patch) {
	const current = await getQualitySettings(firmOrgUuid);
	const next = mergeSettings(deepMerge(current, patch || {}));
	const key = keyOf(firmOrgUuid);
	await prisma.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
	cache.delete(key);
	return next;
}

function deepMerge(a, b) {
	if (!b || typeof b !== "object" || Array.isArray(b)) return b === undefined ? a : b;
	const out = { ...(a || {}) };
	for (const [k, v] of Object.entries(b)) {
		out[k] = v && typeof v === "object" && !Array.isArray(v) && a?.[k] && typeof a[k] === "object" ? deepMerge(a[k], v) : v;
	}
	return out;
}

/** Явно назначенная организация-фирма установки (или null). */
export async function getFirmOrgSetting() {
	const row = await prisma.appSetting.findUnique({ where: { key: FIRM_KEY }, select: { value: true } });
	return row?.value || null;
}

export async function setFirmOrgSetting(orgUuid) {
	await prisma.appSetting.upsert({ where: { key: FIRM_KEY }, create: { key: FIRM_KEY, value: orgUuid || null }, update: { value: orgUuid || null } });
}

export function _resetSettingsCache() {
	cache.clear();
}

export default { getQualitySettings, saveQualitySettings, getFirmOrgSetting, setFirmOrgSetting, FIRM_KEY };
