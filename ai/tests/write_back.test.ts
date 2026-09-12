/**
 * Непрочитываемый признак: сервис помнит то, что сам записал.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, дважды за вечер). «Показывать в списке выбора» «не записывается»:
 * человек включает тумблер, команда `IB_UPDATE_USER` с `showInList: true` выполняется
 * успешно за 13–14 секунд, панель перечитывает базу — и показывает «выключено». Причина не
 * в записи: `IB_LIST_USERS` этот признак не возвращает вовсе, и панели его взять негде.
 * Значит помнить должен тот, кто записывал.
 *
 * Правило: запоминаем ТОЛЬКО по успешной команде и ТОЛЬКО то, чего нельзя прочитать.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeBackOf } from "../src/onec/writeBack.ts";

describe("что запомнить после успешной команды", () => {
	it("признак из IB_UPDATE_USER запоминается за этим пользователем", () => {
		assert.deepEqual(
			writeBackOf("IB_UPDATE_USER", { name: "Оператор бухгалтер", baseKey: "_transition", showInList: true }),
			{ name: "Оператор бухгалтер", showInList: true },
		);
	});

	it("выключенное значение — такой же факт, как включённое", () => {
		assert.deepEqual(
			writeBackOf("IB_CREATE_USER", { name: "Кассир", showInList: false }),
			{ name: "Кассир", showInList: false },
		);
	});

	it("переименование: значение относится к НОВОМУ имени", () => {
		// Под прежним именем пользователя в базе уже нет — запись по нему потерялась бы.
		assert.deepEqual(
			writeBackOf("IB_UPDATE_USER", { name: "Оператор", newName: "Оператор2", showInList: true }),
			{ name: "Оператор2", showInList: true },
		);
	});

	it("признака в команде не было — запоминать нечего", () => {
		// Правка полного имени не должна приписывать пользователю значение, которого не
		// посылали: именно так поле однажды включалось само.
		assert.equal(writeBackOf("IB_UPDATE_USER", { name: "Оператор", fullName: "Оператор" }), null);
	});

	it("читаемые поля по своей записи не запоминаем", () => {
		// Полное имя и «Отключен» приходят в каждом списке пользователей: там истина, и
		// расхождение с нашей записью должно быть видно, а не заглажено.
		const r = writeBackOf("IB_UPDATE_USER", { name: "Оператор", disabled: true, fullName: "Оператор" });
		assert.equal(r, null);
	});

	it("другие команды не трогаем", () => {
		assert.equal(writeBackOf("IB_DELETE_USER", { name: "Оператор", showInList: true }), null);
		assert.equal(writeBackOf("IB_LIST_USERS", { baseKey: "_transition" }), null);
	});

	it("пустое имя — не факт, а мусор", () => {
		assert.equal(writeBackOf("IB_UPDATE_USER", { name: "   ", showInList: true }), null);
	});
});
