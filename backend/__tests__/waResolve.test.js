// E14/W1 — нормализация телефона и резолвинг номера → контактное лицо. HEADLESS (мок-клиент).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, phonesEqual } from "../services/wa/phone.js";
import { resolveContactByPhone } from "../services/wa/resolveContact.js";

test("normalizePhone: местная запись 8XXX → 7XXX, мусор срезается", () => {
	assert.equal(normalizePhone("+7 (702) 123-45-67"), "77021234567");
	assert.equal(normalizePhone("87021234567"), "77021234567", "8→7");
	assert.equal(normalizePhone("7021234567"), "77021234567", "10 цифр → +7");
	assert.equal(normalizePhone(""), "");
	assert.equal(normalizePhone(null), "");
});

test("phonesEqual: разные записи одного номера совпадают; пустые — нет", () => {
	assert.equal(phonesEqual("+7 702 123 45 67", "87021234567"), true);
	assert.equal(phonesEqual("77021234567", "77029999999"), false);
	assert.equal(phonesEqual("", ""), false);
});

/** Мок prisma: contact.findMany + contactPerson.findFirst. */
function makeClient({ contacts = [], persons = [] } = {}) {
	return {
		contact: { findMany: async () => contacts },
		contactPerson: {
			findFirst: async ({ where }) => persons.find((p) => p.uuid === where.uuid) ?? null,
		},
	};
}

test("резолвинг: Contact(whatsapp) → ContactPerson + его контрагент", async () => {
	const client = makeClient({
		contacts: [{ value: "+7 702 123-45-67", contactType: "whatsapp", ownerType: "ContactPerson", ownerUuid: "cp1" }],
		persons: [{ uuid: "cp1", ownerType: "Counterparty", ownerUuid: "ctr1" }],
	});
	const r = await resolveContactByPhone(client, { phone: "87021234567", organizationUuid: "org1" });
	assert.deepEqual(r, { contactPersonUuid: "cp1", counterpartyUuid: "ctr1", matchedBy: "whatsapp" });
});

test("резолвинг: приоритет whatsapp над telephone (даже если telephone найден раньше)", async () => {
	const client = makeClient({
		contacts: [
			{ value: "77021234567", contactType: "telephone", ownerType: "Counterparty", ownerUuid: "ctr-tel" },
			{ value: "77021234567", contactType: "whatsapp", ownerType: "Counterparty", ownerUuid: "ctr-wa" },
		],
	});
	const r = await resolveContactByPhone(client, { phone: "77021234567" });
	assert.equal(r.counterpartyUuid, "ctr-wa");
	assert.equal(r.matchedBy, "whatsapp");
});

test("резолвинг: владелец-контрагент → лицо пусто", async () => {
	const client = makeClient({
		contacts: [{ value: "77021234567", contactType: "telephone", ownerType: "Counterparty", ownerUuid: "ctr9" }],
	});
	const r = await resolveContactByPhone(client, { phone: "+7 702 123 45 67" });
	assert.deepEqual(r, { contactPersonUuid: null, counterpartyUuid: "ctr9", matchedBy: "telephone" });
});

test("резолвинг: номер не найден / пустой → пусто (диалог «неизвестный номер»)", async () => {
	const client = makeClient({ contacts: [{ value: "77770000000", contactType: "whatsapp", ownerType: "Counterparty", ownerUuid: "x" }] });
	assert.deepEqual(await resolveContactByPhone(client, { phone: "77021234567" }),
		{ contactPersonUuid: null, counterpartyUuid: null, matchedBy: null });
	assert.deepEqual(await resolveContactByPhone(client, { phone: "" }),
		{ contactPersonUuid: null, counterpartyUuid: null, matchedBy: null });
});

test("резолвинг: лицо-владелец не Counterparty → контрагент null, лицо есть", async () => {
	const client = makeClient({
		contacts: [{ value: "77021234567", contactType: "whatsapp", ownerType: "ContactPerson", ownerUuid: "cp2" }],
		persons: [{ uuid: "cp2", ownerType: "Organization", ownerUuid: "org5" }],
	});
	const r = await resolveContactByPhone(client, { phone: "77021234567" });
	assert.equal(r.contactPersonUuid, "cp2");
	assert.equal(r.counterpartyUuid, null);
});
