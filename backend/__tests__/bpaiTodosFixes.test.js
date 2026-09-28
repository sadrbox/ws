// КР-22 аудита 27.09 (платформенная часть) — HEADLESS, без БД:
//   • срок задачи из 1С «ГГГГ-ММ-ДДT00:00:00» без пояса — дата без времени («весь день»), а не местная
//     полночь-момент (просрочка и кандидат по п. 20 на сутки раньше);
//   • PUT /todos/:id — «Не выбрана организация задачи» только при фактической смене организации:
//     старая задача без организации сохраняется куратором, когда форма шлёт organizationUuid: null.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../prisma/prisma-client.js";
import { deadlineOf } from "../api/router/bpai.js";
import todosRouter from "../api/router/todos.js";
import { deadlineDueAt } from "../services/quality/taskRules.js";
import { _resetStatusCache } from "../services/quality/todos.js";

process.env.ACCOUNTING_TIME_ZONE = "Asia/Almaty";
const TZ = "Asia/Almaty";

test("КР-22: срок «2026-09-30T00:00:00» без пояса — весь день 30.09, как «2026-09-30»", () => {
	const bare = deadlineOf("2026-09-30T00:00:00");
	assert.equal(bare.toISOString(), "2026-09-30T00:00:00.000Z", "дата без времени — полночь UTC");
	assert.equal(deadlineOf("2026-09-30T00:00:00.000").getTime(), bare.getTime());
	assert.equal(deadlineOf("2026-09-30").getTime(), bare.getTime(), "формат инструмента ai — как прежде");
	// Истекает в конце местного дня 30.09, а не в его начале.
	assert.equal(deadlineDueAt(bare, TZ).toISOString(), "2026-09-30T18:59:59.999Z");
	assert.equal(deadlineDueAt(bare, TZ) < new Date("2026-09-30T10:00:00+05:00"), false, "днём 30.09 задача ещё не просрочена");
});

test("КР-22: срок с поясом или со временем — точный момент; пустая дата 1С — без срока; мусор — 400", () => {
	const withTz = deadlineOf("2026-09-30T00:00:00+05:00");
	assert.equal(withTz.toISOString(), "2026-09-29T19:00:00.000Z", "пояс указан — момент как есть");
	assert.equal(deadlineDueAt(withTz, TZ).getTime(), withTz.getTime());
	assert.equal(deadlineOf("2026-09-30T13:00:00.000Z").toISOString(), "2026-09-30T13:00:00.000Z");
	assert.equal(deadlineOf("2026-09-30T18:00:00").toISOString(), "2026-09-30T13:00:00.000Z", "время без пояса — местное время организации");
	assert.equal(deadlineOf("0001-01-01T00:00:00"), null, "пустая дата 1С");
	assert.equal(deadlineOf(""), null);
	assert.equal(deadlineOf(null), null);
	for (const bad of ["2026-02-30T00:00:00", "2026-09-30T25:00:00", "вчера"]) {
		assert.throws(() => deadlineOf(bad), (e) => e.status === 400, bad);
	}
});

/** Подменить методы делегатов Prisma на время теста. */
function mock(map) {
	const saved = [];
	for (const [path, fn] of Object.entries(map)) {
		const [model, method] = path.split(".");
		saved.push([prisma[model], method, prisma[model][method]]);
		prisma[model][method] = fn;
	}
	return () => { for (const [t, k, v] of saved.reverse()) t[k] = v; };
}

async function put(user, id, body) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.user = { ...user }; next(); });
	app.use("/api/v1", todosRouter);
	const srv = app.listen(0);
	try {
		await new Promise((r) => srv.once("listening", r));
		const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/todos/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		return { status: r.status, body: await r.json() };
	} finally {
		srv.close();
	}
}

const curator = { uuid: "u-cur", username: "cur", organizationUuid: "org-A", allowedOrgUuids: ["org-A"], adminOrgUuids: [], isOrgAdmin: false, isSuperAdmin: false, operatorDataAccess: true };
const legacy = { id: 7, uuid: "t-7", name: "старая", status: "new", organizationUuid: null, curatorUuid: "u-cur", executorUuid: null, deletedAt: null, result: null, startedAt: null, acceptedAt: null, nextControlAt: null, kind: "task" };

test("КР-22: PUT задачи без организации с organizationUuid: null — сохраняется (организация не меняется)", async () => {
	_resetStatusCache();
	let updated = null;
	const restore = mock({
		"todoStatus.findMany": async () => [{ code: "new", name: "Новая", isFinal: false, isWaiting: false, isCancel: false, sortOrder: 1 }],
		"todo.findUnique": async () => ({ ...legacy }),
		"todo.update": async ({ data }) => { updated = data; return { ...legacy, ...data }; },
	});
	try {
		const r = await put(curator, 7, { name: "поправил", organizationUuid: null });
		assert.equal(r.status, 200, r.body?.message);
		assert.equal(updated.name, "поправил");
		assert.equal(updated.organizationUuid, null);
		// Смена на пустую у задачи С организацией — по-прежнему отказ не-суперадмину.
		const own = { ...legacy, organizationUuid: "org-A" };
		prisma.todo.findUnique = async () => ({ ...own });
		const bad = await put(curator, 7, { organizationUuid: null });
		assert.equal(bad.status, 400);
		// Перенос в недоступную — 403.
		const foreign = await put(curator, 7, { organizationUuid: "org-X" });
		assert.equal(foreign.status, 403);
	} finally {
		restore();
		_resetStatusCache();
	}
});
