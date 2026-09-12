// Эхо состояния: изменяющая команда возвращает новое содержимое базы своим же ответом
// (docs/TASK_FRESH_STATE_AFTER_COMMAND.md).
//
// Смысл проверок. Принятый по ошибке НЕПОЛНЫЙ список замещает кэш базы целиком — и сводка
// «в каких базах есть Иванов» начинает врать, а узнают об этом через неделю. Поэтому
// правило принятия строгое, и ошибаться оно обязано в сторону «не применять»: тогда сервис
// просто ставит читающую команду, как делал всегда.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEcho } from "../src/onec/echo.ts";

test("полный список пользователей применяется и вырезается из результата", () => {
	const echo = parseEcho({
		ok: true,
		state: { users: { complete: true, readAt: "2026-09-12T10:00:00Z", items: [
			{ name: "Иванов", fullName: "Иванов И.И.", disabled: false, roles: ["ПолныеПрава"] },
		] } },
	});
	assert.ok(echo);
	assert.equal(echo.state.users?.length, 1);
	assert.equal(echo.state.users?.[0].name, "Иванов");
	assert.deepEqual(echo.state.users?.[0].roles, ["ПолныеПрава"]);
	// Применённое в командную запись не ложится: в реестре оно уже есть.
	assert.deepEqual(echo.result, { ok: true });
});

test("без complete не применяем ничего: «вот что успелось» — не срез", () => {
	assert.equal(parseEcho({ ok: true, state: { users: { items: [{ name: "Иванов" }] } } }), null);
	assert.equal(parseEcho({ ok: true, state: { users: { complete: false, items: [{ name: "Иванов" }] } } }), null);
});

test("строка без имени отвергает ВЕСЬ список, а не только себя", () => {
	// Иначе разобранные попадут в реестр, а остальные будут сочтены удалёнными из базы.
	const echo = parseEcho({
		ok: true,
		state: { users: { complete: true, items: [{ name: "Иванов" }, { fullName: "без имени" }] } },
	});
	assert.equal(echo, null);
});

test("пустой список законен: у базы может не быть ни одного расширения", () => {
	const echo = parseEcho({ ok: true, state: { extensions: { complete: true, items: [] } } });
	assert.ok(echo);
	assert.deepEqual(echo.state.extensions, []);
	assert.equal(echo.state.users, undefined);
});

test("неприменимое остаётся в ответе: реестра для сеансов нет, панель читает их из результата", () => {
	const echo = parseEcho({
		ok: true,
		state: {
			users: { complete: true, items: [{ name: "Иванов" }] },
			sessions: { items: [{ session: "12" }] },
		},
	});
	assert.ok(echo);
	assert.deepEqual(echo.result, { ok: true, state: { sessions: { items: [{ session: "12" }] } } });
});

test("ответ старого агента — эха нет, поведение прежнее", () => {
	assert.equal(parseEcho({ ok: true }), null);
	assert.equal(parseEcho({ ok: true, state: {} }), null);
	assert.equal(parseEcho(null), null);
	assert.equal(parseEcho("ok"), null);
	assert.equal(parseEcho({ ok: true, state: { users: { complete: true, items: "нет" } } }), null);
});

test("трёхзначный showInList доезжает как есть: null — «агент не сообщил»", () => {
	const echo = parseEcho({
		ok: true,
		state: { users: { complete: true, items: [
			{ name: "Иванов", showInList: true },
			{ name: "Петров", showInList: null },
			{ name: "Сидоров" },
		] } },
	});
	assert.ok(echo);
	assert.equal(echo.state.users?.[0].showInList, true);
	assert.equal(echo.state.users?.[1].showInList, null);
	assert.equal(echo.state.users?.[2].showInList, undefined);
});
