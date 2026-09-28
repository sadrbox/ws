// ДОГОВОРЫ ОРГАНИЗАЦИИ В СРЕЗЕ `IB_LIST_ORGANIZATIONS` (28.09, docs/TASK_AGENT_IB_ORG_CONTRACTS_2026-09-28.md).
//
// Что проверяется: договоры разбираются тем же мягким правилом, что остальные реквизиты (обрезка, мусор прочь,
// повторы — один раз); без договоров реквизиты остаются как были; сбой блока «договоры» не стирает прежние.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrgDetails } from "../src/bases/orgDetails.ts";
import { mergeOrgDetails, unreadDetailFields } from "../src/onec/ibOrganizations.ts";

test("договоры: разбор, чистка и повторы", () => {
	const d = normalizeOrgDetails({
		legalName: "ТОО «Альфа»",
		contracts: [
			{ id: "c-1", name: " Договор   поставки ", number: "15/24", date: "2024-01-15T00:00:00", validUntil: "2025-12-31",
				kind: "С поставщиком", currency: "kzt", counterparty: { id: "k-1", name: "ТОО Бета", bin: "9901 4000 0123" } },
			{ id: "C-1", name: "повтор по ссылке" },
			{ number: "7" },
			{ name: "" },
			"мусор",
			{ name: "Без контрагента", counterparty: { id: "k-2" } },
		],
	});
	assert.ok(d);
	assert.deepEqual(d.contracts, [
		{ id: "c-1", name: "Договор поставки", number: "15/24", date: "2024-01-15", validUntil: "2025-12-31", kind: "С поставщиком",
			currency: "KZT", counterparty: { id: "k-1", name: "ТОО Бета", bin: "990140000123" } },
		{ id: null, name: "№ 7", number: "7", date: null, validUntil: null, kind: null, currency: null, counterparty: null },
		// Контрагент без имени и БИН — не контрагент.
		{ id: null, name: "Без контрагента", number: null, date: null, validUntil: null, kind: null, currency: null, counterparty: null },
	]);
});

test("договоров нет — пустой список, а одни договоры без прочего — уже реквизиты", () => {
	assert.deepEqual(normalizeOrgDetails({ legalName: "ТОО «Альфа»" })?.contracts, []);
	assert.equal(normalizeOrgDetails({ contracts: [{ name: "Д-1" }] })?.contracts.length, 1);
	assert.equal(normalizeOrgDetails({ contracts: "не список" }), null);
});

test("сбой блока «договоры» — прежние договоры остаются, остальное — из нового среза", () => {
	const prev = normalizeOrgDetails({ legalName: "ТОО «Альфа»", contracts: [{ name: "Д-1" }] });
	const next = normalizeOrgDetails({ legalName: "ТОО «Альфа-2»" });
	const unread = unreadDetailFields({ mainSource: null, notes: [{ block: "contracts", message: "таймаут" }] });
	assert.ok(unread instanceof Set && unread.has("contracts"));
	const merged = mergeOrgDetails(prev, next, unread);
	assert.equal(merged?.legalName, "ТОО «Альфа-2»");
	assert.deepEqual(merged?.contracts.map((c) => c.name), ["Д-1"]);
	// Блок прочитан и пуст — в 1С договоров больше нет: прежние не держим.
	assert.deepEqual(mergeOrgDetails(prev, next, new Set())?.contracts, []);
});
