// Идемпотентность служебных каналов (services/idempotency.js) — добор аудита 26.09, п. 4. HEADLESS:
// подставная таблица ключей в Map (уникальность key — как в Postgres), express на свободном порту.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createIdempotency, idempotencyKeyOf, STALE_MS } from "../services/idempotency.js";

/** Подставная idempotency_keys: create падает P2002 на дубле, delete — P2025 на пустом. */
function fakeDb() {
	const rows = new Map();
	return {
		rows,
		idempotencyKey: {
			create: async ({ data }) => {
				if (rows.has(data.key)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
				const row = { ...data, status: null, response: null, createdAt: new Date(), completedAt: null };
				rows.set(data.key, row);
				return row;
			},
			findUnique: async ({ where }) => rows.get(where.key) ?? null,
			update: async ({ where, data }) => {
				const row = rows.get(where.key);
				if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
				Object.assign(row, data);
				return row;
			},
			delete: async ({ where }) => {
				if (!rows.delete(where.key)) throw Object.assign(new Error("not found"), { code: "P2025" });
			},
			deleteMany: async ({ where }) => {
				let count = 0;
				for (const [k, r] of rows) {
					const hit = where.OR.some((c) => (c.status === undefined || r.status === c.status) && r.createdAt < c.createdAt.lt);
					if (hit) { rows.delete(k); count++; }
				}
				return { count };
			},
		},
	};
}

const quiet = { warn: () => {} };

/** Приложение с двумя маршрутами; обработчик считает вызовы и отвечает тем, что просят. */
async function app(db, deps = {}) {
	const idem = createIdempotency({ db, log: quiet, ...deps });
	const a = express();
	a.use(express.json());
	const calls = { tasks: 0, checks: 0 };
	let gate = null;
	a.post("/tasks", idem.idempotent("POST /tasks"), async (req, res) => {
		calls.tasks++;
		if (gate) await gate;
		const status = Number(req.body?.status) || 201;
		return res.status(status).json({ success: status < 400, item: { n: calls.tasks, name: req.body?.name } });
	});
	a.post("/checks", idem.idempotent("POST /checks"), (req, res) => {
		calls.checks++;
		return res.status(200).json({ success: true, data: { runs: calls.checks } });
	});
	const srv = a.listen(0);
	await new Promise((r) => srv.once("listening", r));
	const base = `http://127.0.0.1:${srv.address().port}`;
	const post = async (path, body, key) => {
		const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
		return { status: r.status, replayed: r.headers.get("idempotent-replayed"), body: await r.json() };
	};
	return { post, calls, close: () => srv.close(), hold: () => { let open; gate = new Promise((r) => { open = r; }); return () => { open(); gate = null; }; }, idem };
}

test("без ключа — каждый запрос выполняется; с ключом — один раз, повтор получает прежний ответ", async () => {
	const db = fakeDb();
	const t = await app(db);
	try {
		await t.post("/tasks", { name: "a" });
		await t.post("/tasks", { name: "a" });
		assert.equal(t.calls.tasks, 2);
		const first = await t.post("/tasks", { name: "b" }, "1c:dev01:k1");
		const again = await t.post("/tasks", { name: "b (изменённое тело — не важно)" }, "1c:dev01:k1");
		assert.equal(t.calls.tasks, 3, "обработчик не вызван повторно");
		assert.equal(first.status, 201);
		assert.equal(again.status, 201, "статус — как у первого ответа");
		assert.deepEqual(again.body, first.body);
		assert.equal(first.replayed, null);
		assert.equal(again.replayed, "true");
		// Ключ полем тела (сервис ИИ кладёт idempotencyKey в посылку итогов проверок) — то же самое.
		const c1 = await t.post("/checks", { idempotencyKey: "checks:abc" });
		const c2 = await t.post("/checks", { idempotencyKey: "checks:abc" });
		assert.equal(t.calls.checks, 1);
		assert.deepEqual(c2.body, c1.body);
	} finally {
		t.close();
	}
});

test("повтор во время обработки — 409; после завершения — прежний ответ", async () => {
	const db = fakeDb();
	const t = await app(db);
	try {
		const open = t.hold();
		const running = t.post("/tasks", { name: "долгая" }, "k-busy");
		await new Promise((r) => setTimeout(r, 50));
		const busy = await t.post("/tasks", { name: "долгая" }, "k-busy");
		assert.equal(busy.status, 409);
		assert.equal(t.calls.tasks, 1);
		open();
		const first = await running;
		assert.equal(first.status, 201);
		const replay = await t.post("/tasks", { name: "долгая" }, "k-busy");
		assert.equal(replay.replayed, "true");
		assert.deepEqual(replay.body, first.body);
		assert.equal(t.calls.tasks, 1);
	} finally {
		t.close();
	}
});

test("5xx не запоминается — повтор выполняется заново; 4xx — итог, он и повторяется", async () => {
	const db = fakeDb();
	const t = await app(db);
	try {
		const err = await t.post("/tasks", { status: 500 }, "k-500");
		assert.equal(err.status, 500);
		assert.equal(db.rows.has("k-500"), false, "ключ освобождён");
		const ok = await t.post("/tasks", { status: 201 }, "k-500");
		assert.equal(ok.status, 201);
		assert.equal(t.calls.tasks, 2);
		const bad = await t.post("/tasks", { status: 400 }, "k-400");
		const badAgain = await t.post("/tasks", { status: 201 }, "k-400");
		assert.equal(badAgain.status, 400, "отказ по существу запроса повторяется, обработчик не зовётся");
		assert.deepEqual(badAgain.body, bad.body);
		assert.equal(t.calls.tasks, 3);
	} finally {
		t.close();
	}
});

test("один ключ — один маршрут (422); брошенный захват перезахватывается; чистка по сроку", async () => {
	const db = fakeDb();
	let clock = new Date("2026-09-26T10:00:00Z");
	const t = await app(db, { now: () => clock });
	try {
		await t.post("/tasks", { name: "x" }, "k-route");
		const other = await t.post("/checks", { name: "x" }, "k-route");
		assert.equal(other.status, 422);
		assert.equal(t.calls.checks, 0);

		// Воркер упал посреди обработки: строка без статуса. Свежая — 409, старше STALE_MS — перезахват.
		await db.idempotencyKey.create({ data: { key: "k-crashed", route: "POST /tasks" } });
		assert.equal((await t.post("/tasks", { name: "y" }, "k-crashed")).status, 409);
		db.rows.get("k-crashed").createdAt = new Date(clock.getTime() - STALE_MS - 1000);
		const re = await t.post("/tasks", { name: "y" }, "k-crashed");
		assert.equal(re.status, 201);
		assert.equal(db.rows.get("k-crashed").status, 201);

		// Чистка: старше TTL — вон, свежие остаются.
		db.rows.get("k-route").createdAt = new Date(clock.getTime() - 8 * 86_400_000);
		assert.equal(await t.idem.prune(7 * 86_400_000), 1);
		assert.equal(db.rows.has("k-route"), false);
		assert.equal(db.rows.has("k-crashed"), true);
	} finally {
		t.close();
	}
});

test("база недоступна при захвате — запрос идёт как обычный; ключ длиннее 200 знаков не считается", async () => {
	const broken = { idempotencyKey: { create: async () => { throw new Error("connect ECONNREFUSED"); } } };
	const t = await app(broken);
	try {
		const r = await t.post("/tasks", { name: "z" }, "k-db-down");
		assert.equal(r.status, 201);
		assert.equal(t.calls.tasks, 1);
	} finally {
		t.close();
	}
	assert.equal(idempotencyKeyOf({ get: () => "x".repeat(201), body: {} }), null);
	assert.equal(idempotencyKeyOf({ get: () => undefined, body: { idempotencyKey: "  checks:1  " } }), "checks:1");
	assert.equal(idempotencyKeyOf({ get: () => "hdr", body: { idempotencyKey: "body" } }), "hdr", "заголовок важнее поля тела");
	assert.equal(idempotencyKeyOf({ get: () => undefined, body: null }), null);
});

// ── КР-5 аудита 27.09: обрыв клиентом, 5xx после побочного эффекта, ожидание записи итога ──

/** POST через node:http с обрывом соединения через abortMs (как ai по своему таймауту). */
function rawPost(port, path, body, key, abortMs) {
	return new Promise((resolve) => {
		const req = http.request({ host: "127.0.0.1", port, method: "POST", path, headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) } }, (res) => {
			let b = "";
			res.on("data", (d) => (b += d));
			res.on("end", () => resolve({ status: res.statusCode, replayed: res.headers["idempotent-replayed"] ?? null, body: b ? JSON.parse(b) : null }));
		});
		req.on("error", () => resolve({ status: "aborted" }));
		req.end(JSON.stringify(body ?? {}));
		if (abortMs) setTimeout(() => req.destroy(), abortMs);
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Дождаться условия (поллинг), не дольше limitMs. */
async function until(cond, limitMs = 3000) {
	const t0 = Date.now();
	while (!cond()) {
		if (Date.now() - t0 > limitMs) throw new Error("не дождались условия");
		await sleep(10);
	}
}

/** Приложение с «долгим» обработчиком и маршрутами-крайними случаями. */
async function abortApp(db, deps = {}) {
	const idem = createIdempotency({ db, log: quiet, ...deps });
	const a = express();
	a.use(express.json());
	const calls = { slow: 0, commit500: 0, throws: 0, end: 0 };
	a.post("/slow", idem.idempotent("POST /slow"), async (req, res) => {
		calls.slow++;
		const n = calls.slow;
		await sleep(Number(req.body?.ms) || 400); // «долгая» обработка ERP: клиент успевает оборвать
		return res.status(201).json({ success: true, item: { n } });
	});
	a.post("/commit500", idem.idempotent("POST /commit500"), async (req, res) => {
		calls.commit500++;
		if (req.body?.commit) res.locals.idempotencyCommitted = true; // «задача уже создана»
		return res.status(500).json({ success: false, message: "Ошибка сервера", n: calls.commit500 });
	});
	a.post("/throws", idem.idempotent("POST /throws"), (req, res, next) => {
		calls.throws++;
		if (calls.throws === 1) return next(new Error("сбой до побочного эффекта"));
		return res.status(201).json({ success: true, n: calls.throws });
	});
	a.post("/end", idem.idempotent("POST /end"), (req, res) => {
		calls.end++;
		res.status(204).end(); // ответ мимо res.json
	});
	// Как глобальный обработчик server.js: ответ ошибки — тоже через res.json.
	a.use((err, req, res, _next) => res.status(500).json({ success: false, message: "Внутренняя ошибка сервера" }));
	const srv = a.listen(0);
	await new Promise((r) => srv.once("listening", r));
	const port = srv.address().port;
	return { port, calls, close: () => srv.close(), post: (path, body, key, abortMs) => rawPost(port, path, body, key, abortMs) };
}

test("КР-5: обрыв клиентом через 100 мс не освобождает ключ — обработчик 1 раз, повтор получает сохранённый ответ", async () => {
	const db = fakeDb();
	const t = await abortApp(db);
	try {
		// Сценарий А: повтор, пока первый ещё обрабатывается, — 409, второй задачи нет.
		const first = t.post("/slow", { ms: 400 }, "1c:base:turn-A", 100);
		await sleep(150);
		assert.equal((await first).status, "aborted");
		assert.ok(db.rows.has("1c:base:turn-A"), "ключ после обрыва не освобождён");
		const busy = await t.post("/slow", { ms: 400 }, "1c:base:turn-A");
		assert.equal(busy.status, 409, "повтор во время обработки — «ещё обрабатывается»");
		// Первый обработчик доработал — итог запомнен, хотя клиент давно ушёл.
		await until(() => db.rows.get("1c:base:turn-A")?.status != null);
		assert.equal(db.rows.get("1c:base:turn-A").status, 201);
		const replay = await t.post("/slow", { ms: 400 }, "1c:base:turn-A");
		assert.equal(replay.status, 201);
		assert.equal(replay.replayed, "true");
		assert.deepEqual(replay.body, { success: true, item: { n: 1 } }, "повтор получает ответ первого запроса");
		assert.equal(t.calls.slow, 1, "обработчик выполнен ровно один раз");

		// Сценарий Б: повтор уже после того, как первый закончил.
		const b1 = t.post("/slow", { ms: 300 }, "1c:base:turn-B", 100);
		assert.equal((await b1).status, "aborted");
		await until(() => db.rows.get("1c:base:turn-B")?.status != null);
		const b2 = await t.post("/slow", { ms: 300 }, "1c:base:turn-B");
		assert.equal(b2.status, 201);
		assert.equal(b2.replayed, "true");
		assert.deepEqual(b2.body, { success: true, item: { n: 2 } });
		assert.equal(t.calls.slow, 2, "по ключу B обработчик тоже выполнен один раз");
	} finally {
		t.close();
	}
});

test("КР-5: 5xx после побочного эффекта (res.locals.idempotencyCommitted) запоминается; 5xx до него — ключ свободен", async () => {
	const db = fakeDb();
	const t = await abortApp(db);
	try {
		const e1 = await t.post("/commit500", { commit: true }, "k-committed");
		assert.equal(e1.status, 500);
		assert.equal(db.rows.get("k-committed")?.status, 500, "итог запомнен — повтор не создаст вторую задачу");
		const e2 = await t.post("/commit500", { commit: true }, "k-committed");
		assert.equal(e2.status, 500);
		assert.equal(e2.replayed, "true");
		assert.deepEqual(e2.body, e1.body);
		assert.equal(t.calls.commit500, 1, "обработчик не вызван повторно");

		// Без отметки — сбой до побочного эффекта: ключ освобождён, повтор выполняется заново.
		await t.post("/commit500", {}, "k-uncommitted");
		assert.equal(db.rows.has("k-uncommitted"), false);
		await t.post("/commit500", {}, "k-uncommitted");
		assert.equal(t.calls.commit500, 3);

		// Исключение обработчика (глобальный обработчик ошибок отвечает 500 через res.json) — ключ свободен.
		const x1 = await t.post("/throws", {}, "k-throws");
		assert.equal(x1.status, 500);
		assert.equal(db.rows.has("k-throws"), false);
		const x2 = await t.post("/throws", {}, "k-throws");
		assert.equal(x2.status, 201);
		assert.equal(t.calls.throws, 2);
	} finally {
		t.close();
	}
});

test("КР-5: ответ уходит клиенту только после записи итога; сбой записи повторяется; ответ мимо res.json запоминается", async () => {
	const db = fakeDb();
	// Медленная база и первая запись итога — со сбоем связи: итог всё равно записан до ответа.
	const update = db.idempotencyKey.update;
	let failOnce = true;
	db.idempotencyKey.update = async (args) => {
		await sleep(80);
		if (failOnce) {
			failOnce = false;
			throw Object.assign(new Error("connection reset"), { code: "P1017" });
		}
		return update(args);
	};
	const t = await abortApp(db);
	try {
		const r = await t.post("/slow", { ms: 10 }, "k-await");
		assert.equal(r.status, 201);
		assert.equal(db.rows.get("k-await")?.status, 201, "к моменту ответа итог уже в базе");
		assert.deepEqual(db.rows.get("k-await").response, r.body);

		const e = await t.post("/end", {}, "k-end");
		assert.equal(e.status, 204);
		await until(() => db.rows.get("k-end")?.status != null);
		assert.equal(db.rows.get("k-end").status, 204);
		const e2 = await t.post("/end", {}, "k-end");
		assert.equal(e2.status, 204);
		assert.equal(e2.replayed, "true");
		assert.equal(t.calls.end, 1);
	} finally {
		t.close();
	}
});
