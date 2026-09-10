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
		// Снятие процесса агента останавливает работу на сервере 1С: конфигуратор без
		// force агент не тронет вовсе, но rac/ibcmd снимет — команда прервётся.
		"AGENT_KILL_PROCESS",
		"CLUSTER_DISCONNECT", "CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_TERMINATE_SESSION",
		// Внутрибазовые изменения так же необратимы: удалённого пользователя ИБ или
		// снесённое расширение не вернуть, а установка меняет конфигурацию базы.
		// Выгрузка данным не вредит, но стоит часов работы сервера и десятков гигабайт:
		// подтверждение здесь про цену, а не про риск.
		"IB_BACKUP",
		"IB_CREATE_USER", "IB_DELETE_EXTENSION", "IB_DELETE_USER", "IB_INSTALL_EXTENSION",
		// Публикация меняет конфигурацию веб-сервера, а не базы, но так же необратима
		// для стороннего наблюдателя — подтверждение обязательно. Снятие публикации
		// критично не из-за данных, а из-за людей: доступ по HTTP пропадает немедленно.
		"IB_PUBLISH", "IB_UNPUBLISH",
		// Изменение пользователя правит чужую базу — подтверждение обязательно.
		"IB_UPDATE_USER",
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

test("IB_UPDATE_USER: незаполненное поле значит «не трогать», а не «очистить»", () => {
	const spec = findAdminCommand("IB_UPDATE_USER")!;
	// Меняем только полное имя — пароль и роли не упоминаются и остаются как были.
	const only = buildAdminPayload(spec, { baseKey: "b", name: "ivanov", fullName: "Иванов И.И." });
	assert.equal(only.ok, true);
	assert.deepEqual(only.ok && only.payload, { baseKey: "b", name: "ivanov", fullName: "Иванов И.И." });
	// Имя обязательно: без него непонятно, кого менять.
	assert.equal(buildAdminPayload(spec, { baseKey: "b", fullName: "Х" }).ok, false);
	// Переименование — отдельным полем, чтобы `name` оставался адресом записи.
	assert.equal(buildAdminPayload(spec, { baseKey: "b", name: "ivanov", newName: "ivanov2" }).ok, true);
	// Относительная правка ролей: «добавить одному, снять другое» — не то же самое, что
	// прислать готовый набор. У баз с разными наборами полный список их бы выровнял.
	const rel = buildAdminPayload(spec, {
		baseKey: "b", name: "ivanov", addRoles: ["ЧтениеЭСФ"], removeRoles: ["ПолныеПрава"],
	});
	assert.equal(rel.ok, true);
	assert.deepEqual(rel.ok && rel.payload, {
		baseKey: "b", name: "ivanov", addRoles: ["ЧтениеЭСФ"], removeRoles: ["ПолныеПрава"],
	});
	assert.equal(buildAdminPayload(spec, { baseKey: "b", name: "ivanov", nickname: "x" }).ok, false);
});

test("IB_BACKUP: нужна база, каталог необязателен — раскладку дисков знает агент", () => {
	const spec = findAdminCommand("IB_BACKUP")!;
	assert.equal(buildAdminPayload(spec, { baseKey: "buh_alma" }).ok, true);
	assert.equal(buildAdminPayload(spec, { baseKey: "buh_alma", dir: "D:\\dt" }).ok, true);
	assert.equal(buildAdminPayload(spec, {}).ok, false);
	// Лишнее поле не проходит: путь к файлу назначает агент, а не панель.
	assert.equal(buildAdminPayload(spec, { baseKey: "b", path: "D:\\x.dt" }).ok, false);
});

test("CLUSTER_LIST_PUBLICATIONS: чтение по всему веб-серверу, базу не адресует", () => {
	const spec = findAdminCommand("CLUSTER_LIST_PUBLICATIONS")!;
	assert.equal(spec.operation, "READ");
	assert.equal(spec.requiresBase, false);
	assert.equal(buildAdminPayload(spec, {}).ok, true);
	// Публикации читаются с веб-сервера — это работа кластерного администратора.
	assert.equal(spec.capability, "cluster.admin");
});

test("IB_UNPUBLISH: обязателен только baseKey, публикация снимается по имени базы", () => {
	const spec = findAdminCommand("IB_UNPUBLISH")!;
	assert.equal(buildAdminPayload(spec, { baseKey: "buh_alma" }).ok, true);
	assert.equal(buildAdminPayload(spec, {}).ok, false);
	// Публикация — операция внутрибазового агента: способность та же, что у установки.
	assert.equal(spec.capability, "ib.admin");
});

test("IB_PUBLISH: обязателен только baseKey, остальное — умолчания агента", () => {
	const spec = findAdminCommand("IB_PUBLISH")!;
	assert.equal(spec.capability, "ib.admin");
	assert.equal(buildAdminPayload(spec, {}).ok, false, "без baseKey");
	assert.equal(buildAdminPayload(spec, { baseKey: "buh" }).ok, true, "alias/dir/webServer необязательны");
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", webServer: "nginx" }).ok, false, "только iis|apache24");
	assert.equal(buildAdminPayload(spec, { baseKey: "buh", webServer: "iis", alias: "b", dir: "C:/x" }).ok, true);
});

test("новые кластерные команды: чтение — без базы, разрыв — по UUID соединения", () => {
	for (const t of ["CLUSTER_LIST_PROCESSES", "CLUSTER_LIST_LICENSES"]) {
		const spec = findAdminCommand(t)!;
		assert.equal(spec.operation, "READ", t);
		assert.equal(spec.requiresBase, false, t);
		assert.equal(buildAdminPayload(spec, {}).ok, true, t);
	}
	// Блокировки можно спросить и по одной базе.
	const locks = findAdminCommand("CLUSTER_LIST_LOCKS")!;
	assert.equal(buildAdminPayload(locks, { baseKey: "buh" }).ok, true);

	const dis = findAdminCommand("CLUSTER_DISCONNECT")!;
	assert.equal(dis.operation, "CRITICAL", "разрыв соединения необратим");
	assert.equal(buildAdminPayload(dis, {}).ok, false, "без connectionId");
	assert.equal(buildAdminPayload(dis, { connectionId: "abc" }).ok, true);
});

test("гейт: агент старее сервиса не получает неизвестную ему команду", () => {
	const locks = findAdminCommand("CLUSTER_LIST_LOCKS")!;
	// Агент перечисляет конкретные типы — значит перечень закрытый, и новой команды в нём нет.
	const old = { role: "admin" as const, capabilities: ["CLUSTER_LIST_SESSIONS", "cluster.admin"] };
	assert.equal(agentCanRun(old, locks), false);
	assert.equal(agentCanRun({ ...old, capabilities: [...old.capabilities, "CLUSTER_LIST_LOCKS"] }, locks), true);

	// Агент без перечня типов (только способности) — проверяем лишь способность:
	// иначе старые сборки перестали бы работать вовсе.
	assert.equal(agentCanRun({ role: "admin", capabilities: ["cluster.admin"] }, locks), true);
});
