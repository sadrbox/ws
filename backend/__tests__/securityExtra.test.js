// Остатки аудита 26.09 без владельца (исполнитель «backend-безопасность», доп. задание) — без БД.
//
//   - журнал действий и приём событий 1С: кто может прислать событие, что можно ключом интеграции;
//   - сопоставление справочников 1С не выходит за организацию-отправителя;
//   - заметки и метки получают организацию записи, чужое не видно;
//   - публичные входы лицензий ЭСФ не заводят мусор и не накручивают установки;
//   - общий обработчик удаления: документ без организации — не «общий».
// Обращения к базе подменяются на уровне делегатов Prisma — соединения с базой нет.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../prisma/prisma-client.js";

const member = { uuid: "u1", username: "m", organizationUuid: "org-A", allowedOrgUuids: ["org-A"], adminOrgUuids: [], isOrgAdmin: false, isSuperAdmin: false, operatorDataAccess: true };
const superUser = { ...member, uuid: "s1", isSuperAdmin: true };

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

async function withApp(router, user, fn, { mount = "/api/v1", extra = {} } = {}) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.user = user ? { ...user } : undefined; Object.assign(req, extra); next(); });
	app.use(mount, router);
	const server = app.listen(0);
	try {
		const base = `http://127.0.0.1:${server.address().port}${mount}`;
		const call = async (method, path, body) => {
			const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
			return { status: r.status, body: await r.json().catch(() => ({})) };
		};
		return await fn(call);
	} finally {
		server.close();
	}
}

// ── Журнал действий и приём событий 1С ───────────────────────────────────
import activityRouter, { mayIngestPipeEvent } from "../api/router/activityhistories.js";

const UUID = "11111111-2222-3333-4444-555555555555";

test("п.10: событие 1С присылает только интеграция (ключ) или суперадмин", async () => {
	assert.equal(mayIngestPipeEvent({ user: member }), false, "раньше хватало права ActivityHistory:full");
	assert.equal(mayIngestPipeEvent({ user: member, pipeKeyAuth: true }), true);
	assert.equal(mayIngestPipeEvent({ user: superUser }), true);
	const restore = mock({ "pipeActivity.create": async () => { throw new Error("не должно вызываться"); } });
	try {
		await withApp(activityRouter, member, async (call) => {
			const r = await call("POST", "/", { object: { id: "1", type: "Справочник", name: "Контрагенты" } });
			assert.equal(r.status, 403);
		}, { mount: "/pipe" });
	} finally { restore(); }
});

test("п.12: ключом интеграции журнал не читается и не чистится", async () => {
	const restore = mock({
		"activityHistory.findMany": async () => { throw new Error("не должно вызываться"); },
		"activityHistory.delete": async () => { throw new Error("не должно вызываться"); },
	});
	try {
		await withApp(activityRouter, superUser, async (call) => {
			assert.equal((await call("GET", "/")).status, 403);
			assert.equal((await call("DELETE", "/5")).status, 403);
			assert.equal((await call("POST", "/prune", { days: 1 })).status, 403);
		}, { mount: "/pipe", extra: { pipeKeyAuth: true } });
	} finally { restore(); }
});

test("п.12: запись журнала чужой организации не читается; удаляет только суперадмин", async () => {
	let row = { uuid: UUID, organizationUuid: "org-B" };
	let deleted = 0;
	const restore = mock({
		"activityHistory.findUnique": async () => row,
		"activityHistory.delete": async () => { deleted++; return {}; },
	});
	try {
		await withApp(activityRouter, member, async (call) => {
			assert.equal((await call("GET", `/${UUID}`)).status, 404);
			row = { uuid: UUID, organizationUuid: null };
			assert.equal((await call("GET", `/${UUID}`)).status, 404, "запись без организации — суперадмину");
			row = { uuid: UUID, organizationUuid: "org-A" };
			assert.equal((await call("GET", `/${UUID}`)).status, 200);
			assert.equal((await call("DELETE", "/5")).status, 403);
			assert.equal(deleted, 0);
		}, { mount: "/api/v1/activityhistories" });
		await withApp(activityRouter, superUser, async (call) => {
			assert.equal((await call("DELETE", "/5")).status, 200);
			assert.equal(deleted, 1);
		}, { mount: "/api/v1/activityhistories" });
	} finally { restore(); }
});

// ── Сопоставление справочников 1С ────────────────────────────────────────
import { applyPipeReference, senderMayTouch } from "../services/pipeReference.js";

const ev = (book, props, bin = "111111111111") => ({
	organization: { bin }, object: { id: `ext-${book}`, type: "Справочник", name: book }, props,
});

function pipeMocks({ senderOrg = "org-A", linked = null, natural = null, capture = {} }) {
	const model = (name) => ({
		[`${name}.findFirst`]: async (a) => { if (a.where.externalSource) return linked; capture.naturalWhere = a.where; return natural; },
		[`${name}.findMany`]: async (a) => { capture.naturalWhere = a.where; return natural ? [natural] : []; },
		[`${name}.update`]: async (a) => { capture.update = a; return { uuid: a.where.uuid }; },
		[`${name}.create`]: async (a) => { capture.create = a; return { uuid: "new" }; },
	});
	return mock({
		"organization.findUnique": async (a) => (a.select ? (senderOrg ? { uuid: senderOrg } : null) : natural),
		"counterparty.findUnique": async () => natural,
		...model("counterparty"), ...model("product"), ...model("warehouse"),
		"organization.findFirst": async () => linked,
		"organization.update": async (a) => { capture.update = a; return { uuid: a.where.uuid }; },
		"organization.create": async (a) => { capture.create = a; return { uuid: "new" }; },
	});
}

test("п.10: контрагент с БИН чужой организации не переносится к отправителю", async () => {
	const cap = {};
	const restore = pipeMocks({ natural: { uuid: "cp-B", organizationUuid: "org-B" }, capture: cap });
	try {
		const r = await applyPipeReference(ev("Контрагенты", { БИН: "222222222222", Наименование: "ТОО Чужое" }), { mode: "isolated" });
		assert.equal(r.status, "error");
		assert.match(r.message, /другой организации/);
		assert.equal(cap.update, undefined, "раньше organizationUuid чужого контрагента переписывался на отправителя");
	} finally { restore(); }
});

test("п.10: общий контрагент (режим group) привязывается, но остаётся общим", async () => {
	const cap = {};
	const restore = pipeMocks({ natural: { uuid: "cp-S", organizationUuid: null }, capture: cap });
	try {
		const r = await applyPipeReference(ev("Контрагенты", { БИН: "222222222222", Наименование: "ТОО Общее" }), { mode: "group" });
		assert.equal(r.status, "linked");
		assert.equal("organizationUuid" in cap.update.data, false, "организацию найденной записи событие не меняет");
	} finally { restore(); }
});

test("п.10: элемент, сопоставленный с записью чужой организации, не обновляется", async () => {
	const cap = {};
	const restore = pipeMocks({ linked: { uuid: "p-B", organizationUuid: "org-B" }, capture: cap });
	try {
		const r = await applyPipeReference(ev("Номенклатура", { Наименование: "Гвоздь" }), { mode: "isolated" });
		assert.equal(r.status, "error");
		assert.equal(cap.update, undefined);
	} finally { restore(); }
});

test("п.10: поиск по штрихкоду/имени — только в организации отправителя", async () => {
	const cap = {};
	const restore = pipeMocks({ capture: cap });
	try {
		const r = await applyPipeReference(ev("Номенклатура", { Наименование: "Гвоздь", Штрихкод: "4600000000000" }), { mode: "isolated" });
		assert.equal(r.status, "created");
		assert.deepEqual(cap.naturalWhere.OR, [{ organizationUuid: "org-A" }], "без общих записей в изолированном режиме");
		assert.equal(cap.create.data.organizationUuid, "org-A");
	} finally { restore(); }
});

test("п.10: без организации-отправителя склад не создаётся, общий контрагент — только где общие допустимы", async () => {
	const restore = pipeMocks({ senderOrg: null });
	try {
		assert.equal((await applyPipeReference(ev("Склады", { Наименование: "Основной" }, null), { mode: null })).status, "error");
		assert.equal((await applyPipeReference(ev("Контрагенты", { Наименование: "Физлицо" }, null), { mode: "isolated" })).status, "error");
		assert.equal((await applyPipeReference(ev("Контрагенты", { Наименование: "Физлицо" }, null), { mode: null })).status, "created", "как раньше — режим не выбран");
	} finally { restore(); }
});

test("п.10: карточку другой организации событие правит только в режиме group", async () => {
	assert.equal(senderMayTouch("self", { uuid: "org-B" }, { orgUuid: "org-A", sharedAllowed: false }), false);
	assert.equal(senderMayTouch("self", { uuid: "org-A" }, { orgUuid: "org-A", sharedAllowed: false }), true);
	assert.equal(senderMayTouch("self", { uuid: "org-B" }, { orgUuid: "org-A", sharedAllowed: true }), true);
	assert.equal(senderMayTouch("orgStrict", { organizationUuid: null }, { orgUuid: "org-A", sharedAllowed: true }), false, "склад общим не бывает");
});

// ── Заметки и метки ──────────────────────────────────────────────────────
import notesRouter from "../api/router/notes.js";
import marksRouter from "../api/router/objectMarks.js";

test("п.15: заметка получает организацию записи; к чужой записи — 404", async () => {
	let created = null;
	let saleOrg = "org-B";
	const restore = mock({
		"sale.findUnique": async () => ({ organizationUuid: saleOrg }),
		"counterparty.findUnique": async () => ({ organizationUuid: null }),
		"note.create": async (a) => { created = a.data; return a.data; },
	});
	try {
		await withApp(notesRouter, member, async (call) => {
			assert.equal((await call("POST", "/notes", { entityType: "sales", entityUuid: "s1", body: "x" })).status, 404);
			assert.equal(created, null);
			saleOrg = "org-A";
			assert.equal((await call("POST", "/notes", { entityType: "sales", entityUuid: "s1", body: "x" })).status, 201);
			assert.equal(created.organizationUuid, "org-A", "раньше кнопка в форме давала null — заметку видели все");
			await call("POST", "/notes", { entityType: "counterparties", entityUuid: "c1", body: "x" });
			assert.equal(created.organizationUuid, "org-A", "общая запись — организация автора");
			assert.equal((await call("POST", "/notes", { entityType: "sales", entityUuid: "s1", body: "x", organizationUuid: "org-VICTIM" })).status, 403);
		});
	} finally { restore(); }
});

test("п.15: журнал заметок — без чужих заметок без организации; чужая запись — пусто", async () => {
	let where = null;
	const restore = mock({
		"note.findMany": async (a) => { where = a.where; return []; },
		"sale.findUnique": async () => ({ organizationUuid: "org-B" }),
	});
	try {
		await withApp(notesRouter, member, async (call) => {
			await call("GET", "/notes");
			assert.deepEqual(where.OR, [{ organizationUuid: { in: ["org-A"] } }, { organizationUuid: null, authorUuid: "u1" }]);
			where = null;
			const r = await call("GET", "/notes?entityType=sales&entityUuid=s9");
			assert.deepEqual(r.body.items, []);
			assert.equal(where, null, "заметки чужой записи не запрашиваются вовсе");
		});
	} finally { restore(); }
});

test("п.29: повтор метки не оживляет и не переименовывает чужую", async () => {
	let updated = null;
	let existing = { id: 1, organizationUuid: "org-B", authorUuid: "u9", deletedAt: null, targetLabel: "Их" };
	const restore = mock({
		"sale.findUnique": async () => ({ organizationUuid: "org-A" }),
		"objectMark.findFirst": async () => existing,
		"objectMark.update": async (a) => { updated = a.data; return { ...existing, ...a.data }; },
	});
	try {
		await withApp(marksRouter, member, async (call) => {
			const body = { ownerType: "sales", ownerUuid: "s1", targetType: "products", targetUuid: "p1", targetLabel: "Моё" };
			assert.equal((await call("POST", "/object-marks", body)).status, 409);
			assert.equal(updated, null);
			// Снятая чужая метка в своей организации — ставится заново уже от своего имени.
			existing = { id: 1, organizationUuid: "org-A", authorUuid: "u9", deletedAt: new Date(), targetLabel: "Их" };
			assert.equal((await call("POST", "/object-marks", body)).status, 200);
			assert.equal(updated.authorUuid, "u1");
			assert.equal(updated.organizationUuid, "org-A");
		});
	} finally { restore(); }
});

// ── Лицензии ЭСФ ─────────────────────────────────────────────────────────
import { publicRouter as esfPublic, binAcceptableForNewLicense, registerInstallGuarded, newInstallsPerDay } from "../api/router/esfLicense.js";
import { binChecksum } from "../utils/bin.js";

const validBin = (() => {
	for (let n = 10000000000; ; n++) {
		const d = String(n).padStart(11, "0");
		const c = binChecksum([...d]);
		if (c !== null) return d + c;
	}
})();

test("п.25: новую лицензию заводит только настоящий БИН", () => {
	assert.equal(binAcceptableForNewLicense(validBin), true);
	assert.equal(binAcceptableForNewLicense("123456789012"), false, "контрольный разряд не сходится");
	assert.equal(binAcceptableForNewLicense("abc"), false);
});

test("п.25: heartbeat на выдуманный неизвестный БИН отклоняется, записи не создаются", async () => {
	const restore = mock({
		"esfLicense.findUnique": async () => null,
		"esfLicense.upsert": async () => { throw new Error("не должно вызываться"); },
		"esfLicenseLog.create": async () => ({}),
	});
	try {
		await withApp(esfPublic, null, async (call) => {
			const r = await call("POST", "/heartbeat", { bin: "123456789012", installId: "x" });
			assert.equal(r.status, 400);
		}, { mount: "/api1/esf-license" });
	} finally { restore(); }
});

test("п.25: новые установки — не больше предела в сутки; у неактивной лицензии не заводятся", async () => {
	const calls = { upsert: 0 };
	const client = (known, fresh) => ({
		esfLicenseInstall: {
			findUnique: async () => (known ? { id: 1 } : null),
			count: async () => fresh,
			upsert: async () => { calls.upsert++; return {}; },
		},
	});
	assert.equal(await registerInstallGuarded(client(true, 99), { bin: validBin, installId: "a" }), "known");
	assert.equal(await registerInstallGuarded(client(false, 0), { bin: validBin, installId: "b" }), "registered");
	assert.equal(await registerInstallGuarded(client(false, newInstallsPerDay()), { bin: validBin, installId: "c" }), "flood");
	assert.equal(await registerInstallGuarded(client(false, 0), { bin: validBin, installId: "d", allowNew: false }), "skipped");
	assert.equal(calls.upsert, 2);
});

// ── Общий обработчик удаления ────────────────────────────────────────────
import { handleDelete, handleBatchDelete, isStrictOwnershipModel } from "../utils/checkReferences.js";

function fakeRes() {
	return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test("п.14: документы — строгая принадлежность, справочники — как раньше", () => {
	for (const m of ["sale", "purchase", "saleReturn", "writeOff", "monthClose", "outgoingInvoice", "purchaseRequisition", "fixedAssetAcceptance"]) {
		assert.equal(isStrictOwnershipModel(m), true, m);
	}
	for (const m of ["saleItem", "counterparty", "product", "warehouse", "tax"]) assert.equal(isStrictOwnershipModel(m), false, m);
});

test("п.14: документ без организации удаляет только суперадмин — остальным «не найдено»", async () => {
	let deleted = false;
	const fake = { writeOff: {
		findUnique: async () => ({ id: 1, uuid: "w1", organizationUuid: null, date: new Date() }),
		delete: async () => { deleted = true; },
		update: async () => { deleted = true; },
	} };
	const res = fakeRes();
	await handleDelete({ req: { params: { id: "1" }, user: member }, res, prisma: fake, modelName: "writeOff" });
	assert.equal(res.statusCode, 404);
	const res2 = fakeRes();
	await handleBatchDelete({ req: { body: { uuids: ["w1"] }, user: member }, res: res2, prisma: fake, modelName: "writeOff" });
	assert.equal(res2.body.deleted, 0);
	assert.equal(res2.body.failed[0].message, "Не найдено");
	assert.equal(deleted, false);
	// Чужой документ — как и раньше «не найден».
	fake.writeOff.findUnique = async () => ({ id: 1, uuid: "w1", organizationUuid: "org-B", date: new Date() });
	const res3 = fakeRes();
	await handleDelete({ req: { params: { id: "1" }, user: member }, res: res3, prisma: fake, modelName: "writeOff" });
	assert.equal(res3.statusCode, 404);
});
