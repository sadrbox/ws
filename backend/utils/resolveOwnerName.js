import { prisma } from "../prisma/prisma-client.js";

/**
 * Маппинг ownerType → { model, displayField }
 */
const OWNER_CONFIG = {
	organization: { model: "organization", field: "name" },
	counterparty: { model: "counterparty", field: "name" },
	contactperson: { model: "contactPerson", field: "fullName" },
	employee: { model: "employee", field: "fullName" },
};

/**
 * Загружает ownerName по ownerType + ownerUuid.
 * @param {string|null} ownerType
 * @param {string|null} ownerUuid
 * @returns {Promise<string>}
 */
export async function resolveOwnerName(ownerType, ownerUuid) {
	if (!ownerType || !ownerUuid) return "";

	const config = OWNER_CONFIG[ownerType];
	if (!config) return "";

	try {
		const record = await prisma[config.model].findUnique({
			where: { uuid: ownerUuid },
			select: { [config.field]: true },
		});
		return record?.[config.field] ?? "";
	} catch {
		return "";
	}
}

/**
 * Имена владельцев пачкой: один findMany({ uuid: { in } }) на тип владельца.
 *
 * Раньше — отдельный findUnique на каждую уникальную пару, все разом через Promise.all: список
 * контактов на 500 строк давал до 500 параллельных запросов, пул воркера (17 соединений) уходил
 * целиком, и остальные запросы вставали в очередь (раздел 5 аудита 26.09). Теперь запросов — не
 * больше числа типов владельцев (четыре).
 *
 * @param {Array<{ownerType?: string|null, ownerUuid?: string|null}>} items
 * @param {object} [db] — клиент Prisma (для тестов)
 * @returns {Promise<Map<string, string>>} ключ `${ownerType}:${ownerUuid}` → имя
 */
export async function loadOwnerNames(items, db = prisma) {
	const byType = new Map(); // ownerType → Set<uuid>
	for (const item of items || []) {
		if (!item?.ownerType || !item?.ownerUuid || !OWNER_CONFIG[item.ownerType]) continue;
		if (!byType.has(item.ownerType)) byType.set(item.ownerType, new Set());
		byType.get(item.ownerType).add(item.ownerUuid);
	}
	const names = new Map();
	await Promise.all([...byType].map(async ([ownerType, uuids]) => {
		const { model, field } = OWNER_CONFIG[ownerType];
		try {
			const rows = await db[model].findMany({ where: { uuid: { in: [...uuids] } }, select: { uuid: true, [field]: true } });
			for (const r of rows) names.set(`${ownerType}:${r.uuid}`, r[field] ?? "");
		} catch {
			// имени нет — строка покажется без него, как и раньше при ошибке
		}
	}));
	return names;
}

/**
 * Обогащает массив items полем ownerName.
 * @param {Array} items — массив объектов с ownerType и ownerUuid
 * @returns {Promise<Array>} — тот же массив с добавленным ownerName
 */
export async function enrichWithOwnerName(items, db = prisma) {
	if (!items || items.length === 0) return items;
	const nameMap = await loadOwnerNames(items, db);
	return items.map((item) => ({
		...item,
		ownerName: nameMap.get(`${item.ownerType}:${item.ownerUuid}`) || "",
	}));
}
