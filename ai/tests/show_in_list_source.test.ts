/**
 * Откуда известно «Показывать в списке выбора»: из 1С или по нашей записи.
 *
 * ЗАДАЧА A2 (13.09). Колонка `show_in_list` наполняется из двух источников — чтение у 1С и
 * запоминание по успешной записи панели (`rememberShowInList`). Карточка подписывала оба
 * одинаково «прочитать неоткуда»; как только агент начнёт отдавать признак, подпись стала бы
 * ложью. Реестр теперь хранит источник, и тест держит правила его смены.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/** Заглушка пула: запоминает запросы и параметры. */
const fakeDb = (rows: unknown[] = []) => {
	const calls: { sql: string; params: unknown[] }[] = [];
	const db = {
		query: async (sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			return { rows, rowCount: 1 };
		},
	};
	return { db: db as unknown as import("../src/db/pool.ts").Db, calls };
};

describe("источник признака «показывать в списке выбора»", () => {
	it("чтение у 1С: значение есть — источник 'base', молчание — прежний источник", async () => {
		const { OnecRegistry } = await import("../src/onec/registry.ts");
		const { db, calls } = fakeDb();
		await new OnecRegistry(db).syncUsers("base-1", [
			{ name: "Оператор", showInList: true },
			{ name: "Кассир" },
		]);
		const insert = calls.find((c) => /INSERT INTO base_users/.test(c.sql));
		assert.ok(insert, "срез пишет пользователей");
		// Источник вычисляется из того же параметра, что и значение: без значения — NULL,
		// и COALESCE сохраняет прежний источник вместе с прежним значением.
		assert.match(insert.sql, /CASE WHEN \$7::boolean IS NULL THEN NULL ELSE 'base' END/);
		assert.match(insert.sql, /show_in_list_source = COALESCE\(EXCLUDED\.show_in_list_source, base_users\.show_in_list_source\)/);
		const params = calls.filter((c) => /INSERT INTO base_users/.test(c.sql)).map((c) => c.params[6]);
		assert.deepEqual(params, [true, null]);
	});

	it("запись панели помечается 'panel'", async () => {
		const { OnecRegistry } = await import("../src/onec/registry.ts");
		const { db, calls } = fakeDb();
		assert.equal(await new OnecRegistry(db).rememberShowInList("base-1", "Оператор", false), true);
		assert.match(calls[0].sql, /show_in_list_source = 'panel'/);
	});

	it("панель получает источник вместе со значением", async () => {
		const { OnecRegistry } = await import("../src/onec/registry.ts");
		const { db } = fakeDb([{
			name: "Оператор", full_name: "", disabled: false, roles: [],
			show_in_list: false, show_in_list_source: "panel", seen_at: new Date("2026-09-13T06:00:00Z"),
		}]);
		const [u] = await new OnecRegistry(db).usersOfBase("base-1");
		assert.equal(u.showInList, false);
		assert.equal(u.showInListSource, "panel");
	});
});
