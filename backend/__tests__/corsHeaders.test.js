// Заголовки панели разрешены в CORS (24.09).
//
// ЗАЧЕМ ЭТОТ ТЕСТ. Дважды повторилась одна и та же поломка: фронт начинал слать новый заголовок
// (`X-Onec-Server`, затем `X-Org-Scope`), а в списке CORS его не было. Браузер в таком случае
// отменяет запрос НА ПРЕДВАРИТЕЛЬНОЙ ПРОВЕРКЕ: до сервера он не доходит, в логах пусто, а
// человек видит «Network Error» и думает, что сервер лежит. Ошибка дорогая именно этим —
// искать её начинают не там.
//
// Тест читает, какие заголовки панель добавляет к запросам, и требует, чтобы каждый был
// разрешён сервером.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = readFileSync(path.join(root, "server.js"), "utf8");
const CLIENT = readFileSync(path.resolve(root, "..", "frontend", "src", "services", "api", "client.ts"), "utf8");

/** Список из server.js: `const CORS_ALLOWED_HEADERS = [ ... ]`. */
function allowedHeaders() {
	const m = SERVER.match(/const CORS_ALLOWED_HEADERS = \[([\s\S]*?)\];/);
	assert.ok(m, "не найден список CORS_ALLOWED_HEADERS — изменилось имя или форма");
	return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].toLowerCase());
}

/** Заголовки, которые панель кладёт в запрос: `config.headers["X-..."] = ...`. */
function headersSentByPanel() {
	return [...CLIENT.matchAll(/config\.headers\[\s*"([^"]+)"\s*\]\s*=/g)].map((x) => x[1].toLowerCase());
}

test("список CORS задан один раз и не пуст", () => {
	// Раньше он был написан дважды — для обычных запросов и для preflight, — и заголовок
	// вписали только в одно место. Теперь список один, и забыть второе некуда.
	const list = allowedHeaders();
	assert.ok(list.length >= 5, `подозрительно короткий список: ${list.join(", ")}`);
	assert.equal(SERVER.match(/const CORS_ALLOWED_HEADERS = \[/g)?.length, 1);
	assert.equal((SERVER.match(/allowedHeaders:\s*CORS_ALLOWED_HEADERS/g) ?? []).length, 2,
		"оба места (общий CORS и preflight) должны брать один список");
});

test("каждый заголовок панели разрешён сервером", () => {
	const allowed = allowedHeaders();
	const sent = headersSentByPanel();
	assert.ok(sent.length > 0, "не нашлись заголовки, добавляемые панелью — изменился способ");
	const missing = sent.filter((h) => !allowed.includes(h));
	assert.deepEqual(missing, [],
		`панель шлёт заголовки, запрещённые CORS: ${missing.join(", ")}. Браузер отменит такой ` +
		"запрос на предварительной проверке — до сервера он не дойдёт, и это выглядит как «сервер недоступен».");
});

test("оба известных заголовка на месте", () => {
	const allowed = allowedHeaders();
	// X-Onec-Server — выбранный кластер 1С; X-Org-Scope — сводный вид по группе организаций.
	assert.ok(allowed.includes("x-onec-server"));
	assert.ok(allowed.includes("x-org-scope"));
});
