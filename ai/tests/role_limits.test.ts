/**
 * Предел списка ролей — по ИЗМЕРЕННОЙ реальности, а не по догадке.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, вечер). «Не записывает права», а в ответ —
 * `addRoles: Too big: expected array to have <=100 items`. Замер по реестру в тот же час:
 * 309 РАЗЛИЧНЫХ ролей по базам, а у отдельных людей — 292, 192, 135, 132 роли. То есть
 * предел отвергал не злоупотребление, а обычного бухгалтера с полным набором прав.
 *
 * Сам предел и отказ по нему проверяет `admin_commands.test.ts` («выдать все роли»); здесь —
 * то, что он держится на ВСЕХ путях, которыми роли попадают в команду, и числа замера,
 * чтобы следующий, кто решит «сотни хватит», увидел, почему нет.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAdminPayload, findAdminCommand } from "../src/commands/admin.ts";

const roles = (n: number) => Array.from({ length: n }, (_, i) => `Роль${i + 1}`);

describe("роли в команде: измеренные объёмы", () => {
	const update = findAdminCommand("IB_UPDATE_USER")!;
	const create = findAdminCommand("IB_CREATE_USER")!;

	it("292 роли — столько их у человека в живой базе — проходят", () => {
		const r = buildAdminPayload(update, {
			baseKey: "kazplasttrade", name: "Динара", addRoles: roles(292),
		});
		assert.equal(r.ok, true, r.ok ? "" : r.message);
	});

	it("все 309 ролей реестра проходят КАЖДЫМ из трёх полей", () => {
		// Снятие и «привести к эталону» — те же объёмы, что и выдача: предел, забытый в
		// одном поле из трёх, ломает ровно одну операцию из трёх.
		for (const field of ["addRoles", "removeRoles", "roles"]) {
			const r = buildAdminPayload(update, {
				baseKey: "kazplasttrade", name: "Динара", [field]: roles(309),
			});
			assert.equal(r.ok, true, `${field}: ${r.ok ? "" : r.message}`);
		}
	});

	it("создание пользователя с полным набором ролей тоже проходит", () => {
		const r = buildAdminPayload(create, {
			baseKey: "kazplasttrade", name: "Новый", password: "x", roles: roles(309),
		});
		assert.equal(r.ok, true, r.ok ? "" : r.message);
	});
});
