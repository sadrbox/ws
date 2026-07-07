// Юридический адрес организации/контрагента берётся из «Контактов» — контакт
// типа legal_address (единственный, либо помеченный как основной isPrimary).
// Заменяет удалённое поле Organization.address / Counterparty.address.
import { prisma } from "../prisma/prisma-client.js";

/**
 * Возвращает юридический адрес владельца (organization|counterparty) из контактов.
 * @param {"organization"|"counterparty"} ownerType
 * @param {string} ownerUuid
 * @returns {Promise<string|null>}
 */
export async function getLegalAddress(ownerType, ownerUuid, client = prisma) {
	if (!ownerType || !ownerUuid) return null;
	const c = await client.contact.findFirst({
		where: { ownerType, ownerUuid, contactType: "legal_address", deletedAt: null },
		// основной (isPrimary) — приоритетнее; иначе самый ранний.
		orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
		select: { value: true },
	});
	return c?.value || null;
}

export default getLegalAddress;
