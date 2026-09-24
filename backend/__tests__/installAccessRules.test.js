// Правила установки и членства (О1/О4/О6 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// Headless: оба модуля правил намеренно не знают про Prisma, поэтому проверяются в гейте
// `verify` без поднятой БД. Здесь закреплены решения, которые легче всего сломать случайной
// правкой, — умолчания.
import test from "node:test";
import assert from "node:assert/strict";
import {
	INSTALL_MODES, DEFAULT_MODE, normalizeMode, selfRegistrationAllowed,
} from "../services/installationModes.js";
import {
	OWNER_ROLE, DEFAULT_ROLE, normalizeRole, isInstallationOperator, canSignIn,
} from "../services/orgMembershipRules.js";

test("режим установки: три значения, умолчание — group", () => {
	assert.deepEqual(INSTALL_MODES, ["service", "isolated", "group"]);
	assert.equal(DEFAULT_MODE, "group");
	assert.equal(normalizeMode("SERVICE"), "service");
	assert.equal(normalizeMode(" isolated "), "isolated");
	// Опечатка в настройке не должна ронять установку на старте.
	assert.equal(normalizeMode("consulting"), "group");
	assert.equal(normalizeMode(undefined), "group");
});

test("самостоятельная регистрация открыта только у изолированных арендаторов", () => {
	assert.equal(selfRegistrationAllowed({ mode: "isolated" }), true);
	assert.equal(selfRegistrationAllowed({ mode: "service" }), false);
	assert.equal(selfRegistrationAllowed({ mode: "group" }), false);
});

test("режим не выбран — правило молчит, поведение остаётся прежним", () => {
	// null, а не false: закрыть форму на работающей установке только потому, что её никто
	// не настраивал, — худшее, что может сделать эта правка.
	assert.equal(selfRegistrationAllowed({}), null);
	assert.equal(selfRegistrationAllowed({ mode: null }), null);
});

test("явное значение главнее режима — и в ту, и в другую сторону", () => {
	assert.equal(selfRegistrationAllowed({ mode: "group", override: true }), true);
	assert.equal(selfRegistrationAllowed({ mode: "isolated", override: false }), false);
	// Из настроек значение приходит строкой — так его кладёт app_settings.
	assert.equal(selfRegistrationAllowed({ mode: "group", override: "true" }), true);
	assert.equal(selfRegistrationAllowed({ mode: "isolated", override: "false" }), false);
});

test("роль: владелец — admin, по умолчанию участник, мусор не проходит", () => {
	assert.equal(OWNER_ROLE, "admin");
	assert.equal(DEFAULT_ROLE, "member");
	assert.equal(normalizeRole("ADMIN"), "admin");
	assert.equal(normalizeRole("owner"), "member", "роли owner пока нет — не выдумываем права");
	assert.equal(normalizeRole(undefined), "member");
});

test("вход: без организаций не пускаем, оператора установки — пускаем", () => {
	assert.deepEqual(canSignIn({ membershipCount: 1 }), { allowed: true, reason: null });
	assert.deepEqual(canSignIn({ membershipCount: 0 }), { allowed: false, reason: "NO_ORGANIZATIONS" });
	// Иначе после сбоя, в котором пропали связи, чинить систему будет некому.
	assert.deepEqual(canSignIn({ isOperator: true, membershipCount: 0 }), { allowed: true, reason: null });
	assert.deepEqual(canSignIn(), { allowed: false, reason: "NO_ORGANIZATIONS" });
});

test("оператор установки — пока суперадмин, и это единственное место, где так написано", () => {
	assert.equal(isInstallationOperator({ isSuperAdmin: true }), true);
	assert.equal(isInstallationOperator({ isSuperAdmin: false }), false);
	assert.equal(isInstallationOperator(null), false);
});
