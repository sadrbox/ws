// Н3 и Н10 аудита 26.09: предел выдачи списков и ошибки ввода → 400. HEADLESS: схема читается из
// Prisma.dmmf (статично, без подключения к БД); express — на свободном порту.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { Prisma } from "@prisma/client";
import {
	MAX_LIST_LIMIT, clampLimit, BadRequestError, parseDateParam, buildFilterWhere, isClientInputError, sendError,
} from "../utils/listQuery.js";
import { dbPoolConfig, DB_POOL_DEFAULTS } from "../utils/dbPoolConfig.js";

test("clampLimit: потолок 500 вместо 999999, мусор — умолчание, свой max — для законных случаев", () => {
	assert.equal(MAX_LIST_LIMIT, 500);
	assert.equal(clampLimit("999999"), 500, "выгрузка таблицы целиком больше не проходит");
	assert.equal(clampLimit(undefined), 500);
	assert.equal(clampLimit(""), 500);
	assert.equal(clampLimit("abc"), 500, "NaN раньше уходил в Prisma как take: NaN → 500");
	assert.equal(clampLimit("0"), 1);
	assert.equal(clampLimit("-5"), 1);
	assert.equal(clampLimit("10"), 10);
	assert.equal(clampLimit("10.7"), 10);
	assert.equal(clampLimit(["20", "30"]), 20, "повторённый параметр — первое значение");
	assert.equal(clampLimit(undefined, { def: 100 }), 100);
	assert.equal(clampLimit("1000", { max: 1000 }), 1000, "канбан сделок просит 1000");
	assert.equal(clampLimit(undefined, { def: 1000 }), 500, "умолчание не выше потолка");
});

test("parseDateParam: пусто → null, кривая дата → 400, а не Invalid Date в Prisma", () => {
	assert.equal(parseDateParam(undefined), null);
	assert.equal(parseDateParam(""), null);
	assert.equal(parseDateParam("2026-09-26").toISOString(), "2026-09-26T00:00:00.000Z");
	assert.throws(() => parseDateParam("вчера", "before"), (e) => e instanceof BadRequestError && e.status === 400 && /before/.test(e.message));
});

test("buildFilterWhere: поля и значения — по схеме", () => {
	assert.deepEqual(buildFilterWhere("counterparty", { name: { contains: "рога" } }), { name: { contains: "рога", mode: "insensitive" } });
	assert.deepEqual(buildFilterWhere("counterparty", { id: { gte: "5", lt: "10" } }), { id: { gte: 5, lt: 10 } });
	const d = buildFilterWhere("counterparty", { createdAt: { gte: "2026-09-01" } });
	assert.equal(d.createdAt.gte.toISOString(), "2026-09-01T00:00:00.000Z", "дата без времени — приводится, а не 500");
	assert.deepEqual(buildFilterWhere("counterparty", { searchBy: { contains: "x" }, dateRange: { gte: "y" } }), {}, "ключи роутера пропускаются");
	assert.deepEqual(buildFilterWhere("counterparty", { name: { regex: ".*" } }), {}, "неразрешённый оператор игнорируется");
	assert.deepEqual(buildFilterWhere("counterparty", null), {});
});

test("buildFilterWhere: неизвестное поле, связь, кривая дата/число → 400", () => {
	const bad = (filter) => assert.throws(() => buildFilterWhere("counterparty", filter), (e) => e instanceof BadRequestError && e.status === 400);
	bad({ nosuchfield: { equals: "1" } });
	bad({ organization: { equals: "x" } }); // связь, а не скаляр
	bad({ "organization.name": { contains: "x" } });
	bad({ createdAt: { gte: "вчера" } });
	bad({ id: { equals: "abc" } });
	bad({ id: { equals: "99999999999" } }); // за пределами int4
	assert.throws(() => buildFilterWhere("nosuchmodel", { a: { equals: 1 } }), BadRequestError);
});

test("isClientInputError: ошибки ввода отделяются от сбоев", () => {
	assert.equal(isClientInputError(new BadRequestError("x")), true);
	assert.equal(isClientInputError(new Prisma.PrismaClientValidationError("Unknown argument `serials`", { clientVersion: "7" })), true);
	assert.equal(isClientInputError(Object.assign(new Error("value too long"), { code: "P2000" })), true);
	assert.equal(isClientInputError(Object.assign(new Error("unique"), { code: "P2002" })), false, "дубль — не ошибка ввода фильтра");
	assert.equal(isClientInputError(new Error("connection refused")), false);
	assert.equal(isClientInputError(null), false);
});

function get(port, p) {
	return new Promise((resolve, reject) => {
		http.get({ host: "127.0.0.1", port, path: p }, (res) => {
			let body = "";
			res.on("data", (d) => { body += d; });
			res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
		}).on("error", reject);
	});
}

test("sendError: 400 для ошибок ввода (текст Prisma наружу не уходит), 500 для остального", async () => {
	const app = express();
	app.get("/bad-filter", (req, res) => {
		try {
			buildFilterWhere("counterparty", req.query.filter);
			res.json({ ok: true });
		} catch (e) {
			sendError(res, e, { label: "test" });
		}
	});
	app.get("/prisma", (req, res) => sendError(res, new Prisma.PrismaClientValidationError("Unknown argument `password`", { clientVersion: "7" })));
	app.get("/crash", (req, res) => {
		const origError = console.error;
		console.error = () => {};
		try { sendError(res, new Error("db down"), { message: "Ошибка сервера" }); } finally { console.error = origError; }
	});
	const srv = app.listen(0);
	await new Promise((r) => srv.once("listening", r));
	const { port } = srv.address();
	try {
		const a = await get(port, "/bad-filter?filter[createdAt][gte]=garbage");
		assert.equal(a.status, 400);
		assert.match(a.body.message, /createdAt/);
		const b = await get(port, "/prisma");
		assert.equal(b.status, 400);
		assert.equal(b.body.message, "Некорректные параметры запроса");
		const c = await get(port, "/crash");
		assert.equal(c.status, 500);
		assert.equal(c.body.message, "Ошибка сервера");
	} finally {
		srv.close();
	}
});

test("dbPoolConfig (Н2): явные пределы по умолчанию и из окружения", () => {
	const warns = [];
	const d = dbPoolConfig({ DATABASE_URL: "postgres://x" }, { warn: (m) => warns.push(m) });
	assert.equal(d.max, DB_POOL_DEFAULTS.max);
	assert.equal(d.max, 17, "совпадает с расчётом ecosystem.config.js: 4 × 17 = 68 < 100");
	assert.equal(d.connectionTimeoutMillis, 5000, "ожидание соединения не бесконечное");
	assert.equal(d.statement_timeout, 30000, "запрос не бесконечный");
	assert.equal(d.query_timeout, undefined, "клиентский таймаут не ставим — запрос остался бы в базе");
	assert.equal(d.connectionString, "postgres://x");
	const e = dbPoolConfig({ DB_POOL_MAX: "8", DB_POOL_CONNECTION_TIMEOUT_MS: "0", DB_STATEMENT_TIMEOUT_MS: "120000" });
	assert.deepEqual([e.max, e.connectionTimeoutMillis, e.statement_timeout], [8, 0, 120000]);
	const bad = dbPoolConfig({ DB_POOL_MAX: "0", DB_STATEMENT_TIMEOUT_MS: "полминуты" }, { warn: (m) => warns.push(m) });
	assert.deepEqual([bad.max, bad.statement_timeout], [17, 30000], "мусор — умолчание, а не 0");
	assert.equal(warns.length, 2);
});
