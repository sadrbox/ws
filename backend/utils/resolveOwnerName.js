import { prisma } from "../prisma/prisma-client.js";

/**
 * Маппинг ownerType → { model, displayField }
 */
const OWNER_CONFIG = {
	organization: { model: "organization", field: "shortName" },
	counterparty: { model: "counterparty", field: "shortName" },
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
			select: { [config.field]: true, shortName: true },
		});
		return record?.[config.field] ?? record?.shortName ?? "";
	} catch {
		return "";
	}
}

/**
 * Обогащает массив items полем ownerName.
 * Оптимизировано: группирует по ownerType+ownerUuid, делает 1 запрос на уникальную пару.
 * @param {Array} items — массив объектов с ownerType и ownerUuid
 * @returns {Promise<Array>} — тот же массив с добавленным ownerName
 */
export async function enrichWithOwnerName(items) {
	if (!items || items.length === 0) return items;

	// Собираем уникальные пары ownerType+ownerUuid
	const uniqueOwners = new Map();
	for (const item of items) {
		if (item.ownerType && item.ownerUuid) {
			const key = `${item.ownerType}:${item.ownerUuid}`;
			if (!uniqueOwners.has(key)) {
				uniqueOwners.set(key, { ownerType: item.ownerType, ownerUuid: item.ownerUuid });
			}
		}
	}

	// Резолвим все уникальные пары параллельно
	const nameMap = new Map();
	const promises = [];
	for (const [key, { ownerType, ownerUuid }] of uniqueOwners) {
		promises.push(
			resolveOwnerName(ownerType, ownerUuid).then((name) => {
				nameMap.set(key, name);
			})
		);
	}
	await Promise.all(promises);

	// Обогащаем items
	return items.map((item) => {
		const key = `${item.ownerType}:${item.ownerUuid}`;
		return {
			...item,
			ownerName: nameMap.get(key) || "",
		};
	});
}
