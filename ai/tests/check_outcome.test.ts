/**
 * Итог проверки базы в строке задания (С17): найденное — словами и предупреждением, а не «Выполнено» с «—».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOutcome } from "../src/onec/checkOutcome.ts";

describe("С17: итог проверки базы", () => {
	it("осмотр нашёл ошибки — итог с числом и предупреждение про «Исправлять»", () => {
		const r = checkOutcome({ issues: 3, repaired: 0, repairMode: false, skipped: ["reindex"] });
		assert.equal(r?.outcome, "найдено ошибок: 3; не выполнено без «Исправлять»: переиндексация");
		assert.match(r?.warning ?? "", /найдены ошибки: 3/);
	});
	it("исправление не всё — сколько осталось; всё исправлено или ошибок нет — без предупреждения", () => {
		assert.match(checkOutcome({ issues: 5, repaired: 2, repairMode: true })?.warning ?? "", /осталось 3 из 5/);
		assert.equal(checkOutcome({ issues: 5, repaired: 5, repairMode: true })?.warning, null);
		assert.deepEqual(checkOutcome({ issues: 0, repaired: 0 }), { outcome: "найдено ошибок: 0", warning: null });
	});
	it("чисел нет — итога нет (старый ответ или не проверка)", () => {
		assert.equal(checkOutcome({ issues: null, repaired: null }), null);
		assert.equal(checkOutcome(null), null);
	});
});
