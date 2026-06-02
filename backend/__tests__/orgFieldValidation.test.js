import { test } from "node:test";
import assert from "node:assert/strict";
import {
	assertOrgFieldMembership,
	OrgFieldValidationError,
	respondOrgFieldError,
} from "../utils/orgFieldValidation.js";

// Мок prisma-клиента: модели возвращают запись с заданным organizationUuid.
function mockClient(records) {
	const make = (model) => ({
		findUnique: async ({ where: { uuid } }) => records[model]?.[uuid] ?? null,
	});
	return {
		warehouse: make("warehouse"),
		contract: make("contract"),
		cashbox: make("cashbox"),
		bankAccount: make("bankAccount"),
	};
}

test("проходит: поле принадлежит той же организации", async () => {
	const client = mockClient({ warehouse: { "wh-1": { organizationUuid: "org-1" } } });
	await assertOrgFieldMembership({ organizationUuid: "org-1", warehouseUuid: "wh-1" }, client);
});

test("проходит: глобальное поле (organizationUuid = null)", async () => {
	const client = mockClient({ contract: { "c-1": { organizationUuid: null } } });
	await assertOrgFieldMembership({ organizationUuid: "org-1", contractUuid: "c-1" }, client);
});

test("бросает: поле принадлежит другой организации", async () => {
	const client = mockClient({ warehouse: { "wh-2": { organizationUuid: "org-2" } } });
	await assert.rejects(
		() => assertOrgFieldMembership({ organizationUuid: "org-1", warehouseUuid: "wh-2" }, client),
		(e) => e instanceof OrgFieldValidationError && /Склад/.test(e.message),
	);
});

test("пропускает проверку, если у документа нет организации", async () => {
	const client = mockClient({ warehouse: { "wh-2": { organizationUuid: "org-2" } } });
	await assertOrgFieldMembership({ organizationUuid: null, warehouseUuid: "wh-2" }, client);
});

test("пропускает несуществующую ссылку (забота FK-валидации)", async () => {
	const client = mockClient({});
	await assertOrgFieldMembership({ organizationUuid: "org-1", warehouseUuid: "ghost" }, client);
});

test("несколько расхождений — собираются в одно сообщение", async () => {
	const client = mockClient({
		warehouse: { "wh-2": { organizationUuid: "org-2" } },
		cashbox: { "cb-2": { organizationUuid: "org-3" } },
	});
	await assert.rejects(
		() => assertOrgFieldMembership(
			{ organizationUuid: "org-1", warehouseUuid: "wh-2", cashboxUuid: "cb-2" },
			client,
		),
		(e) => e.messages.length === 2,
	);
});

test("respondOrgFieldError: 409 для OrgFieldValidationError, иначе false", () => {
	let status, body;
	const res = { status(s) { status = s; return this; }, json(b) { body = b; } };
	const handled = respondOrgFieldError(new OrgFieldValidationError(["«Склад» принадлежит другой организации"]), res);
	assert.equal(handled, true);
	assert.equal(status, 409);
	assert.equal(body.success, false);

	assert.equal(respondOrgFieldError(new Error("прочее"), { status() { return this; }, json() {} }), false);
});
