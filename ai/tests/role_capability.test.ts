/**
 * Правка ролей — только агенту, который её применяет (C5, решение администратора 13.09).
 *
 * Сборки без `ib.roles` отвечали на `addRoles`/`removeRoles`/`roles` успехом и ничего не
 * меняли; без `ib.echo` сервис этого даже не видел, и панель показывала «Выполнено». Такие
 * сборки правку ролей не получают: отказ сразу, словами «обновите агента». Остальное — как было.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findAdminCommand, payloadRefusal, requiredCapability } from "../src/commands/admin.ts";

const update = findAdminCommand("IB_UPDATE_USER")!;
const oldBuild = { capabilities: ["ib.admin", "ib.echo", "IB_UPDATE_USER"] };
const newBuild = { capabilities: ["ib.admin", "ib.echo", "ib.roles", "IB_UPDATE_USER"] };

describe("правка ролей требует ib.roles", () => {
	it("поправки и полный набор — все три способа требуют ib.roles", () => {
		for (const roles of [{ addRoles: ["Кассир"] }, { removeRoles: ["Кассир"] }, { roles: [] }]) {
			const payload = { baseKey: "_transition", name: "Оператор", ...roles };
			assert.equal(requiredCapability(update, payload)?.capability, "ib.roles");
			assert.match(payloadRefusal(oldBuild, update, payload) ?? "", /обновите агента/);
			assert.equal(payloadRefusal(newBuild, update, payload), null);
		}
	});

	it("правка без ролей старой сборке по-прежнему доступна", () => {
		const payload = { baseKey: "_transition", name: "Оператор", disabled: true, showInList: false };
		assert.equal(requiredCapability(update, payload), null);
		assert.equal(payloadRefusal(oldBuild, update, payload), null);
	});

	it("другие команды содержимым не ограничены", () => {
		const list = findAdminCommand("IB_LIST_USERS")!;
		assert.equal(payloadRefusal(oldBuild, list, { baseKey: "_transition" }), null);
	});
});
