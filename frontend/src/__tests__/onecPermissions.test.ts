/**
 * Вложенные разрешения «Администрирования 1С» в панели — те же правила, что в сервисе.
 */
import { describe, expect, it } from "vitest";
import {
	AGENTS_KEY, ONEC_NESTED_PERMISSIONS, agentsAllow, buildOnecPermissions, deniedText, nestedDepth, nestedLevelOptions, sectionAllows,
} from "src/models/OneCAdmin/onecPermissions";
import { translate } from "src/i18";

const rows = (...r: [string, string][]) => r.map(([modelName, accessLevel]) => ({ modelName, accessLevel }));

describe("вложенные разрешения 1С", () => {
	it("вложенные обязательны: доступ к разделу без строк — только просмотр агентов", () => {
		const p = buildOnecPermissions([], { isSuperAdmin: false, hasSection: true });
		expect(p.agents).toBe("view");
		expect(agentsAllow(p, "edit")).toBe(false);
		expect(sectionAllows(p, "extensions", "create", 1)).toBe(false);
	});
	it("управление раздела — всё; несколько баз — нужно групповое редактирование", () => {
		const p = buildOnecPermissions(rows(["OneCAdmin.BaseUsers.edit", "full"], ["OneCAdmin.Extensions.manage", "full"]),
			{ isSuperAdmin: false, hasSection: true });
		expect(sectionAllows(p, "baseUsers", "edit", 1)).toBe(true);
		expect(sectionAllows(p, "baseUsers", "edit", 2)).toBe(false);
		expect(deniedText(p, "baseUsers", "edit", 2)).toContain(translate("onecPermGroupEdit"));
		expect(sectionAllows(p, "extensions", "delete", 5)).toBe(true);
	});
	it("форма: 11 вложенных строк, свои уровни у агентов и у действий", () => {
		expect(ONEC_NESTED_PERMISSIONS).toHaveLength(11);
		expect(nestedDepth(AGENTS_KEY)).toBe(1);
		expect(nestedDepth("OneCAdmin.Extensions.create")).toBe(2);
		expect(nestedLevelOptions(AGENTS_KEY)?.map((o) => o.value)).toEqual(["none", "view", "edit", "manage"]);
		expect(nestedLevelOptions("OneCAdmin.BaseUsers.delete")?.map((o) => o.value)).toEqual(["full", "none"]);
		expect(nestedLevelOptions("Sale")).toBeNull();
	});
});
