// КВОТЫ АРЕНДАТОРА (И3 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. На общем сервере организации делят один диск, одну базу и один процесс. Без пределов
// один арендатор — не по злому умыслу, а выгрузив архив фотографий товаров — занимает место
// всех остальных, и первым об этом узнаёт сосед, у которого перестало сохраняться.
//
// ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО: частоты запросов. Она уже ограничена на уровне приложения
// (`orgLimiter` в server.js) и решается другим механизмом — считать её ещё и здесь значило бы
// два предела на одно и то же, которые однажды разойдутся.
//
// УМОЛЧАНИЕ — БЕЗ ПРЕДЕЛОВ. Квоты включаются осознанно, установкой значений: на своей установке
// клиента ограничивать нечего и незачем, а внезапный отказ сохранить документ из-за предела,
// которого никто не назначал, — худший способ узнать о существовании квот.
import { getSettings, setSetting } from "./appSettings.js";

export const QUOTA_KEYS = {
	/** Сколько пользователей может завести организация. 0 — без предела. */
	users: "quota.users",
	/** Суммарный размер вложений организации, МБ. 0 — без предела. */
	storageMb: "quota.storageMb",
	/** Размер одного файла, МБ. 0 — общий предел приложения. */
	fileMb: "quota.fileMb",
};

/** Предел на организацию: своё значение главнее общего, 0 и пусто — «без предела». */
export function resolveLimit(perOrgRaw, commonRaw) {
	const n = (v) => {
		const x = Number(v);
		return Number.isFinite(x) && x > 0 ? x : 0;
	};
	return n(perOrgRaw) || n(commonRaw);
}

/**
 * Превышен ли предел.
 *
 * Отдельная функция ради одного правила на все квоты: «ноль значит без предела» легко потерять,
 * и тогда установка с нулём перестанет сохранять что-либо вовсе.
 */
export function exceeds(current, limit, adding = 0) {
	if (!limit) return false;
	return current + adding > limit;
}

export async function getQuotas(organizationUuid) {
	const common = await getSettings(Object.values(QUOTA_KEYS));
	const perOrg = organizationUuid
		? await getSettings(Object.values(QUOTA_KEYS).map((k) => `${k}.${organizationUuid}`))
		: {};
	const pick = (key) => resolveLimit(perOrg[`${key}.${organizationUuid}`], common[key]);
	return {
		users: pick(QUOTA_KEYS.users),
		storageMb: pick(QUOTA_KEYS.storageMb),
		fileMb: pick(QUOTA_KEYS.fileMb),
	};
}

/** Записать предел: без организации — общий для установки, с организацией — только ей. */
export async function setQuota(key, value, organizationUuid = null) {
	if (!Object.values(QUOTA_KEYS).includes(key)) throw new Error(`Неизвестная квота: ${key}`);
	const full = organizationUuid ? `${key}.${organizationUuid}` : key;
	await setSetting(full, value === null || value === "" ? null : String(Number(value) || 0));
}

export default { QUOTA_KEYS, resolveLimit, exceeds, getQuotas, setQuota };
