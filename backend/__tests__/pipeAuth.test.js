// ─────────────────────────────────────────────────────────────────────────────
// Аутентификация приёмника событий 1С (POST /pipe).
//
// Симптом, из-за которого это появилось: «События 1С» всегда пусты. Причина была
// не в приёмнике — код записи работал, — а в том, что /pipe пускал ТОЛЬКО по JWT.
// 1С слала события без токена, получала 401 ещё до обработчика, и в логах не
// оставалось ничего (логгер стоит после авторизации). Отказ был молчаливым.
//
// Отсюда два требования, которые здесь и закреплены:
//   • ключ (X-Api-Key) пускает, неверный/отсутствующий — нет;
//   • сравнение ключа не должно зависеть от времени (защита от подбора).
// ─────────────────────────────────────────────────────────────────────────────
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma/prisma-client.js";
import { pipeAuth } from "../utils/pipeAuth.js";

after(async () => {
	await prisma.$disconnect();
});

/** Мини-заглушки express-объектов: достаточно для проверки решения middleware. */
function ctx({ apiKey, authorization } = {}) {
	const headers = {};
	if (authorization) headers.authorization = authorization;
	const req = {
		method: "POST",
		ip: "::1",
		headers,
		get: (h) => (h.toLowerCase() === "x-api-key" ? apiKey : headers[h.toLowerCase()]),
	};
	const res = {
		statusCode: null,
		body: null,
		status(c) { this.statusCode = c; return this; },
		json(b) { this.body = b; return this; },
	};
	return { req, res };
}

const withKey = async (envKey, opts) => {
	const prev = process.env.PIPE_API_KEY;
	if (envKey === null) delete process.env.PIPE_API_KEY;
	else process.env.PIPE_API_KEY = envKey;
	const { req, res } = ctx(opts);
	let passed = false;
	await pipeAuth(req, res, () => { passed = true; });
	if (prev === undefined) delete process.env.PIPE_API_KEY;
	else process.env.PIPE_API_KEY = prev;
	return { passed, req, res };
};

test("верный X-Api-Key пропускает и подставляет служебного пользователя", async () => {
	const r = await withKey("secret-key-123", { apiKey: "secret-key-123" });
	assert.equal(r.passed, true, "запрос должен пройти дальше");
	assert.ok(r.req.user?.uuid, "должен появиться req.user — он нужен audit и tenant-middleware");
	assert.equal(r.req.user.username, "1c-pipe");

	// Служебный аккаунт заводится сам, но войти под ним через форму нельзя.
	const u = await prisma.user.findFirst({
		where: { username: "1c-pipe" },
		select: { password: true, isSuperAdmin: true },
	});
	assert.equal(u.password, null, "пароля нет → вход под служебным аккаунтом невозможен");
	assert.equal(u.isSuperAdmin, true, "события приходят по разным орг (резолв по БИН) — не запираем в одну");
});

test("неверный ключ отклоняется", async () => {
	const r = await withKey("secret-key-123", { apiKey: "wrong" });
	assert.equal(r.passed, false);
	assert.equal(r.res.statusCode, 401);
});

test("совсем без ключа и без токена — 401 с ВНЯТНОЙ причиной", async () => {
	const r = await withKey("secret-key-123", {});
	assert.equal(r.passed, false);
	assert.equal(r.res.statusCode, 401);
	// Раньше 1С получала обезличенное «Требуется авторизация» и молчаливо теряла событие.
	assert.match(r.res.body.message, /X-Api-Key|Bearer/i);
});

test("ключ прислан, но PIPE_API_KEY не задан — не пускаем (иначе /pipe открыт всем)", async () => {
	const r = await withKey(null, { apiKey: "любой" });
	assert.equal(r.passed, false);
	assert.equal(r.res.statusCode, 401);
});

test("ключ другой ДЛИНЫ отклоняется без падения (timingSafeEqual требует равных длин)", async () => {
	const r = await withKey("secret-key-123", { apiKey: "short" });
	assert.equal(r.passed, false, "разная длина — не совпадение, но и не исключение");
	assert.equal(r.res.statusCode, 401);
});
