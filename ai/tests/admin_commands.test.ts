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
	assert.deepEqual(critical.sort(), [
		"CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_TERMINATE_SESSION",
		// Внутрибазовые изменения так же необратимы: удалённого пользователя ИБ или
		// снесённое расширение не вернуть, а установка меняет конфигурацию базы.
		"IB_CREATE_USER", "IB_DELETE_EXTENSION", "IB_DELETE_USER", "IB_INSTALL_EXTENSION",
	]);
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

test("внутрибазовые команды требуют ib.admin — cluster.admin их не получает", () => {
	const create = findAdminCommand("IB_CREATE_USER")!;
	assert.equal(create.capability, "ib.admin");
	// Агент только с cluster.admin умеет кластер, но не вход в базы.
	assert.equal(agentCanRun(adminAgent, create), false);
	assert.equal(agentCanRun({ ...adminAgent, capabilities: ["cluster.admin", "ib.admin"] }, create), true);
});

test("IB_CREATE_USER: база и имя обязательны, лишние поля отвергаются", () => {
	const spec = findAdminCommand("IB_CREATE_USER")!;
	assert.equal(buildAdminPayload(spec, { name: "ivanov" }).ok, false, "без baseKey");
	assert.equal(buildAdminPayload(spec, { baseKey: "buh" }).ok, false, "без имени");
	// Схема strict: случайное поле — это опечатка вызывающего, а не «просто игнор».
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", name: "ivanov", role: "admin" }).ok, false);

	const ok = buildAdminPayload(spec, { baseKey: "buh", name: "ivanov", fullName: "Иванов И.", password: "s3cret" });
	assert.equal(ok.ok, true);
	assert.equal(ok.ok && ok.baseKey, "buh", "ключ базы достаётся для маршрутизации");
});

test("IB_INSTALL_EXTENSION: без содержимого файла команда не собирается", () => {
	const spec = findAdminCommand("IB_INSTALL_EXTENSION")!;
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", name: "bpapi" }).ok, false);
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", name: "bpapi", contentBase64: "AAEC" }).ok, true);
});

test("списки содержимого базы — чтение: подтверждения не требуют", () => {
	for (const t of ["IB_LIST_USERS", "IB_LIST_EXTENSIONS"]) {
		assert.equal(findAdminCommand(t)!.operation, "READ", t);
		assert.equal(findAdminCommand(t)!.requiresBase, true, t);
	}
});
