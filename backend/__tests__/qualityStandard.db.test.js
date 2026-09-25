// Интеграционный тест E17 «Стандарт качества» против живого Postgres (CI: buhprof_test).
//
// ЗАЩИТА ОТ РАБОЧЕЙ БАЗЫ. Тест меняет глобальную настройку `quality.firmOrganizationUuid` и
// заводит организации, пользователей, задачи. Поэтому он идёт ТОЛЬКО на базе, в имени которой
// есть «test» (CI — buhprof_test, одноразовые копии), и пропускается на любой другой — в том
// числе на рабочей, адрес которой лежит в backend/.env. В конце убирает за собой всё созданное
// и возвращает прежнее значение настройки.
//
// Сценарии — сквозные: SLA и результат задач, возврат и напоминания (пп. 1, 2), ошибки (пп. 4–6),
// передача и «Нужна помощь», реестр нарушений и бонус, проверки учёта 1С (приём, сводная задача,
// обрезанный прогон, исключение), чек-листы (пп. 27, 28), сверка с КН, посещаемость, фоновые
// правила, канал 1С.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const dbName = (() => {
	try { return new URL(process.env.DATABASE_URL || "").pathname.replace(/^\//, ""); } catch { return ""; }
})();
const RUN = /test/i.test(dbName);

let prisma, server, base, call, ok, users, firm, client, client2, prevFirm, prevAnnounce;
const ANNOUNCE_KEY = "quality.announce.tasks-2026-09-25";
const rnd = () => String(Math.floor(1e11 + Math.random() * 8.9e11));

before(async () => {
	if (!RUN) return;
	({ prisma } = await import("../prisma/prisma-client.js"));
	const { FIRM_KEY, setFirmOrgSetting, saveQualitySettings, _resetSettingsCache } = await import("../services/quality/settings.js");
	prevFirm = (await prisma.appSetting.findUnique({ where: { key: FIRM_KEY } }))?.value ?? null;
	prevAnnounce = await prisma.appSetting.findUnique({ where: { key: ANNOUNCE_KEY } });
	firm = await prisma.organization.create({ data: { bin: rnd(), name: "БухПроф (тест E17)", kind: "service" } });
	client = await prisma.organization.create({ data: { bin: rnd(), name: "ТОО Клиент (тест E17)" } });
	client2 = await prisma.organization.create({ data: { bin: rnd(), name: "ТОО Клиент без ответственного (тест E17)" } });
	const mk = (u) => prisma.user.create({ data: { username: `e17_${u}_${Date.now()}` } });
	const [owner, manager, chief, acc, acc2] = await Promise.all(["owner", "manager", "chief", "acc", "acc2"].map(mk));
	users = { owner, manager, chief, acc, acc2 };
	for (const u of Object.values(users)) {
		await prisma.accessRight.create({ data: { userUuid: u.uuid, organizationUuid: firm.uuid, role: u === owner ? "admin" : "member" } });
		await prisma.accessRight.create({ data: { userUuid: u.uuid, organizationUuid: client.uuid, role: "member" } });
	}
	// До назначения фирмы правила молчат (сбрасываем настройку — база могла остаться от прошлых прогонов).
	await setFirmOrgSetting(null);
	_resetSettingsCache();
	const { createCandidate } = await import("../services/quality/violations.js");
	assert.equal(await createCandidate({ userUuid: acc.uuid, itemNumber: 20, rule: "t", ruleKey: `pre-firm-${Date.now()}`, description: "x" }), null);
	await setFirmOrgSetting(firm.uuid);
	await saveQualitySettings(firm.uuid, { effectiveFrom: "2026-01-01" });
	_resetSettingsCache();

	const routers = await Promise.all(["todos", "quality", "standardViolations", "staffGroups", "checklists", "attendance", "accountingChecks", "scheduledtasks", "reports"].map((n) => import(`../api/router/${n}.js`)));
	const bpaiRouter = (await import("../api/router/bpai.js")).default;
	const app = express();
	app.use(express.json({ limit: "25mb" }));
	app.use("/bpai", bpaiRouter);
	app.use("/api/v1", (req, _res, next) => {
		const u = users[req.headers["x-as"] || "acc"];
		req.user = { uuid: u.uuid, username: u.username, isSuperAdmin: false, organizationUuid: client.uuid, allowedOrgUuids: [firm.uuid, client.uuid], isOrgAdmin: false, isAnyOrgAdmin: u === owner };
		next();
	});
	for (const r of routers) app.use("/api/v1", r.default);
	server = app.listen(0);
	base = `http://127.0.0.1:${server.address().port}`;
	call = async (method, path, body, as = "acc") => {
		const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "X-As": as }, body: body ? JSON.stringify(body) : undefined });
		const json = await res.json().catch(() => ({}));
		return { status: res.status, ...json };
	};
	ok = (r, what) => { assert.ok(r.status < 300 && r.success !== false, `${what}: ${r.status} ${r.message ?? ""}`); return r; };
});

after(async () => {
	if (!RUN) return;
	server?.close();
	try {
		const orgs = [firm.uuid, client.uuid, client2.uuid];
		const uids = Object.values(users).map((u) => u.uuid);
		const todos = await prisma.todo.findMany({ where: { organizationUuid: { in: orgs } }, select: { uuid: true } });
		const tu = todos.map((t) => t.uuid);
		await prisma.todoEvent.deleteMany({ where: { todoUuid: { in: tu } } });
		await prisma.todoWatcher.deleteMany({ where: { todoUuid: { in: tu } } });
		await prisma.todo.deleteMany({ where: { uuid: { in: tu } } });
		await prisma.scheduledTask.deleteMany({ where: { authorUuid: { in: uids } } });
		for (const m of ["standardViolation", "violationMeasure", "bonusMonth", "standardItem", "staffGroup", "errorType", "checklistTemplate", "checklistRun", "workSchedule", "workDayMark", "absenceRequest", "checkRun", "checkFinding", "accountingSnapshot", "knStatement", "primaryDocsReceipt"]) {
			await prisma[m].deleteMany({ where: { organizationUuid: { in: orgs } } });
		}
		await prisma.checklistRun.deleteMany({ where: { clientOrganizationUuid: { in: orgs } } });
		// Авторы из канала 1С, заведённые тестом по имени.
		const extra = await prisma.user.findMany({ where: { username: { in: ["Директор клиента", "Бухгалтер клиента E17"] } }, select: { uuid: true } });
		uids.push(...extra.map((u) => u.uuid));
		await prisma.userNotification.deleteMany({ where: { userUuid: { in: uids } } });
		await prisma.accessRight.deleteMany({ where: { userUuid: { in: uids } } });
		await prisma.user.deleteMany({ where: { uuid: { in: uids } } });
		await prisma.appSetting.deleteMany({ where: { key: `quality.settings.${firm.uuid}` } });
		await prisma.todoStatus.deleteMany({ where: { code: { startsWith: "e17_declined_" } } });
		if (prevAnnounce) await prisma.appSetting.update({ where: { key: ANNOUNCE_KEY }, data: { value: prevAnnounce.value } });
		else await prisma.appSetting.deleteMany({ where: { key: ANNOUNCE_KEY } });
		await prisma.appSetting.upsert({ where: { key: "quality.firmOrganizationUuid" }, create: { key: "quality.firmOrganizationUuid", value: prevFirm }, update: { value: prevFirm } });
		await prisma.organization.deleteMany({ where: { uuid: { in: orgs } } });
	} finally {
		await prisma.$disconnect();
	}
});

test("E17: сквозные сценарии стандарта качества", { skip: RUN ? false : `база «${dbName}» не тестовая — пропуск` }, async () => {
	const { manager, chief, acc, acc2 } = users;
	const jobs = await import("../services/quality/jobs.js");
	const log = () => {};
	// 1. Контекст и группа
	let r = ok(await call("GET", "/api/v1/quality/me", null, "owner"), "me owner");
	assert.equal(r.data.firmOrganizationUuid, firm.uuid);
	assert.equal(r.data.isAdmin, true);
	r = ok(await call("POST", "/api/v1/staff-groups", { name: "Группа 1", headUuid: chief.uuid, managerUuid: manager.uuid, members: [acc.uuid, acc2.uuid], clients: [{ clientOrganizationUuid: client.uuid, responsibleUuid: acc.uuid }] }, "owner"), "group create");
	assert.equal(r.item.membersCount, 2);
	assert.equal((await call("POST", "/api/v1/staff-groups", { name: "X" }, "acc")).status, 403);
	r = ok(await call("GET", "/api/v1/quality/me", null, "chief"), "me chief");
	assert.equal(r.data.isHead, true);
	r = ok(await call("GET", "/api/v1/standard-items", null, "acc"), "items");
	assert.equal(r.items.length, 40);
	log("контекст, группа, справочник 40 пунктов");

	// 2. Обращение клиента: SLA, закрытие без результата — отказ
	r = ok(await call("POST", "/api/v1/todos", { name: "Сдать 910", organizationUuid: client.uuid, executorUuid: acc.uuid, curatorUuid: chief.uuid, kind: "client_request", priority: "urgent" }), "todo create");
	const t1 = r.item;
	assert.ok(t1.reactionDueAt && t1.deadline, "SLA проставлен");
	assert.equal((await call("PUT", `/api/v1/todos/${t1.uuid}`, { status: "done" })).status, 400);
	assert.equal((await call("PUT", `/api/v1/todos/${t1.uuid}`, { status: "done", result: "Передала." })).status, 400);
	assert.equal((await call("PUT", `/api/v1/todos/${t1.uuid}`, { status: "waiting_client" })).status, 400);
	ok(await call("PUT", `/api/v1/todos/${t1.uuid}`, { status: "waiting_client", nextControlAt: new Date(Date.now() + 86_400_000).toISOString() }), "waiting");
	r = ok(await call("PUT", `/api/v1/todos/${t1.uuid}`, { status: "done", result: "Декларация 910 сдана, талон приложен во вкладке «Файлы»" }), "done");
	assert.ok(r.item.completedAt && r.item.acceptedAt && r.item.startedAt);
	// Переквалификация: обычная задача → обращение клиента получает срок реакции, а срок,
	// поставленный человеком, SLA не перебивает.
	r = ok(await call("POST", "/api/v1/todos", { name: "Звонок клиента", organizationUuid: client.uuid, executorUuid: acc.uuid }), "plain task");
	assert.equal(r.item.reactionDueAt, null);
	r = ok(await call("PUT", `/api/v1/todos/${r.item.uuid}`, { kind: "client_request", deadline: "2026-12-31T00:00:00.000Z" }), "to client_request");
	assert.ok(r.item.reactionDueAt, "срок реакции поставлен");
	assert.equal(new Date(r.item.deadline).toISOString(), "2026-12-31T00:00:00.000Z");
	log("SLA, результат обязателен, ожидание с датой, отметки времени");

	// 3. Возврат «не выполнено» → кандидат п.1; напоминания → п.2
	ok(await call("POST", `/api/v1/todos/${t1.uuid}/return`, { reason: "Талона нет, декларация не принята" }, "chief"), "return");
	let v = await prisma.standardViolation.findUnique({ where: { ruleKey: `returned:${t1.uuid}` } });
	assert.equal(v?.itemNumber, 1);
	ok(await call("POST", `/api/v1/todos/${t1.uuid}/remind`, { note: "звонил" }, "chief"), "remind1");
	ok(await call("POST", `/api/v1/todos/${t1.uuid}/remind`, { note: "опять звонил" }, "chief"), "remind2");
	v = await prisma.standardViolation.findUnique({ where: { ruleKey: `client_reminder:${t1.uuid}` } });
	assert.equal(v?.itemNumber, 2);
	r = ok(await call("GET", `/api/v1/todos/${t1.uuid}/history`), "history");
	assert.ok(r.events.some((e) => e.type === "returned") && r.events.filter((e) => e.type === "reminder").length === 2);
	log("возврат → п.1, повторное напоминание → п.2, история событий");

	// 4. Ошибка от клиента → п.4; исправление → задача-проверка; повтор типа → п.6
	const et = ok(await call("POST", "/api/v1/error-types", { name: "Не тот счёт учёта" }, "chief"), "error type").item;
	r = ok(await call("POST", "/api/v1/todos", { name: "Поступление на 7210 вместо 1330", organizationUuid: client.uuid, executorUuid: acc.uuid, curatorUuid: chief.uuid, kind: "error", reportedBy: "client", errorTypeUuid: et.uuid }, "chief"), "error todo");
	const e1 = r.item;
	assert.equal((await prisma.standardViolation.findUnique({ where: { ruleKey: `client_error:${e1.uuid}` } }))?.itemNumber, 4);
	ok(await call("PUT", `/api/v1/todos/${e1.uuid}`, { status: "done", result: "Поступление перепроведено на 1330, остатки сверены" }), "error fixed");
	const control = await prisma.todo.findFirst({ where: { parentTodoUuid: e1.uuid, kind: "control" } });
	assert.equal(control?.executorUuid, chief.uuid);
	r = ok(await call("POST", "/api/v1/todos", { name: "Снова 7210", organizationUuid: client.uuid, executorUuid: acc.uuid, kind: "error", reportedBy: "chief", errorTypeUuid: et.uuid }, "chief"), "error repeat");
	assert.equal((await prisma.standardViolation.findUnique({ where: { ruleKey: `repeat_error:${r.item.uuid}` } }))?.itemNumber, 6);
	log("ошибка клиента → п.4, задача-проверка главбуху, повтор типа → п.6");

	// 5. Передача задачи → наблюдатель; «Нужна помощь» → уведомление главбуху
	r = ok(await call("POST", "/api/v1/todos", { name: "Сверка с поставщиком", organizationUuid: client.uuid, executorUuid: acc.uuid }, "acc"), "t2");
	const t2 = r.item;
	ok(await call("PUT", `/api/v1/todos/${t2.uuid}`, { executorUuid: acc2.uuid, transferReason: "отпуск" }), "transfer");
	assert.ok(await prisma.todoWatcher.findUnique({ where: { todoUuid_userUuid: { todoUuid: t2.uuid, userUuid: acc.uuid } } }));
	r = ok(await call("POST", `/api/v1/todos/${t2.uuid}/help`, { note: "не понимаю, как отразить" }, "acc2"), "help");
	assert.equal(r.notified, 1);
	assert.ok(await prisma.userNotification.findFirst({ where: { userUuid: chief.uuid, kind: "help" } }));
	ok(await call("DELETE", `/api/v1/todos/${t2.uuid}`), "soft delete");
	assert.ok((await prisma.todo.findUnique({ where: { uuid: t2.uuid } })).deletedAt);
	assert.equal((await call("GET", `/api/v1/todos/${t2.uuid}`)).status, 404);
	log("передача → наблюдатель, помощь → главбух, мягкое удаление");

	// 6. Реестр: подтверждение, возражение, решение уровнем выше, бонус, закрытие месяца
	const cand = await prisma.standardViolation.findUnique({ where: { ruleKey: `returned:${t1.uuid}` } });
	assert.equal((await call("POST", `/api/v1/standard-violations/${cand.uuid}/confirm`, {}, "acc")).status, 403, "своё видит, но не решает");
	ok(await call("POST", `/api/v1/standard-violations/${cand.uuid}/confirm`, { note: "факт" }, "chief"), "confirm");
	ok(await call("POST", `/api/v1/standard-violations/${cand.uuid}/dispute`, { text: "Талон был, клиент не посмотрел" }, "acc"), "dispute");
	assert.equal((await call("POST", `/api/v1/standard-violations/${cand.uuid}/resolve-dispute`, { decision: "confirmed", note: "проверено" }, "chief")).status, 403);
	ok(await call("POST", `/api/v1/standard-violations/${cand.uuid}/resolve-dispute`, { decision: "confirmed", note: "проверено, талона не было" }, "manager"), "resolve");
	assert.equal((await call("POST", "/api/v1/standard-violations", { userUuid: acc.uuid, itemNumber: 23, description: "коротко" }, "chief")).status, 400);
	ok(await call("POST", "/api/v1/standard-violations", { userUuid: acc2.uuid, itemNumber: 23, occurredAt: new Date().toISOString().slice(0, 10), area: "Банк", description: "Запросил выписку у клиента, не проверив, что она уже загружена" }, "chief"), "manual");
	assert.equal((await call("POST", "/api/v1/standard-violations", { userUuid: chief.uuid, itemNumber: 29, occurredAt: "2026-09-01", area: "Группа", description: "Не видел состояние сверок группы" }, "chief")).status, 403);
	r = ok(await call("GET", "/api/v1/standard-violations?mine=1", null, "acc"), "mine");
	assert.ok(r.items.length >= 1 && r.items.every((x) => x.userUuid === acc.uuid));
	r = ok(await call("GET", "/api/v1/quality/bonus", null, "manager"), "bonus");
	const accRow = r.data.items.find((x) => x.userUuid === acc.uuid);
	assert.equal(accRow.bonus, false);
	assert.ok(r.data.items.find((x) => x.userUuid === chief.uuid)?.bonus);
	const month = r.data.month;
	r = await call("POST", "/api/v1/quality/bonus/close", { month }, "manager");
	assert.equal(r.status, 409); // есть нерешённые кандидаты
	ok(await call("POST", "/api/v1/quality/bonus/close", { month, force: true }, "manager"), "close");
	assert.equal((await call("POST", `/api/v1/standard-violations/${(await prisma.standardViolation.findFirst({ where: { status: "candidate", organizationUuid: firm.uuid } })).uuid}/confirm`, {}, "chief")).status, 409);
	ok(await call("POST", "/api/v1/quality/bonus/reopen", { month }, "owner"), "reopen");
	log("реестр: подтверждение, возражение уровнем выше, ручная запись с фактом, бонус, закрытие месяца");

	// 7. Проверки учёта: приём итогов, сводная задача, исключение, устранение
	const findings = [
		{ fingerprint: `stock.negative:${client.uuid}:1330:p1:w1:negative`, severity: "error", title: "Минус: Бумага А4", amount: -12000, date: "2026-09-20" },
		{ fingerprint: `stock.negative:${client.uuid}:1330:p2:w1:negative`, severity: "error", title: "Минус: Скрепки", amount: -500 },
	];
	const body = (fs, truncated = false) => ({ bin: client.bin, baseKey: "Dev_01", runs: [{ check: "stock.negative", scope: "organization", request: { onDate: "2026-09-25" }, ok: true, data: { check: "stock.negative", version: 1, status: fs.length ? "findings" : "ok", total: fs.length, truncated, findings: fs } }], snapshots: [{ snapshot: "taxes", ok: true, data: { rows: [{ account: "3110", tax: { name: "КПН", kbk: "101101" }, closingDebit: 0, closingCredit: 5000 }] } }] });
	assert.equal((await call("POST", "/bpai/checks/results", { ...body(findings), bin: "990000000999" })).status, 404);
	r = ok(await call("POST", "/bpai/checks/results", body(findings)), "ingest");
	assert.equal(r.data.findingsNew, 2);
	assert.equal(r.data.tasksOpened, 1);
	const task = await prisma.todo.findFirst({ where: { kind: "check_finding", checkCode: "stock.negative", organizationUuid: client.uuid } });
	assert.equal(task.executorUuid, acc.uuid);
	// обрезанный прогон без одной находки — ничего не закрывает
	r = ok(await call("POST", "/bpai/checks/results", body([findings[0]], true)), "truncated");
	assert.equal(r.data.findingsResolved, 0);
	r = ok(await call("GET", `/api/v1/check-findings?organizationUuid=${client.uuid}`, null, "chief"), "findings list");
	assert.equal(r.items.length, 2);
	const f2 = r.items.find((x) => x.title.includes("Скрепки"));
	ok(await call("POST", `/api/v1/check-findings/${f2.uuid}/exception`, { reason: "Остаток спишут актом в октябре, согласовано с клиентом" }, "chief"), "exception");
	r = ok(await call("GET", `/api/v1/check-findings?organizationUuid=${client.uuid}`, null, "chief"), "findings open");
	assert.equal(r.items.length, 1);
	r = ok(await call("POST", "/bpai/checks/results", body([])), "clean run");
	assert.equal(r.data.tasksClosed, 1);
	assert.ok((await prisma.todo.findUnique({ where: { uuid: task.uuid } })).completedAt);
	log("проверки: приём, сводная задача ответственному, обрезанный прогон не закрывает, исключение, закрытие прогоном");

	// 8. Чек-лист: «ок» при открытой ошибке — отказ; п.27 после подтверждения
	const tpl = ok(await call("POST", "/api/v1/checklist-templates", { name: "Закрытие месяца", items: [{ text: "Нет отрицательных остатков", checkCode: "stock.negative" }, { text: "Банк разнесён" }] }, "chief"), "template").item;
	ok(await call("POST", "/bpai/checks/results", body([findings[0]])), "finding again");
	const run = ok(await call("POST", "/api/v1/checklist-runs", { templateUuid: tpl.uuid, clientOrganizationUuid: client.uuid, periodFrom: "2026-09-01", periodTo: "2026-09-30" }, "acc"), "run").item;
	assert.equal(run.executorUuid, acc.uuid);
	assert.equal(run.reviewerUuid, chief.uuid);
	const stockItem = run.items.find((i) => i.checkCode);
	assert.equal((await call("POST", `/api/v1/checklist-runs/${run.uuid}/items/${stockItem.uuid}`, { status: "ok" }, "acc")).status, 400);
	ok(await call("POST", "/bpai/checks/results", body([])), "clean again");
	ok(await call("POST", `/api/v1/checklist-runs/${run.uuid}/items/${stockItem.uuid}`, { status: "ok" }, "acc"), "mark ok");
	ok(await call("POST", `/api/v1/checklist-runs/${run.uuid}/items/${run.items.find((i) => !i.checkCode).uuid}`, { status: "ok" }, "acc"), "mark ok 2");
	ok(await call("POST", `/api/v1/checklist-runs/${run.uuid}/submit`, {}, "acc"), "submit");
	ok(await call("POST", `/api/v1/checklist-runs/${run.uuid}/review`, {}, "chief"), "review");
	// Предупреждение (нужен анализ, а не нарушение) отметку «ок» не опровергает — как и не запрещает её.
	ok(await call("POST", "/bpai/checks/results", body([{ fingerprint: `stock.negative:${client.uuid}:1330:p8:w1:quantity_without_amount`, severity: "warning", title: "Количество без суммы: Картридж", date: "2026-09-14" }])), "warning after ok");
	assert.equal(await prisma.standardViolation.findUnique({ where: { ruleKey: `selfcheck:${stockItem.uuid}` } }), null);
	ok(await call("POST", "/bpai/checks/results", body([{ fingerprint: `stock.negative:${client.uuid}:1330:p9:w1:negative`, severity: "error", title: "Минус: Тонер", date: "2026-09-15" }])), "new finding after ok");
	assert.equal((await prisma.standardViolation.findUnique({ where: { ruleKey: `selfcheck:${stockItem.uuid}` } }))?.itemNumber, 27);
	assert.equal((await prisma.standardViolation.findUnique({ where: { ruleKey: `chiefcontrol:${stockItem.uuid}` } }))?.itemNumber, 28);
	log("чек-лист: «ок» заблокирован при ошибке, новое предупреждение — не кандидат, после подписи новая ошибка → пп. 27 и 28");

	// 9. Сверка КН
	r = ok(await call("POST", "/api/v1/kn-statements", { organizationUuid: client.uuid, onDate: "2026-09-25", rows: [{ kbk: "101101", name: "КПН", balance: "-5000" }, { kbk: "101201", name: "ИПН", balance: "100" }] }, "acc"), "kn");
	assert.equal(r.item.comparison.mismatches, 1);
	log("КН: сравнение со снимком taxes — одно расхождение из двух");

	// 10. Посещаемость
	ok(await call("POST", "/api/v1/work-schedules", { userUuid: acc.uuid, startTime: "00:00", endTime: "00:01", workDays: "1,2,3,4,5,6,7", graceMinutes: 0 }, "chief"), "schedule");
	r = ok(await call("GET", "/api/v1/attendance/me", null, "acc"), "me day");
	assert.ok(r.data.schedule);
	ok(await call("POST", "/api/v1/absence-requests", { kind: "late", dateFrom: r.data.today, reason: "Врач, талон на 9:00" }, "acc"), "absence req");
	ok(await call("POST", "/api/v1/attendance/mark", {}, "acc"), "mark");
	r = ok(await call("GET", "/api/v1/attendance/journal", null, "chief"), "journal");
	assert.equal(r.data.items.length, 1);
	log("посещаемость: график, заявка, отметка, журнал главбуха");

	// 11. Периодические правила и панели
	await prisma.todo.update({ where: { uuid: control.uuid }, data: { deadline: new Date(Date.now() - 3 * 86_400_000) } });
	const slaOut = await jobs.runSlaJob();
	assert.ok((await prisma.standardViolation.findUnique({ where: { ruleKey: `overdue:${control.uuid}` } }))?.itemNumber === 5, `sla: ${slaOut}`);
	await prisma.checkFinding.updateMany({ where: { organizationUuid: client.uuid, resolvedAt: null }, data: { firstSeenAt: new Date(Date.now() - 10 * 86_400_000) } });
	await jobs.runFindingCandidates();
	assert.ok(await prisma.standardViolation.findFirst({ where: { source: "rule:finding_overdue", organizationUuid: firm.uuid } }));
	const st = ok(await call("POST", "/api/v1/scheduled-tasks", { name: "Сверка банка", cronExpr: "* * * * *", staffGroupUuid: (await prisma.staffGroup.findFirst({ where: { organizationUuid: firm.uuid } })).uuid, deadlineDays: 2 }, "owner"), "schedule task").item;
	assert.equal((await call("POST", "/api/v1/scheduled-tasks", { name: "x", cronExpr: "61 * * * *" }, "owner")).status, 400);
	await jobs.runScheduledTasks(); // первый проход — только ближайший запуск
	// Четыре процесса кластера разом: запуск захватывает ровно один (условное обновление nextRunAt).
	const due = new Date(Date.now() + 120_000);
	await Promise.all([1, 2, 3, 4].map(() => jobs.runScheduledTasks(due)));
	assert.equal(await prisma.todo.count({ where: { kind: "regulation", sourceUuid: st.uuid, executorUuid: acc.uuid } }), 1);
	r = ok(await call("GET", "/api/v1/quality/dashboard/chief", null, "chief"), "chief dash");
	assert.equal(r.data.clients.length, 1);
	assert.ok(r.data.clients[0].areas.stock);
	r = ok(await call("GET", "/api/v1/quality/dashboard/manager", null, "manager"), "manager dash");
	assert.equal(r.data.groups.length, 1);
	r = ok(await call("GET", "/api/v1/reports/user-performance", null, "owner"), "perf");
	log("правила: просрочка проверки → п.5, находка → кандидат, регламентная задача; панели; отчёт");

	// 12. Канал 1С: закрытие без результата — отказ; напоминание дважды → п.2
	r = await call("POST", "/bpai/tasks", { bin: client.bin, user: { name: "Директор клиента" }, name: "Пришлите справку", kind: "client_request" });
	assert.equal(r.status, 201);
	assert.equal(r.item.kind, "client_request");
	assert.equal((await call("PATCH", `/bpai/tasks/${r.item.uuid}`, { bin: client.bin, user: { name: "Директор клиента" }, close: true })).status, 400);
	ok(await call("PATCH", `/bpai/tasks/${r.item.uuid}`, { bin: client.bin, user: { name: "Директор клиента" }, close: true, result: "Справка о задолженности отправлена клиенту на почту" }), "close with result");
	ok(await call("POST", `/bpai/tasks/${r.item.uuid}/rate`, { bin: client.bin, user: { name: "Директор клиента" }, rating: 2, comment: "долго" }), "rate");
	log("канал 1С: вид обращения, результат при закрытии, оценка");

	// 13. Решения 25.09 («лучшие решения»).
	const { _resetStatusCache } = await import("../services/quality/todos.js");
	// 13.1 Вид задачи из чата 1С — по роли автора: клиент → обращение всегда; сотрудник → задача,
	// а обращение — только если модель отметила, что записывает просьбу клиента.
	r = await call("POST", "/bpai/tasks", { bin: client.bin, user: { name: "Бухгалтер клиента E17" }, name: "Сдайте отчёт по НДС" });
	assert.equal(r.status, 201);
	assert.equal(r.item.kind, "client_request");
	r = await call("POST", "/bpai/tasks", { bin: client.bin, user: { name: acc.username }, name: "Себе: сверить банк" });
	assert.equal(r.item.kind, "task");
	r = await call("POST", "/bpai/tasks", { bin: client.bin, user: { name: acc.username }, name: "Клиент просил справку", kind: "client_request" });
	assert.equal(r.item.kind, "client_request");
	// 13.2 SLA в рабочем времени: срок реакции (обычный приоритет, 60 рабочих минут) не раньше календарного.
	const req = await prisma.todo.findUnique({ where: { uuid: r.item.uuid } });
	assert.ok(req.reactionDueAt.getTime() - req.createdAt.getTime() >= 59 * 60_000, "срок реакции в рабочем времени");
	// 13.3 Свой статус отмены с другим кодом — финал без результата.
	const declined = `e17_declined_${Date.now()}`;
	await prisma.todoStatus.create({ data: { code: declined, name: "Отказ клиента", sortOrder: 45, isFinal: true, isCancel: true } });
	_resetStatusCache();
	ok(await call("PUT", `/api/v1/todos/${r.item.uuid}`, { status: declined }), "cancel by flag");
	// 13.4 Производственный календарь: заполнен по закону, правит только администратор.
	r = ok(await call("GET", "/api/v1/work-calendar?year=2026"), "calendar");
	assert.ok(r.data.items.some((d) => d.date === "2026-03-24" && d.kind === "dayoff"), "перенос Наурыза");
	assert.equal((await call("POST", "/api/v1/work-calendar", { date: "2026-10-03", kind: "workday" }, "acc")).status, 403);
	ok(await call("POST", "/api/v1/work-calendar", { date: "2026-10-03", kind: "workday", name: "Рабочая суббота (тест)" }, "owner"), "calendar add");
	ok(await call("DELETE", "/api/v1/work-calendar/2026-10-03", null, "owner"), "calendar delete");
	// 13.5 Подсказка фирмы: организация вида «service» — первой.
	r = ok(await call("GET", "/api/v1/quality/firm-candidates", null, "owner"), "firm candidates");
	assert.equal(r.items[0].uuid, firm.uuid);
	// 13.6 Клиент без ответственного: задача по находкам без исполнителя + сигнал главбуху группы.
	const group = await prisma.staffGroup.findFirst({ where: { organizationUuid: firm.uuid } });
	await prisma.staffGroupClient.create({ data: { groupUuid: group.uuid, clientOrganizationUuid: client2.uuid, responsibleUuid: null } });
	r = ok(await call("POST", "/bpai/checks/results", { bin: client2.bin, baseKey: "Dev_01", runs: [{ check: "stock.negative", scope: "organization", request: {}, ok: true, data: { status: "findings", findings: [{ fingerprint: `stock.negative:${client2.uuid}:x`, severity: "error", title: "Минус" }] } }], snapshots: [] }), "client2 ingest");
	assert.equal(r.data.tasksOpened, 1);
	assert.ok(await prisma.userNotification.findFirst({ where: { userUuid: chief.uuid, kind: "no_responsible" } }), "главбуху — сигнал назначить ответственного");
	// 13.7 База не проверена (агент не умеет проверки) — видно на панели главбуха.
	ok(await call("POST", "/bpai/checks/results", { bin: client.bin, baseKey: "Dev_01", catalog: null, runs: [{ check: "_catalog", scope: "base", request: {}, ok: false, error: { code: "CAPABILITY_MISSING", message: "Агент не умеет проверки учёта" } }], snapshots: [] }), "catalog missing");
	r = ok(await call("GET", "/api/v1/quality/dashboard/chief", null, "chief"), "chief dash run status");
	assert.equal(r.data.clients.find((c) => c.organizationUuid === client.uuid).runStatus.state, "unavailable");
	// 13.8 Объявление о правилах задач — один раз.
	await prisma.appSetting.deleteMany({ where: { key: ANNOUNCE_KEY } });
	assert.match(await jobs.runAnnouncement(), /объявление/);
	assert.equal(await jobs.runAnnouncement(), undefined);
	assert.ok(await prisma.userNotification.findFirst({ where: { userUuid: acc.uuid, kind: "announcement" } }));

	r = ok(await call("GET", "/api/v1/quality/notifications?unread=1", null, "chief"), "notifications");
	assert.ok(r.items.length > 0);
	ok(await call("POST", "/api/v1/quality/notifications/read", { all: true }, "chief"), "read all");
	r = ok(await call("POST", "/api/v1/quality/consultation-review", { text: "Статья 1. …" }), "review");
	assert.equal(r.data.ok, false);
});
