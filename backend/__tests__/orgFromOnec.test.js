// Организация из реквизитов базы 1С (26.09) — разбор тела POST /organizations/from-onec.
import test from "node:test";
import assert from "node:assert/strict";
import { buildOrganizationSeed, normalizeBin } from "../services/orgFromOnec.js";

test("БИН обязателен; пробелы и дефисы не мешают", () => {
	assert.ok(buildOrganizationSeed({}).error);
	assert.ok(buildOrganizationSeed({ bin: "12345" }).error);
	assert.equal(normalizeBin("180 240-037695"), "180240037695");
});

test("только БИН и название (заявка старого расширения) — организация без вложенных записей", () => {
	const s = buildOrganizationSeed({ bin: "180240037695", name: "ТОО Nord Beer" });
	assert.deepEqual(s.org, {
		bin: "180240037695", name: "ТОО Nord Beer", legalName: "ТОО Nord Beer", vatSeries: null, vatNumber: null,
		externalSource: "1C", externalId: "180240037695",
	});
	assert.deepEqual([s.contacts, s.persons, s.accounts], [[], [], []]);
	assert.equal(buildOrganizationSeed({ bin: "180240037695" }).org.name, "Организация 180240037695");
});

test("полные реквизиты раскладываются по контактам, лицам и счетам", () => {
	const s = buildOrganizationSeed({
		bin: "180240037695", name: "ТОО Nord Beer",
		details: {
			legalName: "Товарищество с ограниченной ответственностью «Nord Beer»", kbe: "17", vatSeries: "60001", vatNumber: "0012345",
			legalAddress: "г. Алматы, ул. Абая, 1", actualAddress: "г. Алматы, ул. Абая, 1",
			phones: ["+7 701 000 00 00", "+7 727 000 00 00"], emails: ["info@nordbeer.kz"], website: "nordbeer.kz",
			director: { fullName: "Иванов Иван Иванович", position: "Директор" },
			chiefAccountant: { fullName: "Петрова Анна" },
			bankAccounts: [
				{ iban: "KZ111111111111111111", bik: "HSBKKZKX", bankName: "Халык", currency: "KZT" },
				{ iban: "KZ222222222222222222", bik: "CASPKZKA", bankName: "Каспи", currency: "usd", isPrimary: true },
				{ iban: "KZ111111111111111111" },
				{ iban: "мусор" },
			],
		},
	});
	assert.equal(s.org.legalName, "Товарищество с ограниченной ответственностью «Nord Beer»");
	assert.equal(s.org.vatNumber, "0012345");
	assert.deepEqual(s.contacts.map((c) => [c.contactType, c.isPrimary]), [
		["legal_address", true], ["telephone", true], ["telephone", false], ["email", true], ["website", true],
	], "фактический адрес, равный юридическому, не дублируется");
	assert.deepEqual(s.persons, [
		{ fullName: "Иванов Иван Иванович", comment: "Директор (из 1С)" },
		{ fullName: "Петрова Анна", comment: "Главный бухгалтер (из 1С)" },
	]);
	assert.deepEqual(s.accounts.map((a) => [a.iban, a.currencyCode, a.kbe, a.isPrimary]), [
		["KZ111111111111111111", "KZT", "17", false],
		["KZ222222222222222222", "USD", "17", true],
	]);
});

test("основной счёт — первый, если 1С не отметила ни одного", () => {
	const s = buildOrganizationSeed({ bin: "180240037695", details: { bankAccounts: [{ iban: "KZ111111111111111111" }, { iban: "KZ222222222222222222" }] } });
	assert.deepEqual(s.accounts.map((a) => a.isPrimary), [true, false]);
});
