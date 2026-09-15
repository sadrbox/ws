// E15/A3, A6: белый список админ-команд, проверка payload и гейт по способностям агента.
//
// Смысл проверок: ошибка здесь означает либо админ-команду, ушедшую агенту без прав на
// кластер (и час разбирательств вместо внятного отказа), либо снятие сеанса не в той базе.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_COMMANDS, agentCanRun, buildAdminPayload, findAdminCommand, isAdminCommand } from "../src/commands/admin.ts";
import type { Db } from "../src/db/pool.ts";
import { BatchService } from "../src/onec/batches.ts";

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
		// Прерывание начатой команды: останавливает работу на сервере 1С (S4). Разрешено
		// только для чтений, но подтверждение всё равно нужно — это решение человека.
		"AGENT_CANCEL_COMMAND",
		// Снятие процесса агента останавливает работу на сервере 1С: конфигуратор без
		// force агент не тронет вовсе, но rac/ibcmd снимет — команда прервётся.
		"AGENT_KILL_PROCESS",
		// Удаление регистрации базы из кластера: данные не трогаются (их и нет), но
		// восстановить запись можно только вручную, со всеми параметрами подключения.
		// Опечатку в имени страхует сам агент — он проверяет через СУБД, что базы нет.
		"CLUSTER_DISCONNECT", "CLUSTER_DROP_INFOBASE", "CLUSTER_SET_SESSIONS_LOCK",
		"CLUSTER_TERMINATE_SESSION",
		// Внутрибазовые изменения так же необратимы: удалённого пользователя ИБ или
		// снесённое расширение не вернуть, а установка меняет конфигурацию базы.
		// Выгрузка данным не вредит, но стоит часов работы сервера и десятков гигабайт:
		// подтверждение здесь про цену, а не про риск.
		// Обновление конфигурации переписывает саму конфигурацию базы, загрузка .dt —
		// затирает её данные целиком. Дальше некуда.
		"IB_APPLY_UPDATE",
		"IB_BACKUP",
		"IB_CREATE_USER", "IB_DELETE_EXTENSION", "IB_DELETE_USER", "IB_INSTALL_EXTENSION",
		// Публикация меняет конфигурацию веб-сервера, а не базы, но так же необратима
		// для стороннего наблюдателя — подтверждение обязательно. Снятие публикации
		// критично не из-за данных, а из-за людей: доступ по HTTP пропадает немедленно.
		"IB_PUBLISH",
		// Загрузка .dt затирает данные базы целиком — дальше некуда.
		"IB_RESTORE",
		"IB_UNPUBLISH",
		// Изменение пользователя правит чужую базу — подтверждение обязательно.
		"IB_UPDATE_USER",
	]);
	// Остальное — чтение, кроме проверки базы: без `repair` она ничего не меняет, и
	// подтверждать её целиком нельзя — иначе привыкнут подтверждать не читая, а
	// подтверждение нужно именно на исправление.
	const rest = ADMIN_COMMANDS.filter((c) => c.operation !== "CRITICAL");
	assert.deepEqual(rest.filter((c) => c.operation === "WRITE").map((c) => c.type), [// Самопроверка агента (R4) создаёт и удаляет временного пользователя — это запись в базу,
		// но обратимая самим прогоном: подтверждение — в интерфейсе, как у проверки.
		"IB_SELFTEST", "IB_CHECK"]);
	assert.ok(rest.filter((c) => c.type !== "IB_CHECK" && c.type !== "IB_SELFTEST").every((c) => c.operation === "READ"));
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
	assert.equal(buildAdminPayload(spec, { sessionId: "8a1e8f3c-1d2b-4c5d-9e6f-0a1b2c3d4e5f" }).ok, true);
	assert.equal(buildAdminPayload(spec, {}).ok, false);
	// Ни одно поле мимо схемы не должно доехать до командной строки rac.
	assert.equal(buildAdminPayload(spec, { sessionId: "8a1e8f3c-1d2b-4c5d-9e6f-0a1b2c3d4e5f", extraArg: "--cluster-pwd=x" }).ok, false);
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

test("IB_UPDATE_USER: «выдать все роли» — штатная операция, а не «слишком много»", () => {
	const spec = findAdminCommand("IB_UPDATE_USER")!;
	/*
	 * ЖИВОЙ СЛУЧАЙ. В карточке отметили все доступные роли — команда не собралась:
	 * «addRoles: Too big: expected array to have <=100 items». Сотня ролей — это меньше,
	 * чем есть в типовой конфигурации: в «Бухгалтерии» их под две сотни, в «ERP» — за
	 * полторы тысячи. Предел нужен как защита от бессмысленно большого тела команды, а
	 * отметка «выбрать все» к таким не относится.
	 */
	const many = Array.from({ length: 500 }, (_, i) => `Роль${i}`);
	assert.equal(buildAdminPayload(spec, { baseKey: "b", name: "ivanov", addRoles: many }).ok, true);

	// Предел всё же есть, и отказ по нему читается человеком, а не разбирается по коду.
	const tooMany = Array.from({ length: 2001 }, (_, i) => `Роль${i}`);
	const denied = buildAdminPayload(spec, { baseKey: "b", name: "ivanov", addRoles: tooMany });
	assert.equal(denied.ok, false);
	assert.equal(denied.ok === false && denied.message.includes("добавляемые роли"), true, denied.ok === false ? denied.message : "");
	assert.equal(denied.ok === false && /слишком длинный список/.test(denied.message), true);
});

test("отказ по схеме объясняется словами: «не заполнено», а не кодом библиотеки", () => {
	const spec = findAdminCommand("IB_UPDATE_USER")!;
	const noName = buildAdminPayload(spec, { baseKey: "b", name: "" });
	assert.equal(noName.ok, false);
	// Поле названо по-человечески, и сказано, что с ним не так.
	assert.equal(noName.ok === false && noName.message.includes("имя пользователя"), true);
	assert.equal(noName.ok === false && !/expected|Too big|Invalid/i.test(noName.message), true, noName.ok === false ? noName.message : "");
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

test("долгим операциям над базой дан свой срок жизни, остальным — общий", () => {
	// Выгрузка базы на сотню гигабайт идёт дольше пятнадцати минут всегда. Общий срок
	// объявлял её просроченной посреди работы, и человек шёл чинить связь, пока база
	// выгружалась.
	const long = ADMIN_COMMANDS.filter((c) => c.ttlSeconds).map((c) => c.type).sort();
	assert.deepEqual(long, ["IB_APPLY_UPDATE", "IB_BACKUP", "IB_CHECK", "IB_RESTORE"]);
	assert.ok(ADMIN_COMMANDS.filter((c) => c.ttlSeconds).every((c) => (c.ttlSeconds ?? 0) >= 4 * 3600));
});

test("обслуживание базы понимает dryRun — план вместо действия", () => {
	// У каждой команды свои поля: лишнее схема отвергает (.strict), поэтому проверяем
	// ровно тот набор, который она принимает.
	const cases: [string, Record<string, unknown>][] = [
		["IB_CHECK", { baseKey: "buh", reindex: true, dryRun: true }],
		["IB_RESTORE", { baseKey: "buh", path: "D:/dump.dt", dryRun: true }],
		["IB_APPLY_UPDATE", { baseKey: "buh", path: "D:/update.cfu", dryRun: true }],
	];
	for (const [type, payload] of cases) {
		const built = buildAdminPayload(findAdminCommand(type)!, payload);
		assert.equal(built.ok, true, type);
	}
});

test("загрузка и обновление требуют путь к файлу", () => {
	for (const type of ["IB_RESTORE", "IB_APPLY_UPDATE"]) {
		const built = buildAdminPayload(findAdminCommand(type)!, { baseKey: "buh" });
		assert.equal(built.ok, false, type);
	}
});

// ── Задание без единой поставленной команды не должно выглядеть работающим ──
//
// ЖИВОЙ СЛУЧАЙ (12.09). Операцию запустили при остановленном агенте: задание завели на одну
// базу, команду поставить не смогли («нет агента на связи»), а `total` остался равен
// единице. Отчёт считал pending = total − done − failed и два часа показывал «В работе: 1» —
// задание без единой строки, без имени базы и без всякой работы.
//
// Теперь отсеянные базы хранятся в самом задании и приходят строками «не поставлена»:
// pending становится нулём, а человек видит базу и причину.

test("отсеянные базы приходят строками и обнуляют «в работе»", async () => {
	const batchId = "b1";
	const db = {
		query: async (sql: string) => {
			if (sql.includes("FROM command_batches WHERE id = ANY")) {
				return {
					rows: [{
						id: batchId, type: "IB_UPDATE_USER", total: 1,
						created_at: new Date(),
						payload: { skipped: [{ baseKey: "akacapital", reason: "нет агента на связи" }] },
					}],
					rowCount: 1,
				};
			}
			// Команд у задания нет вовсе: их не ставили.
			return { rows: [], rowCount: 0 };
		},
		connect: async () => { throw new Error("не нужен"); },
	} as unknown as Db;

	const [report] = await new BatchService(db).reports([batchId]);
	assert.equal(report.pending, 0, "работы нет — и «в работе» быть не должно");
	assert.equal(report.failed, 1);
	assert.equal(report.items.length, 1);
	assert.equal(report.items[0].state, "skipped");
	assert.equal(report.items[0].baseKey, "akacapital");
	assert.equal(report.items[0].commandId, null);
	assert.equal(report.items[0].error?.code, "NOT_QUEUED");
	assert.match(report.items[0].error?.message ?? "", /нет агента/);
});

test("С27: идентификатор сеанса — UUID", () => {
	const spec = findAdminCommand("CLUSTER_TERMINATE_SESSION")!;
	assert.equal(buildAdminPayload(spec, { sessionId: "12" }).ok, false);
	assert.equal(buildAdminPayload(spec, { sessionId: "8A1E8F3C-1D2B-4C5D-9E6F-0A1B2C3D4E5F" }).ok, true);
});

test("П19: пустое имя и полное имя пользователя не принимаются", () => {
	const update = findAdminCommand("IB_UPDATE_USER")!;
	const create = findAdminCommand("IB_CREATE_USER")!;
	assert.equal(buildAdminPayload(update, { baseKey: "b", name: "Оператор", fullName: "" }).ok, false);
	assert.equal(buildAdminPayload(update, { baseKey: "b", name: "Оператор", fullName: "   " }).ok, false);
	assert.equal(buildAdminPayload(update, { baseKey: "b", name: "   " }).ok, false);
	assert.equal(buildAdminPayload(update, { baseKey: "b", name: "Оператор", newName: " " }).ok, false);
	assert.equal(buildAdminPayload(create, { baseKey: "b", name: "Оператор", fullName: "" }).ok, false);
	assert.equal(buildAdminPayload(update, { baseKey: "b", name: "Оператор", fullName: "Оператор бухгалтер" }).ok, true);
});
