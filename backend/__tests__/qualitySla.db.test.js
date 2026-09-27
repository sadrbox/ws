// Н6 аудита 26.09 против живого Postgres — ТОЛЬКО на базе с «test» в имени (как qualityStandard.db).
//
// Проверяет то, чего не было: SLA-джоб видит задачи ЛИШЬ фирмы и её клиентов; обходит все задачи, а не
// первую тысячу; повторный тик не пишет в базу уведомлений повторно (и не роняет INSERT); правило
// находок не голодает на клиенте без ответственного; приём итогов проверок атомарен и не дублируется
// при одновременной повторной доставке. В конце убирает за собой всё и возвращает прежнюю фирму.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const dbName = (() => {
	try { return new URL(process.env.DATABASE_URL || "").pathname.replace(/^\//, ""); } catch { return ""; }
})();
const RUN = /test/i.test(dbName);
const SKIP = RUN ? false : `база «${dbName}» не тестовая — пропуск`;

let prisma, firm, client, lonely, foreign, users, prevFirm, bpai;
const ONEC_AUTHOR = "Айгуль (1С: Dev_01)";
const IDEM_KEYS = ["1c:dev01:sla-task-1", "checks:sla-ingest-key-1"];
const rnd = () => String(Math.floor(1e11 + Math.random() * 8.9e11));
const OVERDUE = 1050; // больше прежнего take: 1000

before(async () => {
	if (!RUN) return;
	({ prisma } = await import("../prisma/prisma-client.js"));
	const { FIRM_KEY, setFirmOrgSetting, saveQualitySettings, _resetSettingsCache } = await import("../services/quality/settings.js");
	prevFirm = (await prisma.appSetting.findUnique({ where: { key: FIRM_KEY } }))?.value ?? null;
	firm = await prisma.organization.create({ data: { bin: rnd(), name: "Фирма (тест SLA)", kind: "service" } });
	client = await prisma.organization.create({ data: { bin: rnd(), name: "Клиент (тест SLA)" } });
	lonely = await prisma.organization.create({ data: { bin: rnd(), name: "Клиент без ответственного (тест SLA)" } });
	foreign = await prisma.organization.create({ data: { bin: rnd(), name: "Чужой арендатор (тест SLA)" } });
	const mk = (u) => prisma.user.create({ data: { username: `sla_${u}_${Date.now()}` } });
	const [chief, acc, stranger, owner] = await Promise.all(["chief", "acc", "stranger", "owner"].map(mk));
	users = { chief, acc, stranger, owner };
	await prisma.accessRight.create({ data: { userUuid: owner.uuid, organizationUuid: firm.uuid, role: "admin" } });
	await prisma.accessRight.create({ data: { userUuid: stranger.uuid, organizationUuid: foreign.uuid, role: "admin" } });
	await prisma.staffGroup.create({
		data: {
			organizationUuid: firm.uuid, name: "Группа SLA", headUuid: chief.uuid,
			members: { create: [{ userUuid: acc.uuid }] },
			clients: { create: [{ clientOrganizationUuid: client.uuid, responsibleUuid: acc.uuid }, { clientOrganizationUuid: lonely.uuid, responsibleUuid: null }] },
		},
	});
	await setFirmOrgSetting(firm.uuid);
	await saveQualitySettings(firm.uuid, { effectiveFrom: "2026-01-01", slaWorkingTime: false });
	_resetSettingsCache();

	// Служебный канал /bpai без bpaiAuth (как в qualityStandard.db): проверяем маршруты, не ключ.
	const app = express();
	app.use(express.json({ limit: "25mb" }));
	app.use("/bpai", (await import("../api/router/bpai.js")).default);
	const server = app.listen(0);
	await new Promise((r) => server.once("listening", r));
	const base = `http://127.0.0.1:${server.address().port}`;
	bpai = {
		close: () => server.close(),
		post: async (path, body, key) => {
			const r = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
			return { status: r.status, replayed: r.headers.get("idempotent-replayed"), ...(await r.json().catch(() => ({}))) };
		},
	};
});

after(async () => {
	if (!RUN) return;
	bpai?.close();
	try {
		const orgs = [firm.uuid, client.uuid, lonely.uuid, foreign.uuid];
		const uids = Object.values(users).map((u) => u.uuid);
		// Автор из 1С, заведённый каналом по имени, и ключи идемпотентности этого прогона.
		uids.push(...(await prisma.user.findMany({ where: { username: ONEC_AUTHOR }, select: { uuid: true } })).map((u) => u.uuid));
		await prisma.idempotencyKey.deleteMany({ where: { key: { in: IDEM_KEYS } } });
		const todos = await prisma.todo.findMany({ where: { organizationUuid: { in: orgs } }, select: { uuid: true } });
		const tu = todos.map((t) => t.uuid);
		await prisma.todoEvent.deleteMany({ where: { todoUuid: { in: tu } } });
		await prisma.todo.deleteMany({ where: { uuid: { in: tu } } });
		for (const m of ["standardViolation", "standardItem", "staffGroup", "checkRun", "checkFinding"]) {
			await prisma[m].deleteMany({ where: { organizationUuid: { in: orgs } } });
		}
		await prisma.userNotification.deleteMany({ where: { userUuid: { in: uids } } });
		await prisma.accessRight.deleteMany({ where: { userUuid: { in: uids } } });
		await prisma.user.deleteMany({ where: { uuid: { in: uids } } });
		await prisma.appSetting.deleteMany({ where: { key: `quality.settings.${firm.uuid}` } });
		await prisma.appSetting.upsert({ where: { key: "quality.firmOrganizationUuid" }, create: { key: "quality.firmOrganizationUuid", value: prevFirm }, update: { value: prevFirm } });
		await prisma.organization.deleteMany({ where: { uuid: { in: orgs } } });
	} finally {
		await prisma.$disconnect();
	}
});

/** Откатов транзакций в базе (упавший INSERT — это откат). Статистика сбрасывается с задержкой. */
async function rollbacks() {
	await new Promise((r) => setTimeout(r, 1500));
	await prisma.$executeRawUnsafe("SELECT pg_stat_clear_snapshot()");
	const [row] = await prisma.$queryRawUnsafe("SELECT xact_rollback::int AS n FROM pg_stat_database WHERE datname = current_database()");
	return row.n;
}

test("SLA: охват фирмы, все задачи сверх тысячи, повторный тик без повторных записей", { skip: SKIP, timeout: 300_000 }, async () => {
	const jobs = await import("../services/quality/jobs.js");
	const { acc, stranger, chief } = users;
	const past = new Date(Date.now() - 3 * 86_400_000);
	await prisma.todo.createMany({
		data: Array.from({ length: OVERDUE }, (_, i) => ({ name: `Просрочка ${i}`, organizationUuid: client.uuid, executorUuid: acc.uuid, deadline: past, kind: "task", lastActivityAt: new Date() })),
	});
	const foreignTodo = await prisma.todo.create({ data: { name: "Чужая просрочка", organizationUuid: foreign.uuid, executorUuid: stranger.uuid, deadline: past, kind: "task", lastActivityAt: new Date() } });

	const out = await jobs.runSlaJob();
	assert.match(String(out), /кандидатов: \d+/);
	const cand = await prisma.standardViolation.count({ where: { organizationUuid: firm.uuid, source: "rule:overdue_task" } });
	assert.equal(cand, OVERDUE, "обработаны все просрочки клиента, а не первая тысяча");
	assert.equal(await prisma.standardViolation.findUnique({ where: { ruleKey: `overdue:${foreignTodo.uuid}` } }), null, "чужой арендатор правилам фирмы не подсуден");
	assert.equal(await prisma.userNotification.count({ where: { userUuid: stranger.uuid } }), 0);
	const chiefSignals = await prisma.userNotification.count({ where: { userUuid: chief.uuid, kind: "overdue" } });
	assert.equal(chiefSignals, OVERDUE, "главбуху — по сигналу на просрочку");

	const notesBefore = await prisma.userNotification.count();
	const rbBefore = await rollbacks();
	const again = await jobs.runSlaJob();
	assert.equal(again, undefined, "второй тик — ничего нового");
	assert.equal(await prisma.userNotification.count(), notesBefore);
	assert.equal(await rollbacks(), rbBefore, "повторный тик не роняет INSERT (раньше — тысячи P2002 за тик)");
});

test("находки: клиент без ответственного не блокирует остальных; сигнал — один", { skip: SKIP, timeout: 120_000 }, async () => {
	const jobs = await import("../services/quality/jobs.js");
	const old = new Date(Date.now() - 30 * 86_400_000);
	// Сначала — много находок клиента без ответственного (раньше они занимали всю выборку take: 2000).
	await prisma.checkFinding.createMany({
		data: Array.from({ length: 600 }, (_, i) => ({ organizationUuid: lonely.uuid, checkCode: "stock.negative", fingerprint: `sla-lonely-${i}`, severity: "error", title: `Минус ${i}`, firstSeenAt: old })),
	});
	const f = await prisma.checkFinding.create({ data: { organizationUuid: client.uuid, checkCode: "stock.negative", fingerprint: "sla-client-1", severity: "error", title: "Минус у клиента", firstSeenAt: old } });
	await prisma.checkFinding.create({ data: { organizationUuid: foreign.uuid, checkCode: "stock.negative", fingerprint: "sla-foreign-1", severity: "error", title: "Минус у чужого", firstSeenAt: old } });

	await jobs.runFindingCandidates();
	assert.ok(await prisma.standardViolation.findUnique({ where: { ruleKey: `finding:${f.uuid}` } }), "находка клиента с ответственным дошла");
	assert.equal((await prisma.checkFinding.findUnique({ where: { uuid: f.uuid } })).candidateAt !== null, true);
	assert.equal(await prisma.standardViolation.count({ where: { source: "rule:finding_overdue", clientOrganizationUuid: foreign.uuid } }), 0);
	assert.equal(await prisma.userNotification.count({ where: { userUuid: users.chief.uuid, kind: "no_responsible" } }), 1, "сигнал «нет ответственного» — один на клиента, а не на находку");
	await jobs.runFindingCandidates();
	assert.equal(await prisma.userNotification.count({ where: { userUuid: users.chief.uuid, kind: "no_responsible" } }), 1);
});

test("приём итогов: одновременная повторная доставка — один прогон; неизменённые — без полного UPDATE", { skip: SKIP, timeout: 120_000 }, async () => {
	const { ingestCheckResults } = await import("../services/quality/checks.js");
	const findings = Array.from({ length: 300 }, (_, i) => ({ fingerprint: `sla-ingest-${i}`, severity: "error", title: `Находка ${i}`, amount: i }));
	const body = (fs, readAt) => ({ baseKey: "T", runs: [{ check: "stock.negative", scope: "organization", request: {}, ok: true, data: { status: "findings", readAt, findings: fs } }], snapshots: [] });
	const readAt = new Date().toISOString();
	const [a, b] = await Promise.all([ingestCheckResults(client.uuid, body(findings, readAt)), ingestCheckResults(client.uuid, body(findings, readAt))]);
	assert.equal(a.runs + b.runs, 1, "повтор той же посылки принят один раз");
	assert.equal((a.duplicates || 0) + (b.duplicates || 0), 1);
	assert.equal(a.findingsNew + b.findingsNew, 300);

	const changed = findings.map((x, i) => (i === 7 ? { ...x, title: "Находка 7 (изменилась)" } : x)).slice(0, 299);
	const r = await ingestCheckResults(client.uuid, body(changed, new Date(Date.now() + 1000).toISOString()));
	assert.equal(r.findingsSeen, 299);
	assert.equal(r.findingsResolved, 1, "пропавшая в полном прогоне — устранена");
	const run = await prisma.checkRun.findFirst({ where: { organizationUuid: client.uuid, checkCode: "stock.negative" }, orderBy: { id: "desc" } });
	assert.equal(await prisma.checkFinding.count({ where: { organizationUuid: client.uuid, fingerprint: { startsWith: "sla-ingest-" }, lastRunUuid: run.uuid } }), 299, "неизменённые отмечены прогоном пакетно");
	assert.equal((await prisma.checkFinding.findFirst({ where: { organizationUuid: client.uuid, fingerprint: "sla-ingest-7" } })).title, "Находка 7 (изменилась)");
});

test("канал 1С: повтор с тем же Idempotency-Key — одна задача и прежний ответ; автор «имя (1С: база)» — принят, найден, показан", { skip: SKIP, timeout: 120_000 }, async () => {
	const { resolveUser } = await import("../services/pipeActor.js");
	const body = { bin: client.bin, user: { name: ONEC_AUTHOR }, name: "Сверить банк (тест SLA)", kind: "task" };
	const first = await bpai.post("/bpai/tasks", body, IDEM_KEYS[0]);
	assert.equal(first.status, 201, first.message);
	const again = await bpai.post("/bpai/tasks", body, IDEM_KEYS[0]);
	assert.equal(again.status, 201);
	assert.equal(again.replayed, "true");
	assert.equal(again.item.uuid, first.item.uuid, "повтор отдал ту же задачу");
	assert.equal(await prisma.todo.count({ where: { organizationUuid: client.uuid, name: body.name } }), 1, "задача одна");
	// п. 5: имя со скобками принимается как есть, автор — один пользователь, ищется точным совпадением.
	assert.equal(first.item.curatorName, ONEC_AUTHOR, "в форме 1С автор виден с пометкой базы");
	const authors = await prisma.user.findMany({ where: { username: ONEC_AUTHOR }, select: { uuid: true, password: true } });
	assert.equal(authors.length, 1);
	assert.equal(authors[0].password, null, "войти под таким автором нельзя");
	assert.deepEqual(await resolveUser({ user: { name: ONEC_AUTHOR } }), { uuid: authors[0].uuid, created: false });
	assert.equal((await prisma.todo.findUnique({ where: { uuid: first.item.uuid } })).curatorUuid, authors[0].uuid);
	// Без ключа — второй запрос создаёт вторую задачу (поведение канала до добора сохранено).
	const plain = await bpai.post("/bpai/tasks", { ...body, name: "Без ключа (тест SLA)" });
	assert.equal(plain.status, 201);
	assert.equal((await bpai.post("/bpai/tasks", { ...body, name: "Без ключа (тест SLA)" })).item.uuid !== plain.item.uuid, true);
});

test("приём итогов проверок: повтор посылки с тем же ключом — прежние счётчики, один прогон", { skip: SKIP, timeout: 120_000 }, async () => {
	const posting = {
		bin: foreign.bin, baseKey: "Dev_01", idempotencyKey: IDEM_KEYS[1],
		runs: [{ check: "stock.negative", scope: "organization", request: {}, ok: true, data: { status: "findings", findings: [{ fingerprint: "sla-idem-1", severity: "error", title: "Минус (идемпотентность)" }] } }],
		snapshots: [],
	};
	const before = await prisma.checkRun.count({ where: { organizationUuid: foreign.uuid } });
	const first = await bpai.post("/bpai/checks/results", posting); // ключ — полем тела, как шлёт сервис ИИ
	assert.equal(first.status, 200, first.message);
	assert.equal(first.data.runs, 1);
	const again = await bpai.post("/bpai/checks/results", posting);
	assert.equal(again.replayed, "true");
	assert.deepEqual(again.data, first.data);
	assert.equal(await prisma.checkRun.count({ where: { organizationUuid: foreign.uuid } }), before + 1, "второго прогона нет");
});
