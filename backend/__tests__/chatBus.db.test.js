// Шина событий между процессами (services/chatBus.js) против живого Postgres: LISTEN/NOTIFY.
//
// Идёт только на базе, в имени которой есть «test» (CI — buhprof_test, одноразовые копии), чтобы
// тестовые события не приходили живым подписчикам рабочей базы. Таблицы не нужны.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBus } from "../services/chatBus.js";

const dbName = (() => {
	try { return new URL(process.env.DATABASE_URL || "").pathname.replace(/^\//, ""); } catch { return ""; }
})();
const RUN = /test/i.test(dbName);
const quiet = { warn: () => {}, info: () => {} };

/** Дождаться, пока в массиве наберётся n событий (или срока). */
async function waitFor(list, n, ms = 5_000) {
	const until = Date.now() + ms;
	while (list.length < n && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
	return list;
}

test("живой Postgres: событие одного воркера доходит до подписчика другого, длинное — целиком", { skip: !RUN && `база «${dbName}» — не тестовая` }, async () => {
	const a = createBus({ clustered: true, log: quiet });
	const b = createBus({ clustered: true, log: quiet });
	try {
		const gotA = [];
		const gotB = [];
		a.subscribe(["org-live"], (e) => gotA.push(e));
		b.subscribe(["org-live"], (e) => gotB.push(e));
		// Подписка открывает соединение и LISTEN — дождаться, пока обе шины слушают.
		const until = Date.now() + 5_000;
		while ((!a._state().connected || !b._state().connected) && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
		assert.ok(a._state().connected && b._state().connected, "обе шины слушают канал");

		a.publish("org-live", { type: "notify", n: 1 });
		const long = "Акт сверки | подписан ✅ ".repeat(2500); // ≈ 75 КБ в UTF-8
		a.publish("org-live", { type: "chat", message: { text: long } });
		await waitFor(gotB, 2);
		assert.deepEqual(gotB[0], { type: "notify", n: 1 });
		assert.equal(gotB[1].message.text, long, "длинное сообщение собрано из частей без потерь");
		assert.equal(gotA.length, 2, "у публикующего — без дублей из канала");
	} finally {
		await a.close();
		await b.close();
	}
});
