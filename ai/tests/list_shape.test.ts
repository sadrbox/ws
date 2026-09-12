/**
 * Форма списка в ответе агента — и почему её разбор важнее строгости.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, 21:38 местного). Панель перестала показывать пользователей баз, а в
 * реестре у прочитанных баз стало НОЛЬ пользователей вместо пятнадцати-двадцати. Причина —
 * смена сборки агента: `IB_LIST_USERS` начала отвечать вложенным списком
 * `{"items": [[{…}, {…}]]}`. Сервис видел непустой массив, не находил в единственном его
 * элементе имени (это массив, а не запись), пропускал его — и удалял из кэша всех, «кого
 * нет в новом срезе».
 *
 * Два правила, которые держит тест: вложенный список разворачиваем, а неузнанную форму НЕ
 * считаем пустым срезом.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listItems } from "../src/onec/listShape.ts";

const user = (name: string) => ({ name, roles: [] as string[] });

describe("форма списка в ответе агента", () => {
	it("плоский список — как есть", () => {
		const r = listItems({ items: [user("a1"), user("maya")] });
		assert.equal(r?.unwrapped, false);
		assert.equal(r?.items.length, 2);
	});

	it("живой случай: вложенный список разворачивается", () => {
		const r = listItems({ items: [[user("a1"), user("maya")]] });
		assert.equal(r?.unwrapped, true);
		assert.deepEqual(r?.items.map((u) => u.name), ["a1", "maya"]);
	});

	it("пустой список законен и не считается ошибкой", () => {
		// У базы может не быть ни одного расширения — после удаления последнего приходит это.
		const r = listItems({ items: [] });
		assert.deepEqual(r, { items: [], unwrapped: false });
	});

	it("неузнанная форма — null, а не пустой срез", () => {
		// null означает «кэш не трогаем»: пустой срез стёр бы пользователей базы.
		assert.equal(listItems({ items: "нет" }), null);
		assert.equal(listItems({ items: [1, 2, 3] }), null);
		assert.equal(listItems({ items: [[user("a1")], [user("b2")]] }), null);
		assert.equal(listItems({ ok: true }), null);
		assert.equal(listItems(null), null);
	});

	it("массив принимается и сам по себе — без обёртки items", () => {
		const r = listItems([user("a1")]);
		assert.equal(r?.items.length, 1);
	});
});

/**
 * Последняя преграда: неразобранный срез не стирает кэш базы.
 *
 * Именно это и случилось 12.09: записи в срезе не разобрались, имён не нашлось, и
 * `DELETE … NOT (name = ANY(…))` удалил из кэша всех пользователей базы. Форму теперь
 * чинит `listItems`, но гард в реестре обязан держать и тот случай, когда форма окажется
 * ещё какой-нибудь: потеря знания молчалива, а восстанавливается только новым чтением 1С.
 */
describe("реестр: срез без единого имени", () => {
	/** Заглушка пула: запоминает запросы, ничего не делает. */
	const fakeDb = () => {
		const sql: string[] = [];
		const db = { query: async (q: string) => { sql.push(q); return { rows: [], rowCount: 0 }; } };
		return { db: db as unknown as import("../src/db/pool.ts").Db, sql };
	};

	it("пользователи: отказ, и ни одного запроса к базе", async () => {
		const { OnecRegistry } = await import("../src/onec/registry.ts");
		const { db, sql } = fakeDb();
		const registry = new OnecRegistry(db);
		await assert.rejects(
			() => registry.syncUsers("base-1", [{} as never, {} as never]),
			/не разобран/,
		);
		assert.deepEqual(sql, []);
	});

	it("расширения: то же правило", async () => {
		const { OnecRegistry } = await import("../src/onec/registry.ts");
		const { db, sql } = fakeDb();
		const registry = new OnecRegistry(db);
		await assert.rejects(() => registry.syncExtensions("base-1", [{} as never]), /не разобран/);
		assert.deepEqual(sql, []);
	});

	it("честно пустой срез по-прежнему применяется: расширение удалили — их нет", async () => {
		const { OnecRegistry } = await import("../src/onec/registry.ts");
		const { db, sql } = fakeDb();
		const registry = new OnecRegistry(db);
		await registry.syncExtensions("base-1", []);
		// Один запрос — удаление отсутствующих: пустой список законен и должен очистить кэш.
		assert.equal(sql.length, 1);
		assert.match(sql[0], /DELETE FROM base_extensions/);
	});
});
