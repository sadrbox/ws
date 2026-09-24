// Квоты арендатора (И3 плана PLAN_INSTALL_MODES_2026-09-24.md).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveLimit, exceeds, QUOTA_KEYS } from "../services/quotas.js";

test("ноль и пусто означают «без предела», а не «ничего нельзя»", () => {
	// Потерять это правило — значит на установке с нулём перестать сохранять что-либо вовсе.
	assert.equal(resolveLimit(0, 0), 0);
	assert.equal(resolveLimit(null, undefined), 0);
	assert.equal(resolveLimit("", ""), 0);
	assert.equal(exceeds(1000, 0, 500), false, "без предела не превышают");
});

test("предел организации главнее общего", () => {
	assert.equal(resolveLimit(5, 100), 5);
	assert.equal(resolveLimit(null, 100), 100, "своего нет — действует общий");
	assert.equal(resolveLimit(0, 100), 100, "ноль у организации — не запрет, а «не назначено»");
});

test("превышение считается с учётом добавляемого", () => {
	assert.equal(exceeds(4, 5, 1), false, "ровно на пределе — ещё можно");
	assert.equal(exceeds(5, 5, 1), true);
	assert.equal(exceeds(5, 5, 0), false, "уже существующее сверх предела не блокирует чтение");
});

test("ключи квот заданы явно — опечатка не пройдёт молча", () => {
	assert.deepEqual(Object.keys(QUOTA_KEYS).sort(), ["fileMb", "storageMb", "users"]);
});
