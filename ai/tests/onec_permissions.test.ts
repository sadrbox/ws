/**
 * Вложенные разрешения «Администрирования 1С» (решение 15.09): агенты — уровнем, расширения и пользователи баз —
 * действиями; без вложенных строк в этих разделах только просмотр.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agentsAllow, buildOnecPermissions, deniedMessage, onecRequirement, sectionAllows } from "../src/onec/permissions.ts";

const rows = (...r: [string, string][]) => r.map(([modelName, accessLevel]) => ({ modelName, accessLevel }));

describe("сборка разрешений", () => {
	it("суперадмин — всё; нет доступа к разделу — ничего", () => {
		assert.equal(buildOnecPermissions([], { isSuperAdmin: true, hasSection: false }).agents, "manage");
		assert.deepEqual(buildOnecPermissions(rows(["OneCAdmin.Agents", "manage"]), { isSuperAdmin: false, hasSection: false }),
			{ agents: "none", extensions: [], baseUsers: [] });
	});
	it("вложенные обязательны: доступ к разделу без строк — только просмотр агентов, без действий", () => {
		const p = buildOnecPermissions([], { isSuperAdmin: false, hasSection: true });
		assert.equal(p.agents, "view");
		assert.equal(sectionAllows(p, "baseUsers", "create", 1), false);
	});
	it("уровень агентов — максимум по организациям; действия — только «full»", () => {
		const p = buildOnecPermissions(rows(
			["OneCAdmin.Agents", "view"], ["OneCAdmin.Agents", "edit"],
			["OneCAdmin.BaseUsers.create", "full"], ["OneCAdmin.BaseUsers.delete", "none"],
		), { isSuperAdmin: false, hasSection: true });
		assert.equal(p.agents, "edit");
		assert.deepEqual(p.baseUsers, ["create"]);
	});
});

describe("проверки", () => {
	const p = buildOnecPermissions(rows(
		["OneCAdmin.Agents", "edit"], ["OneCAdmin.BaseUsers.create", "full"], ["OneCAdmin.Extensions.manage", "full"],
	), { isSuperAdmin: false, hasSection: true });
	it("агенты: просмотр ⊂ редактирование ⊂ управление", () => {
		assert.equal(agentsAllow(p, "view"), true);
		assert.equal(agentsAllow(p, "edit"), true);
		assert.equal(agentsAllow(p, "manage"), false);
	});
	it("больше одной базы — нужно групповое редактирование; «управление» — всё", () => {
		assert.equal(sectionAllows(p, "baseUsers", "create", 1), true);
		assert.equal(sectionAllows(p, "baseUsers", "create", 3), false);
		assert.equal(sectionAllows(p, "baseUsers", "delete", 1), false);
		assert.equal(sectionAllows(p, "extensions", "delete", 10), true);
		assert.match(deniedMessage({ kind: "section", section: "baseUsers", action: "create", bases: 3, type: "IB_CREATE_USER", baseKeys: [] }, p),
			/Пользователи баз: групповое редактирование/);
	});
});

describe("какое разрешение нужно запросу", () => {
	it("агенты", () => {
		assert.deepEqual(onecRequirement("GET", "/agents/a1/health"), { kind: "agents", level: "view" });
		assert.equal(onecRequirement("GET", "/agents"), null, "список агентов нужен панели для способностей");
		assert.deepEqual(onecRequirement("PATCH", "/agents/a1"), { kind: "agents", level: "edit" });
		assert.deepEqual(onecRequirement("PATCH", "/servers/s1"), { kind: "agents", level: "edit" });
		for (const [m, path] of [["POST", "/agents"], ["DELETE", "/agents/a1"], ["POST", "/agents/a1/rotate-token"], ["POST", "/agents/a1/disable"],
			["POST", "/agent-processes/12/kill"], ["POST", "/commands/c1/abort"]] as const) {
			assert.deepEqual(onecRequirement(m, path), { kind: "agents", level: "manage" }, path);
		}
	});
	it("пакет: пользователи и расширения — по типу и числу баз; прочее — общее правило", () => {
		const r = onecRequirement("POST", "/batch", { type: "ib_update_user", baseKeys: ["a", "b", "a"] });
		assert.deepEqual(r, { kind: "section", section: "baseUsers", action: "edit", bases: 2, type: "IB_UPDATE_USER", baseKeys: ["a", "b"] });
		assert.equal(onecRequirement("POST", "/batch", { type: "IB_BACKUP", baseKeys: ["a"] }), null);
		assert.deepEqual(onecRequirement("POST", "/batches/b1/retry"), { kind: "deferred" });
		assert.equal(onecRequirement("POST", "/sessions/x/terminate"), null);
	});
});
