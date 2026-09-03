// E15/A3, A6: белый список админ-команд, проверка payload и гейт по способностям агента.
//
// Смысл проверок: ошибка здесь означает либо админ-команду, ушедшую агенту без прав на
// кластер (и час разбирательств вместо внятного отказа), либо снятие сеанса не в той базе.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_COMMANDS, agentCanRun, buildAdminPayload, findAdminCommand, isAdminCommand } from "../src/commands/admin.ts";

const adminAgent = { role: "admin" as const, capabilities: ["CLUSTER_LIST_SESSIONS", "cluster.admin"] };
const businessAgent = { role: "business" as const, capabilities: ["CREATE_SALE", "onec.business"] };

test("список закрыт: чужой тип команды не находится", () => {
	assert.equal(isAdminCommand("CLUSTER_LIST_SESSIONS"), true);
	assert.equal(isAdminCommand("cluster_list_sessions"), true);
	assert.equal(isAdminCommand("DROP_INFOBASE"), false);
	assert.equal(findAdminCommand("EXECUTE_SQL"), null);
});

test("опасные операции помечены CRITICAL — они идут через подтверждение", () => {
	const critical = ADMIN_COMMANDS.filter((c) => c.operation === "CRITICAL").map((c) => c.type);
	assert.deepEqual(critical.sort(), ["CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_TERMINATE_SESSION"]);
	// Всё остальное — только чтение: список баз или сеансов ничего не меняет.
	assert.ok(ADMIN_COMMANDS.filter((c) => c.operation !== "CRITICAL").every((c) => c.operation === "READ"));
});

test("гейт: админ-команду получает только агент с cluster.admin", () => {
	const spec = findAdminCommand("CLUSTER_LIST_SESSIONS")!;
	assert.equal(agentCanRun(adminAgent, spec), true);
	assert.equal(agentCanRun(businessAgent, spec), false);
	// Роль admin без объявленной способности — служба есть, но кластер не настроен.
	assert.equal(agentCanRun({ role: "admin", capabilities: [] }, spec), false);
});

test("payload проверяется по схеме, лишние поля отвергаются", () => {
	const spec = findAdminCommand("CLUSTER_TERMINATE_SESSION")!;
	assert.equal(buildAdminPayload(spec, { sessionId: "12" }).ok, true);
	assert.equal(buildAdminPayload(spec, {}).ok, false);
	// Ни одно поле мимо схемы не должно доехать до командной строки rac.
	assert.equal(buildAdminPayload(spec, { sessionId: "12", extraArg: "--cluster-pwd=x" }).ok, false);
});

test("команда о конкретной базе без baseKey не ставится", () => {
	const lock = findAdminCommand("CLUSTER_SET_SESSIONS_LOCK")!;
	assert.equal(buildAdminPayload(lock, { enabled: true }).ok, false);

	const ok = buildAdminPayload(lock, { baseKey: "client-A", enabled: true, message: "Обслуживание" });
	assert.equal(ok.ok, true);
	// baseKey поднимается наверх: по нему выбирается агент нужного сервера.
	assert.equal(ok.ok && ok.baseKey, "client-A");
});

test("сеансы без базы — это весь кластер, и это допустимо", () => {
	const sessions = findAdminCommand("CLUSTER_LIST_SESSIONS")!;
	const r = buildAdminPayload(sessions, {});
	assert.equal(r.ok, true);
	assert.equal(r.ok && r.baseKey, null);
});
