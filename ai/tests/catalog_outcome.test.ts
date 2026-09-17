// П31: что со справочником «Пользователи» после команды — в итоге строки задания.
//
// Смысл проверок: «0» у нового пользователя — норма и должна читаться как норма, «больше одного» — дубль
// (предупреждение), «прочитать не удалось» — тоже предупреждение, а не молчание. «Создан элемент справочника»
// не пишется никогда: агент элементов не создаёт (created всегда false).
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogOutcome } from "../src/onec/catalogOutcome.ts";

test("нового пользователя элемент справочника ждёт первого входа — это не поломка", () => {
	const r = catalogOutcome("IB_CREATE_USER", { catalog: { found: 0, created: false, items: [] } })!;
	assert.match(r.outcome, /0/);
	assert.match(r.outcome, /при первом входе/);
	assert.equal(r.warning, null);
});

test("один элемент — обычный случай, без предупреждения", () => {
	const r = catalogOutcome("IB_UPDATE_USER", { catalog: { found: 1, created: false, items: [{ ref: "f89" }] } })!;
	assert.match(r.outcome, /1/);
	assert.equal(r.warning, null);
});

test("несколько элементов — дубль: предупреждение и чем лечить", () => {
	const r = catalogOutcome("IB_UPDATE_USER", { catalog: { found: 2, created: false } })!;
	assert.match(r.outcome, /2/);
	assert.match(r.warning!, /вход в программу/i);
	assert.match(r.warning!, /Поиск и удаление дублей/);
});

test("справочник не прочитался — предупреждение с причиной, а не молчание", () => {
	const r = catalogOutcome("IB_UPDATE_USER", { catalog: { found: null, created: false, error: "COM: Метаданные.Справочники" } })!;
	assert.match(r.warning!, /прочитать не удалось/);
	assert.match(r.warning!, /Метаданные\.Справочники/);
});

test("у удаления ноль — просто ноль: про первый вход там речи нет", () => {
	const r = catalogOutcome("IB_DELETE_USER", { catalog: { found: 0, created: false } })!;
	assert.match(r.outcome, /0/);
	assert.ok(!/первом входе/.test(r.outcome));
});

test("поля catalog нет или команда не про пользователя — итога нет", () => {
	assert.equal(catalogOutcome("IB_UPDATE_USER", { ok: true }), null);
	assert.equal(catalogOutcome("IB_INSTALL_EXTENSION", { catalog: { found: 3 } }), null);
	assert.equal(catalogOutcome("IB_UPDATE_USER", null), null);
});
