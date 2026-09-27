// Н1 аудита 26.09: отклонённый промис async-обработчика Express 4 ронял воркер (Node 24 завершает
// процесс на необработанном отклонении). HEADLESS: express на свободном порту, без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { installAsyncErrorHandling } from "../utils/asyncErrors.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Приложение как в server.js: роутер с async-обработчиками и глобальный обработчик ошибок. */
function makeApp() {
	const app = express();
	const router = express.Router();
	router.get("/boom", async () => {
		await Promise.resolve();
		throw new Error("сбой БД");
	});
	router.get("/reject-empty", () => Promise.reject());
	router.get("/sync", () => {
		throw new Error("синхронно");
	});
	let lateNexts = 0;
	router.get("/late", async (req, res, next) => {
		next();
		await Promise.resolve();
		throw new Error("после next");
	});
	router.get("/late", (req, res) => {
		lateNexts++;
		res.json({ ok: true });
	});
	router.get("/ok", async (req, res) => res.json({ ok: true }));
	app.use("/api", router);
	// async-middleware с ошибкой до роутера тоже ловится
	app.use("/mw", async () => {
		throw new Error("middleware");
	});
	app.use((err, req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
	return { app, lateNexts: () => lateNexts };
}

function get(port, p) {
	return new Promise((resolve, reject) => {
		http.get({ host: "127.0.0.1", port, path: p }, (res) => {
			let body = "";
			res.on("data", (d) => { body += d; });
			res.on("end", () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
		}).on("error", reject);
	});
}

test("без защиты: await вне try роняет процесс (воспроизведение)", () => {
	const code = `
		import express from "express";
		import http from "node:http";
		const app = express();
		app.get("/boom", async () => { throw new Error("сбой"); });
		const srv = app.listen(0, () => http.get({ port: srv.address().port, path: "/boom" }, () => {}));
		setTimeout(() => process.exit(0), 3000);
	`;
	const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: root, encoding: "utf8", timeout: 10_000 });
	assert.equal(r.status, 1, "процесс должен был упасть на необработанном отклонении");
});

test("с защитой: отклонение async-обработчика → 500 через обработчик ошибок, процесс жив", async () => {
	assert.equal(installAsyncErrorHandling({ log: () => {} }) || true, true);
	const { app, lateNexts } = makeApp();
	const srv = app.listen(0);
	await new Promise((r) => srv.once("listening", r));
	const { port } = srv.address();
	try {
		const boom = await get(port, "/api/boom");
		assert.equal(boom.status, 500);
		assert.equal(boom.body.message, "сбой БД");

		const empty = await get(port, "/api/reject-empty");
		assert.equal(empty.status, 500, "пустое отклонение — тоже ошибка, а не «успех»");

		assert.equal((await get(port, "/api/sync")).status, 500);
		assert.equal((await get(port, "/mw")).status, 500);
		assert.deepEqual((await get(port, "/api/ok")).body, { ok: true });

		// Отклонение после next(): цепочку второй раз не запускаем — ответ один, обработчик один раз.
		const late = await get(port, "/api/late");
		assert.equal(late.status, 200);
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(lateNexts(), 1);
	} finally {
		srv.close();
	}
});

test("защита ставится один раз (повторный вызов — без двойной обёртки)", () => {
	installAsyncErrorHandling();
	assert.equal(installAsyncErrorHandling(), false);
});

test("unhandledRejection: пишется в журнал, процесс не падает", () => {
	// В отдельном процессе: у node:test свой обработчик отклонений, он засчитал бы их провалом теста.
	const code = `
		import { installUnhandledRejectionGuard } from "./utils/asyncErrors.js";
		installUnhandledRejectionGuard({ log: (m, e) => console.log("logged:" + e.message) });
		Promise.reject(new Error("забытый void"));
		setTimeout(() => { console.log("alive"); process.exit(0); }, 100);
	`;
	const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: root, encoding: "utf8", timeout: 10_000 });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /logged:забытый void/);
	assert.match(r.stdout, /alive/);
});
