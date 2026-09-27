// POST /organizations/from-onec (26.09): организация из реквизитов заявки базы 1С — на подменённой Prisma, без БД.
//
// Что проверяется: только администратор BuhProf; БИН уже есть — 409 с организацией (панель её подставит);
// вложенные записи принадлежат НОВОЙ организации, а не активной организации нажавшего; валюта — по коду.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../prisma/prisma-client.js";
import organizationsRouter from "../api/router/organizations.js";

const member = { uuid: "u1", username: "m", organizationUuid: "org-A", allowedOrgUuids: ["org-A"], adminOrgUuids: [], isOrgAdmin: false, isSuperAdmin: false, operatorDataAccess: true };
const operator = { ...member, uuid: "u0", username: "op", isSuperAdmin: true };

function mock(map) {
	const saved = [];
	for (const [path, fn] of Object.entries(map)) {
		const [model, method] = path.split(".");
		const target = method ? prisma[model] : prisma;
		const key = method ?? model;
		saved.push([target, key, target[key]]);
		target[key] = fn;
	}
	return () => { for (const [t, k, v] of saved.reverse()) t[k] = v; };
}

async function call(user, body) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.user = { ...user }; next(); });
	app.use("/api/v1", organizationsRouter);
	const server = app.listen(0);
	try {
		const r = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/organizations/from-onec`, {
			method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
		});
		return { status: r.status, body: await r.json() };
	} finally { server.close(); }
}

const body = {
	bin: "180240037695", name: "ТОО Nord Beer",
	details: {
		legalAddress: "г. Алматы", phones: ["+7 701 000 00 00"], director: { fullName: "Иванов И. И.", position: "Директор" },
		kbe: "17", bankAccounts: [{ iban: "KZ111111111111111111", currency: "KZT" }, { iban: "KZ222222222222222222", currency: "XXX" }],
	},
};

test("не администратор BuhProf — 403, в БД ничего не пишется", async () => {
	const restore = mock({ "organization.findUnique": async () => { throw new Error("не должно вызываться"); } });
	try {
		const r = await call(member, body);
		assert.equal(r.status, 403);
	} finally { restore(); }
});

test("БИН уже есть в ERP — 409 с организацией; кривой БИН — 400", async () => {
	const restore = mock({ "organization.findUnique": async () => ({ uuid: "org-N", name: "ТОО Nord Beer", deletedAt: null }) });
	try {
		const r = await call(operator, body);
		assert.equal(r.status, 409);
		assert.deepEqual(r.body.item, { uuid: "org-N", name: "ТОО Nord Beer" });
		assert.equal((await call(operator, { ...body, bin: "123" })).status, 400);
	} finally { restore(); }
});

test("создание: организация, контакты, лица и счета — одной транзакцией и на новую организацию", async () => {
	const written = {};
	const tx = {
		organization: { create: async ({ data }) => ({ id: 7, uuid: "org-NEW", inviteCode: null, ...data }) },
		contact: { createMany: async ({ data }) => { written.contacts = data; return { count: data.length }; } },
		contactPerson: { createMany: async ({ data }) => { written.persons = data; return { count: data.length }; } },
		bankAccount: { createMany: async ({ data }) => { written.accounts = data; return { count: data.length }; } },
	};
	const restore = mock({
		"organization.findUnique": async () => null,
		"currency.findMany": async ({ where }) => (where.code.in.includes("KZT") ? [{ uuid: "cur-kzt", code: "KZT" }] : []),
		"$transaction": async (fn) => fn(tx),
	});
	try {
		const r = await call(operator, body);
		assert.equal(r.status, 201);
		assert.equal(r.body.item.uuid, "org-NEW");
		assert.deepEqual(r.body.created, { contacts: 2, contactPersons: 1, bankAccounts: 2 });
		for (const rows of [written.contacts, written.persons, written.accounts]) {
			assert.ok(rows.every((x) => x.ownerType === "organization" && x.ownerUuid === "org-NEW" && x.organizationUuid === "org-NEW"),
				"не активная организация нажавшего (org-A), а новая");
		}
		assert.deepEqual(written.accounts.map((a) => [a.currencyUuid, a.kbe, a.isPrimary]), [["cur-kzt", "17", true], [null, "17", false]]);
		assert.ok(written.accounts.every((a) => !("currencyCode" in a)), "код валюты в запись не уходит");
	} finally { restore(); }
});
