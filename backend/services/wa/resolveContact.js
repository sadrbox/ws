// ─────────────────────────────────────────────────────────────────────────────
// Резолвинг внешнего номера → контактное лицо / контрагент (ТЗ §5).
//
// Порядок (первое совпадение выигрывает):
//   1) Contact(whatsapp)  с этим номером → владелец
//   2) Contact(telephone) с этим номером → владелец
//   3) владелец ContactPerson → лицо + его контрагент (owner лица)
//   4) владелец Counterparty → контрагент (лицо пусто)
//   5) не найдено → { contactPersonUuid: null, counterpartyUuid: null }
//
// Сравнение номеров — по НОРМАЛИЗОВАННОМУ виду: в БД телефоны хранятся как введены
// («+7 (702) 123-45-67»), поэтому фильтровать SQL-ом нельзя — тянем контакты
// телефонных типов организации и сравниваем в памяти (объём справочника мал).
// ─────────────────────────────────────────────────────────────────────────────
import { normalizePhone } from "./phone.js";

const PHONE_TYPES = ["whatsapp", "telephone"];

/**
 * @param {object} client prisma (или мок)
 * @param {{phone: string, organizationUuid?: string|null}} p
 * @returns {Promise<{contactPersonUuid: string|null, counterpartyUuid: string|null, matchedBy: string|null}>}
 */
export async function resolveContactByPhone(client, { phone, organizationUuid = null }) {
	const target = normalizePhone(phone);
	const empty = { contactPersonUuid: null, counterpartyUuid: null, matchedBy: null };
	if (!target) return empty;

	const contacts = await client.contact.findMany({
		where: {
			deletedAt: null,
			contactType: { in: PHONE_TYPES },
			...(organizationUuid ? { organizationUuid } : {}),
		},
		select: { value: true, contactType: true, ownerType: true, ownerUuid: true },
	});

	// Сначала whatsapp, затем telephone — приоритет по типу, а не по порядку выборки.
	let hit = null;
	for (const type of PHONE_TYPES) {
		hit = contacts.find((c) => c.contactType === type && normalizePhone(c.value) === target) ?? null;
		if (hit) break;
	}
	if (!hit || !hit.ownerUuid) return empty;

	// Владелец — контактное лицо: его контрагент = owner самого лица.
	if (hit.ownerType === "ContactPerson") {
		const person = await client.contactPerson.findFirst({
			where: { uuid: hit.ownerUuid, deletedAt: null },
			select: { uuid: true, ownerType: true, ownerUuid: true },
		});
		if (!person) return empty;
		return {
			contactPersonUuid: person.uuid,
			counterpartyUuid: person.ownerType === "Counterparty" ? person.ownerUuid ?? null : null,
			matchedBy: hit.contactType,
		};
	}

	// Владелец — контрагент: диалог привязан к нему, контактное лицо неизвестно.
	if (hit.ownerType === "Counterparty") {
		return { contactPersonUuid: null, counterpartyUuid: hit.ownerUuid, matchedBy: hit.contactType };
	}

	return empty;
}

export default { resolveContactByPhone };
