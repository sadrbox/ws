/**
 * S3 из docs/TASKS_ONEC_FIXES_2026-09-13.md: `CLUSTER_CHECK_BASES` — есть ли у баз их база
 * данных в СУБД.
 *
 * Держим то, что ломается молча: проверка одной базы и проверка всех не должны склеиться в
 * одну команду (второй получил бы чужой ответ); строка без признака — «проверить не удалось»,
 * и отметку она не трогает; проверка — чтение и доступна уровню `readonly`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdminPayload, findAdminCommand } from "../src/commands/admin.ts";
import { BaseService } from "../src/bases/service.ts";
import { isDestructive } from "../src/onec/access.ts";
import type { Db } from "../src/db/pool.ts";

type Call = { sql: string; params: unknown[] };

function fakeDb(calls: Call[]): Db {
	return {
		query: async (sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			return { rows: [], rowCount: 0 };
		},
		connect: async () => { throw new Error("не нужен"); },
	} as unknown as Db;
}

test("спецификация: чтение кластера без обязательной базы", () => {
	const spec = findAdminCommand("CLUSTER_CHECK_BASES");
	assert.ok(spec, "команды нет в белом списке");
	assert.equal(spec.operation, "READ");
	assert.equal(spec.capability, "cluster.admin");
	assert.equal(spec.requiresBase, false);

	const all = buildAdminPayload(spec, {});
	assert.equal(all.ok && all.baseKey, null);
	assert.ok(buildAdminPayload(spec, { baseKeys: ["aibek"] }).ok);
	assert.equal(buildAdminPayload(spec, { baseKeys: ["aibek"], drop: true }).ok, false, "лишние поля отвергаются");
});

test("склейка: одна база и все базы — разные команды, порядок ключей не важен", () => {
	const spec = findAdminCommand("CLUSTER_CHECK_BASES")!;
	const key = spec.readKey!;
	assert.equal(key({}), "all");
	assert.notEqual(key({ baseKeys: ["aibek"] }), key({}));
	assert.equal(key({ baseKeys: ["b", "a"] }), key({ baseKeys: ["a", "b", "a"] }));
	assert.notEqual(key({ baseKeys: ["a", "b"] }), key({ baseKeys: ["a", "c"] }));
	// Ключ короткий и на тысяче баз: колонка request_id стоит под уникальным индексом.
	const many = Array.from({ length: 1000 }, (_, i) => `base_with_a_long_name_${i}`);
	assert.ok(key({ baseKeys: many }).length < 40);
});

test("результат: true ставит NO_DB, false снимает, строка без признака не трогается", async () => {
	const calls: Call[] = [];
	const applied = await new BaseService(fakeDb(calls)).applyCheckResult("srv-1", {
		items: [{ key: "aibek", dbMissing: true }, { key: " alfa ", dbMissing: false }, { key: "x" }, { dbMissing: true }],
		checked: 3, skipped: 1,
	});

	assert.equal(applied, 2);
	const setNoDb = calls.find((c) => c.sql.includes("SET ib_unreachable_at = COALESCE("));
	assert.deepEqual(setNoDb?.params, ["srv-1", ["aibek"]]);
	const clear = calls.find((c) => c.sql.includes("SET ib_unreachable_at = NULL"));
	assert.deepEqual(clear?.params, ["srv-1", ["alfa"]]);
	assert.ok(!JSON.stringify(calls).includes('"x"'), "база без признака попала в запрос");
});

test("результат без списка (агенту нечем проверить) ничего не трогает", async () => {
	const calls: Call[] = [];
	const applied = await new BaseService(fakeDb(calls)).applyCheckResult("srv-1", { note: "нет пароля СУБД" });
	assert.equal(applied, 0);
	assert.equal(calls.length, 0);
});

test("проверка баз данных — чтение: уровень readonly её выполняет", () => {
	assert.equal(isDestructive("POST", "/bases/check-db"), false);
});
