// РЕКВИЗИТЫ ОРГАНИЗАЦИЙ В ЗАЯВКЕ НА ПОДКЛЮЧЕНИЕ БАЗЫ (26.09, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md).
//
// Что проверяется: реквизиты разбираются мягко — обрезаются, чистятся, неизвестное отбрасывается; кривые реквизиты
// не отменяют заявку; заявка старого расширения (без реквизитов) принимается как раньше.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrgDetails } from "../src/bases/orgDetails.ts";
import { registrationSchema } from "../src/http/baseRegistrationRouter.ts";

const base = { id: "ib-1", name: "nordbeer" };

test("реквизиты: полный набор разбирается и чистится", () => {
	const d = normalizeOrgDetails({
		legalName: "  ТОО   «Nord Beer» ", kind: "legal", kbe: "17",
		vatSeries: "60001", vatNumber: "0012345", vatDate: "2019-03-01",
		okedCode: "11050", okedName: "Производство пива",
		legalAddress: "г. Алматы, ул. Абая, 1", actualAddress: "г. Алматы, ул. Абая, 1",
		phones: ["+7 701 000 00 00", "+7 701 000 00 00", "", 42], emails: ["info@nordbeer.kz"], website: "nordbeer.kz",
		director: { fullName: "Иванов Иван Иванович", position: "Директор" },
		chiefAccountant: { fullName: "Петрова Анна", position: null },
		bankAccounts: [
			{ iban: "kz12 3456 7890 1234 5678", bik: "halykzka", bankName: "АО «Народный банк»", currency: "kzt", isPrimary: true },
			{ iban: "KZ123456789012345678", bik: "X" },   // дубль по IBAN
			{ iban: "не счёт" },
		],
		secret: "лишнее поле",
	});
	assert.ok(d);
	assert.equal(d.legalName, "ТОО «Nord Beer»");
	assert.equal(d.kind, "legal");
	assert.equal(d.kbe, "17");
	assert.deepEqual(d.phones, ["+7 701 000 00 00", "42"]);
	assert.deepEqual(d.director, { fullName: "Иванов Иван Иванович", position: "Директор" });
	assert.deepEqual(d.chiefAccountant, { fullName: "Петрова Анна", position: null });
	assert.deepEqual(d.bankAccounts, [{ iban: "KZ123456789012345678", bik: "HALYKZKA", bankName: "АО «Народный банк»", currency: "KZT", isPrimary: true }]);
	assert.ok(!("secret" in d), "неизвестные поля не сохраняются");
});

test("реквизиты: мусор и пустота — null, длинное — обрезается", () => {
	assert.equal(normalizeOrgDetails(undefined), null);
	assert.equal(normalizeOrgDetails("строка"), null);
	assert.equal(normalizeOrgDetails([1, 2]), null);
	assert.equal(normalizeOrgDetails({}), null);
	assert.equal(normalizeOrgDetails({ kind: "legal", phones: [], director: { position: "Директор" } }), null, "без полезного — null");
	const long = normalizeOrgDetails({ legalAddress: "а".repeat(2000), kbe: "170", phones: Array.from({ length: 30 }, (_, i) => `+7 ${i}`) });
	assert.equal(long?.legalAddress?.length, 500);
	assert.equal(long?.kbe, null, "КБе — ровно две цифры");
	assert.equal(long?.phones.length, 10);
});

test("заявка: кривые реквизиты не отменяют заявку, старое расширение без реквизитов — как раньше", () => {
	const withBad = registrationSchema.safeParse({ base, organizations: [{ name: "ТОО Nord Beer", bin: "180240037695", details: { bankAccounts: "не массив", kbe: {} } }] });
	assert.ok(withBad.success);
	assert.equal(withBad.data.organizations[0].details, null);

	const old = registrationSchema.safeParse({ base, organizations: [{ id: "o1", name: "ТОО Nord Beer", bin: "180240037695" }] });
	assert.ok(old.success);
	assert.equal(old.data.organizations[0].details, null);

	const good = registrationSchema.safeParse({ base, organizations: [{ name: "ТОО Nord Beer", bin: "180240037695", details: { legalName: "ТОО «Nord Beer»" } }] });
	assert.ok(good.success);
	assert.equal(good.data.organizations[0].details?.legalName, "ТОО «Nord Beer»");
});
