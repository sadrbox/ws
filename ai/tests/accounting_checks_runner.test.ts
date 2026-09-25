/**
 * НОЧНЫЕ ПРОВЕРКИ УЧЁТА (E17, СК2.2): прогонщик по базам клиентов.
 *
 * Живой стороны 1С на 25.09 нет — команды LIST/RUN_ACCOUNTING_CHECK и GET_ACCOUNTING_SNAPSHOT ещё не написаны,
 * поэтому всё, что можно проверить до первой живой базы, проверяется здесь, на подставных агенте и очереди:
 *   — когда пора (окно после ACCOUNTING_CHECKS_AT, не дважды за ночь, окно через полночь);
 *   — что уходит в 1С: период по periodKind, БИН только у проверок организации, предел находок, снимки;
 *   — кого не трогаем: агента без команд проверок, БИН, которого нет в ERP, базу сверх тарифа и лежащую;
 *   — кого проверяем: только обслуживаемых фирмой, если фирма их уже назвала, иначе всех известных ERP (п. 10
 *     реестра), и чьи находки справочников — первой обслуживаемой организации базы (п. 11);
 *   — отказ одной проверки не останавливает остальные, а пропавшая база — останавливает только себя;
 *   — база без каталога или агент без команд проверок — ERP получает «база не проверена» (п. 21);
 *   — посылка в ERP ровно той формы, что принимает бэкенд, и сбой ERP не роняет прогон.
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import {
	checksWindowDate, isChecksDue, parseCatalog, periodFields, planOrganization, snapshotPeriods,
} from "../src/onec/accountingChecks.ts";
import { AccountingCheckRunStore, AccountingChecksRunner, SERVED_ORGANIZATIONS_SQL, type ChecksConfig } from "../src/onec/accountingChecksRunner.ts";
import { accountingChecksRouter } from "../src/http/accountingChecksRouter.ts";
import { ErpRefused, ErpUnavailable, type ErpCheckResults } from "../src/erp/tasks.ts";
import { purgeOldData } from "../src/retention.ts";

/** Момент местного времени: расписание и периоды живут по часам сервера, а не по UTC. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const BIN_A = "831111302342";
const BIN_B = "900000000001";
const BIN_C = "123456789012";
const ORG_A = "a1410911-7421-45da-9632-7e4fc48e91c2";
const ORG_C = "c1410911-7421-45da-9632-7e4fc48e91c2";

/** Каталог, как его описывает задача расширению: две проверки организации, одна базы, одна недоступна, два снимка. */
const CATALOG = {
	apiVersion: "1.7.0",
	checks: [
		{ code: "stock.negative", version: 1, title: "Отрицательные остатки ТМЗ", scope: "organization", periodKind: "onDate", params: [], available: true, unavailableReason: null, expectedSeconds: 20 },
		{ code: "documents.unposted", version: 1, title: "Непроведённые документы", scope: "organization", periodKind: "period", params: [], available: true, unavailableReason: null },
		{ code: "catalogs.duplicate_counterparties", version: 1, title: "Дубли контрагентов", scope: "base", periodKind: "none", params: [], available: true, unavailableReason: null },
		{ code: "esf.mismatch", version: 1, title: "ЭСФ не сходится с учётом", scope: "organization", periodKind: "period", params: [], available: false, unavailableReason: "в базе нет данных ЭСФ" },
	],
	snapshots: [
		{ code: "taxes", version: 1, title: "Расчёты с бюджетом", periodKind: "period", params: [], available: true, unavailableReason: null },
		{ code: "documents", version: 1, title: "Динамика ввода первички", periodKind: "period", params: [], available: true, unavailableReason: null },
	],
};

// ── Когда пора ───────────────────────────────────────────────────────────────

describe("пора ли ночному прогону", () => {
	it("до времени запуска — нет, в само время — да", () => {
		assert.equal(isChecksDue(null, local(2026, 9, 25, 2, 29), "02:30"), false);
		assert.equal(isChecksDue(null, local(2026, 9, 25, 2, 30), "02:30"), true);
	});

	it("перезапуск в окне прогон догоняет, днём — нет: по базам клиентов в рабочее время не ходим", () => {
		assert.equal(isChecksDue(null, local(2026, 9, 25, 5, 29), "02:30"), true);
		assert.equal(isChecksDue(null, local(2026, 9, 25, 5, 30), "02:30"), false);
		assert.equal(isChecksDue(null, local(2026, 9, 25, 10, 0), "02:30"), false);
	});

	it("за одну ночь — один прогон; следующей ночью — снова", () => {
		assert.equal(isChecksDue("2026-09-25", local(2026, 9, 25, 2, 40), "02:30"), false);
		assert.equal(isChecksDue("2026-09-24", local(2026, 9, 25, 2, 40), "02:30"), true);
	});

	it("окно через полночь принадлежит дню, когда началось", () => {
		assert.equal(checksWindowDate(local(2026, 9, 26, 0, 10), "23:30"), "2026-09-25");
		assert.equal(isChecksDue("2026-09-25", local(2026, 9, 26, 0, 10), "23:30"), false, "прогон с 23:30 не повторяется после полуночи");
		assert.equal(isChecksDue(null, local(2026, 9, 26, 0, 10), "23:30"), true, "сервис, поднятый в 00:10, догоняет вчерашнее окно");
		assert.equal(checksWindowDate(local(2026, 9, 25, 23, 0), "23:30"), null);
	});
});

// ── Периоды и план вызовов ───────────────────────────────────────────────────

describe("период проверки по periodKind", () => {
	const now = local(2026, 9, 25, 2, 35);

	it("period — с первого числа прошлого месяца по сегодня; onDate — сегодня; none — ничего", () => {
		assert.deepEqual(periodFields("period", now), { from: "2026-08-01", to: "2026-09-25" });
		assert.deepEqual(periodFields("onDate", now), { onDate: "2026-09-25" });
		assert.deepEqual(periodFields("none", now), {});
	});

	it("незнакомый periodKind — как period: from/to годятся и проверке на дату", () => {
		assert.deepEqual(periodFields("quarter", now), { from: "2026-08-01", to: "2026-09-25" });
	});

	it("январь: прошлый месяц — декабрь прошлого года", () => {
		assert.deepEqual(periodFields("period", local(2026, 1, 15, 2, 30)), { from: "2025-12-01", to: "2026-01-15" });
	});

	it("снимок documents — прошлый и текущий месяц целиком: разница ночных снимков не должна зависеть от даты прогона", () => {
		assert.deepEqual(snapshotPeriods("documents", "period", now), [
			{ from: "2026-08-01", to: "2026-08-31" },
			{ from: "2026-09-01", to: "2026-09-30" },
		]);
		assert.deepEqual(snapshotPeriods("documents", "period", local(2026, 3, 1, 2, 30)), [
			{ from: "2026-02-01", to: "2026-02-28" },
			{ from: "2026-03-01", to: "2026-03-31" },
		]);
		assert.deepEqual(snapshotPeriods("taxes", "period", now), [{ from: "2026-08-01", to: "2026-09-25" }]);
	});
});

describe("план вызовов по организации", () => {
	const now = local(2026, 9, 25, 2, 35);
	const catalog = parseCatalog(CATALOG)!;

	it("проверки организации — с БИН и пределом, проверка базы — без БИН, недоступная не ставится", () => {
		const calls = planOrganization(catalog, BIN_A, { now, limit: 1000, withBase: true, withSnapshots: true });
		assert.deepEqual(calls.filter((c) => c.kind === "check").map((c) => c.payload), [
			{ check: "stock.negative", organizationBin: BIN_A, onDate: "2026-09-25", limit: 1000 },
			{ check: "documents.unposted", organizationBin: BIN_A, from: "2026-08-01", to: "2026-09-25", limit: 1000 },
			// Справочники общие на всю базу: БИН «не требуют и не учитывают» (контракт, правило 4).
			{ check: "catalogs.duplicate_counterparties", limit: 1000 },
		]);
		assert.ok(!calls.some((c) => c.code === "esf.mismatch"), "1С сказала, что проверка к базе неприменима, — её не ставят");
		assert.deepEqual(calls.filter((c) => c.kind === "snapshot").map((c) => c.payload), [
			{ snapshot: "taxes", organizationBin: BIN_A, from: "2026-08-01", to: "2026-09-25" },
			{ snapshot: "documents", organizationBin: BIN_A, from: "2026-08-01", to: "2026-08-31" },
			{ snapshot: "documents", organizationBin: BIN_A, from: "2026-09-01", to: "2026-09-30" },
		]);
	});

	it("проверки базы — один раз на базу; снимков нет, если агент их не умеет", () => {
		const calls = planOrganization(catalog, BIN_B, { now, limit: 200, withBase: false, withSnapshots: false });
		assert.deepEqual(calls.map((c) => c.code), ["stock.negative", "documents.unposted"]);
		assert.equal(calls[0]!.payload.limit, 200);
	});
});

describe("каталог проверок", () => {
	it("конверт снимается, повтор кода и строки без кода отбрасываются", () => {
		const c = parseCatalog({ success: true, data: { apiVersion: "1.7.0", checks: [
			{ code: "stock.negative", scope: "organization", periodKind: "onDate" },
			{ code: "stock.negative", scope: "base" },
			{ title: "без кода" },
		] } })!;
		assert.deepEqual(c.checks.map((x) => [x.code, x.scope, x.available]), [["stock.negative", "organization", true]]);
		assert.deepEqual(c.snapshots, []);
		assert.equal(c.apiVersion, "1.7.0");
	});

	it("не каталог — null, а не «проверок нет»", () => {
		assert.equal(parseCatalog({ rows: [] }), null);
		assert.equal(parseCatalog(null), null);
	});
});

// ── Прогонщик на подставных агенте, очереди и ERP ────────────────────────────

type Agent = {
	id: string; name: string; role: "business" | "admin"; disabled: boolean; online: boolean; capabilities: string[];
	organizationUuid: string; limits: { maxBases: number | null; maxBins: number | null; activeBins?: string[] | null };
};
type Base = { key: string; status?: string | null; organizations: { id: string | null; name: string | null; bin: string | null }[] | null };

const ALL_TYPES = ["HEALTH", "LIST_ACCOUNTING_CHECKS", "RUN_ACCOUNTING_CHECK", "GET_ACCOUNTING_SNAPSHOT"];

const agent = (id: string, over: Partial<Agent> = {}): Agent => ({
	id, name: `agent ${id}`, role: "business", disabled: false, online: true, capabilities: ALL_TYPES,
	organizationUuid: "org-owner", limits: { maxBases: null, maxBins: null }, ...over,
});

type Reply = { state: string; result?: unknown; error?: { code: string; message: string }; onec_http_status?: number | null } | null;
type Enqueued = { id: string; agentId: string; baseKey: string | null; type: string; payload: Record<string, unknown>; userUuid: string | null; priority: number; ttlSeconds: number };

function harness(opts: {
	agents: Agent[];
	bases: Record<string, Base[]>;
	/** БИН → организация ERP; нет в списке — ERP такой организации не знает. */
	erpOrgs?: Record<string, { uuid: string; name: string }>;
	/** Лишние строки `organizations` (например, второй живой организации с тем же БИН). */
	extraErpRows?: { uuid: string; bin: string; name: string }[];
	/**
	 * Обслуживаемые фирмой организации ERP (uuid): клиенты групп сотрудников и действующих связей обслуживания.
	 * Не задано — ни одной (обслуживание не настроено). Ошибка — так отвечает запрос (например, нет таблицы).
	 */
	served?: string[] | Error;
	/** Ответ очереди на команду; по умолчанию — каталог, пустая проверка и пустой снимок. */
	reply?: (c: Enqueued) => Reply;
	/** Что делает ERP с посылкой: бросить — отказ. */
	sink?: (body: ErpCheckResults, attempt: number) => Record<string, unknown>;
	sinkEnabled?: boolean;
	cfg?: Partial<ChecksConfig>;
	now?: Date;
	claim?: (i: { kind: string; runDate: string }) => string | null;
}) {
	const enqueued: Enqueued[] = [];
	const bodies: ErpCheckResults[] = [];
	const claims: { kind: string; runDate: string; userUuid: string | null }[] = [];
	const finished: { id: string; t: Record<string, unknown> }[] = [];
	const warnings: unknown[] = [];
	const infos: { obj: Record<string, unknown>; msg: string }[] = [];
	const erpSql: string[] = [];
	let attempts = 0;
	const reply = opts.reply ?? ((c: Enqueued): Reply => {
		if (c.type === "LIST_ACCOUNTING_CHECKS") return { state: "done", result: CATALOG };
		if (c.type === "RUN_ACCOUNTING_CHECK") return { state: "done", result: { check: c.payload.check, version: 1, status: "ok", total: 0, findings: [] } };
		return { state: "done", result: { snapshot: c.payload.snapshot, version: 1, rows: [] } };
	});
	const runner = new AccountingChecksRunner({
		agents: { listAll: async () => opts.agents as never },
		agentBases: {
			listMany: async (ids: readonly string[]) => new Map(ids.map((id) => [id, (opts.bases[id] ?? []).map((b, pos) => ({
				key: b.key, pos, status: b.status ?? "ONLINE", transport: "http" as const, extVersion: "1.7.0", overLimit: null,
				organizations: b.organizations, seenAt: null,
			}))])),
		},
		erp: {
			query: (async (sql: string, p: unknown[] = []) => {
				erpSql.push(sql);
				if (sql.includes("staff_group_clients")) {
					if (opts.served instanceof Error) throw opts.served;
					const rows = (opts.served ?? []).map((uuid) => ({ uuid }));
					return { rows, rowCount: rows.length };
				}
				const bins = (p[0] as string[]) ?? [];
				const rows = bins.filter((b) => opts.erpOrgs?.[b]).map((b) => ({ uuid: opts.erpOrgs![b]!.uuid, bin: b, name: opts.erpOrgs![b]!.name }));
				rows.push(...(opts.extraErpRows ?? []).filter((x) => bins.includes(x.bin)));
				return { rows, rowCount: rows.length };
			}) as never,
		},
		queue: {
			enqueue: (async (i: Omit<Enqueued, "id">) => {
				const c = { ...i, id: `cmd-${enqueued.length + 1}`, baseKey: i.baseKey ?? null } as Enqueued;
				enqueued.push(c);
				return { id: c.id };
			}) as never,
			waitResult: (async (id: string) => {
				const c = enqueued.find((x) => x.id === id)!;
				const r = reply(c);
				return r === null ? { id, state: "dispatched" } : { id, ...r };
			}) as never,
		},
		sink: {
			enabled: opts.sinkEnabled !== false,
			sendCheckResults: async (body: ErpCheckResults) => {
				attempts++;
				const out = opts.sink ? opts.sink(body, attempts) : { findings: 0 };
				bodies.push(body);
				return out;
			},
		},
		store: {
			claim: async (i) => { claims.push(i); return opts.claim ? opts.claim(i) : `run-${claims.length}`; },
			finish: async (id, t) => { finished.push({ id, t: t as never }); },
			interruptUnfinished: async () => 0,
		},
		log: {
			info: (obj: unknown, msg?: unknown) => { infos.push({ obj: (obj ?? {}) as Record<string, unknown>, msg: String(msg ?? "") }); },
			warn: (...a: unknown[]) => { warnings.push(a); },
			error: () => {},
		},
		now: () => opts.now ?? local(2026, 9, 25, 2, 35),
		retryDelayMs: 0,
	}, { enabled: true, at: "02:30", parallel: 2, commandTimeoutSecs: 600, limit: 1000, ...opts.cfg });
	return { runner, enqueued, bodies, claims, finished, warnings, infos, erpSql };
}

/** Посылка «база не проверена»: без каталога, одна строка `_catalog` с причиной, без снимков. */
const unchecked = (b: ErpCheckResults) => {
	assert.equal(b.catalog, null, "каталога нет — поле null, а не пустой каталог");
	assert.deepEqual(b.snapshots, []);
	assert.equal(b.runs.length, 1);
	const r = b.runs[0]!;
	assert.equal(r.check, "_catalog");
	assert.equal(r.scope, "base");
	assert.deepEqual(r.request, {});
	assert.equal(r.ok, false);
	return r.ok ? { code: "", message: "" } : r.error;
};

test("посылка в ERP — ровно той формы, что принимает бэкенд: одна на организацию, запрос каждой проверки как ушёл в 1С", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Dev_01", organizations: [{ id: "o1", name: "ТОО Алеппо", bin: BIN_A }] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "ТОО Алеппо" } },
	});
	const report = await h.runner.run();

	assert.equal(h.bodies.length, 1);
	const body = h.bodies[0]!;
	assert.deepEqual(Object.keys(body).sort(), ["agentId", "baseKey", "bin", "catalog", "finishedAt", "runs", "snapshots", "startedAt"]);
	assert.equal(body.bin, BIN_A);
	assert.equal(body.baseKey, "Dev_01");
	assert.equal(body.agentId, "ag-1");
	assert.ok(!Number.isNaN(Date.parse(body.startedAt)) && !Number.isNaN(Date.parse(body.finishedAt)));
	// Каталог — как его вернула 1С: версии, параметры, причины недоступности нужны ERP целиком.
	assert.deepEqual(body.catalog, { apiVersion: "1.7.0", checks: CATALOG.checks, snapshots: CATALOG.snapshots });
	assert.deepEqual(body.runs.map((r) => [r.check, r.scope, r.ok]), [
		["stock.negative", "organization", true],
		["documents.unposted", "organization", true],
		["catalogs.duplicate_counterparties", "base", true],
	]);
	assert.deepEqual(body.runs[0], {
		check: "stock.negative", scope: "organization",
		request: { check: "stock.negative", organizationBin: BIN_A, onDate: "2026-09-25", limit: 1000 },
		ok: true, data: { check: "stock.negative", version: 1, status: "ok", total: 0, findings: [] },
	});
	assert.deepEqual(body.snapshots.map((s) => [s.snapshot, s.request.from, s.request.to, s.ok]), [
		["taxes", "2026-08-01", "2026-09-25", true],
		["documents", "2026-08-01", "2026-08-31", true],
		["documents", "2026-09-01", "2026-09-30", true],
	]);

	// Очередь: работа сервиса, а не человека; пакетный приоритет; база — в колонке очереди; каталог — первым.
	assert.equal(h.enqueued[0]!.type, "LIST_ACCOUNTING_CHECKS");
	assert.deepEqual(h.enqueued[0]!.payload, {});
	for (const c of h.enqueued) {
		assert.equal(c.baseKey, "Dev_01");
		assert.equal(c.userUuid, null);
		assert.equal(c.priority, 10);
		assert.equal(c.ttlSeconds, 600);
		assert.equal(c.agentId, "ag-1");
	}
	assert.equal(h.enqueued.length, 1 + 3 + 3);
	assert.deepEqual([report.targets, report.orgs, report.commands, report.failures, report.forward.ok], [1, 1, 7, 0, 1]);
});

test("БИН, которого нет в ERP, не проверяется: находку некому адресовать", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Dev_01", organizations: [
			{ id: "o1", name: "ТОО Алеппо", bin: BIN_A },
			{ id: "o2", name: "ТОО Чужая", bin: BIN_B },
		] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "ТОО Алеппо" } },
	});
	const report = await h.runner.run();
	assert.deepEqual(h.bodies.map((b) => b.bin), [BIN_A]);
	assert.ok(!h.enqueued.some((c) => c.payload.organizationBin === BIN_B), "в 1С по неизвестному ERP БИН не ходим");
	assert.deepEqual(report.skipped.binsNotInErp, [BIN_B]);
});

test("база без единой организации ERP — ни одной команды, даже каталога", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Alien", organizations: [{ id: "o2", name: "ТОО Чужая", bin: BIN_B }] }] },
		erpOrgs: {},
	});
	const report = await h.runner.run();
	assert.equal(h.enqueued.length, 0);
	assert.equal(report.targets, 0);
});

test("агент без команд проверок — ни одной команды, но ERP узнаёт «база не проверена»; агент без перечня типов — проверяется; без снимков — только проверки", async () => {
	const h = harness({
		agents: [
			agent("old", { capabilities: ["HEALTH", "CREATE_SALE"] }),
			agent("silent", { capabilities: [] }),
			agent("nosnap", { capabilities: ["HEALTH", "LIST_ACCOUNTING_CHECKS", "RUN_ACCOUNTING_CHECK"] }),
		],
		bases: {
			old: [{ key: "Old_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }],
			silent: [{ key: "Silent_01", organizations: [{ id: "o2", name: "Б", bin: BIN_B }] }],
			nosnap: [{ key: "NoSnap_01", organizations: [{ id: "o3", name: "В", bin: BIN_C }] }],
		},
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_B]: { uuid: "b-uuid", name: "Б" }, [BIN_C]: { uuid: ORG_C, name: "В" } },
	});
	const report = await h.runner.run();
	assert.deepEqual(report.skipped.agentsWithoutCapability, ["old"]);
	assert.ok(!h.enqueued.some((c) => c.agentId === "old"), "сборке без команд проверок не шлём ни одной команды");
	// …но ERP видит, что база не проверена, — нейтральным кодом: это не упущение бухгалтера, а устаревший агент.
	const old = h.bodies.filter((b) => b.agentId === "old");
	assert.deepEqual(old.map((b) => [b.bin, b.baseKey]), [[BIN_A, "Old_01"]]);
	const why = unchecked(old[0]!);
	assert.equal(why.code, "CAPABILITY_MISSING");
	assert.match(why.message, /обновите агента/);
	const oldReport = report.bases.find((b) => b.agentId === "old")!;
	assert.deepEqual([oldReport.commands, oldReport.failures, oldReport.forwarded, oldReport.error?.code], [0, 0, 1, "CAPABILITY_MISSING"]);

	assert.ok(h.enqueued.some((c) => c.agentId === "silent" && c.type === "RUN_ACCOUNTING_CHECK"), "молчание о типах — не «не умеет»");
	assert.ok(h.enqueued.some((c) => c.agentId === "nosnap" && c.type === "RUN_ACCOUNTING_CHECK"));
	assert.ok(!h.enqueued.some((c) => c.agentId === "nosnap" && c.type === "GET_ACCOUNTING_SNAPSHOT"), "снимков сборка не знает — и не спрашиваем");
	assert.deepEqual(h.bodies.find((b) => b.agentId === "nosnap")!.snapshots, []);
});

test("БИН, который видят два агента, проверяет умеющий — неумеющая сборка не подменяет проверки отметкой «обновите агента»", async () => {
	const h = harness({
		// Неумеющий — первым в списке агентов: порядок списка не должен решать, кто проверяет.
		agents: [agent("old", { capabilities: ["HEALTH", "CREATE_SALE"] }), agent("new")],
		bases: {
			old: [{ key: "Old_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }],
			new: [{ key: "New_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }],
		},
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
	});
	const report = await h.runner.run();
	assert.deepEqual(h.bodies.map((b) => [b.agentId, b.catalog === null]), [["new", false]], "одна посылка — настоящая, от умеющего агента");
	assert.deepEqual(report.skipped.binsInOtherBase, [`${BIN_A}@Old_01`]);
});

test("агент отключённый, не на связи или администратор кластера — не участвует", async () => {
	const h = harness({
		agents: [agent("off", { online: false }), agent("dis", { disabled: true }), agent("adm", { role: "admin" })],
		bases: {
			off: [{ key: "A", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }],
			dis: [{ key: "B", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }],
			adm: [{ key: "C", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }],
		},
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
	});
	await h.runner.run();
	assert.equal(h.enqueued.length, 0);
});

test("отказ одной проверки не останавливает остальные — он строка ok:false в посылке", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Dev_01", organizations: [{ id: "o1", name: "ТОО Алеппо", bin: BIN_A }] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "ТОО Алеппо" } },
		reply: (c) => {
			if (c.type === "LIST_ACCOUNTING_CHECKS") return { state: "done", result: CATALOG };
			if (c.payload.check === "stock.negative") return { state: "failed", error: { code: "ACCESS_DENIED", message: "Нет прав на чтение регистра бухгалтерии" } };
			if (c.payload.check === "documents.unposted") return { state: "failed", error: { code: "TIMEOUT", message: "Проверка не уложилась в 600 с" } };
			return { state: "done", result: { status: "ok", findings: [] } };
		},
	});
	const report = await h.runner.run();
	const body = h.bodies[0]!;
	assert.deepEqual(body.runs.map((r) => [r.check, r.ok]), [
		["stock.negative", false], ["documents.unposted", false], ["catalogs.duplicate_counterparties", true],
	]);
	assert.deepEqual(body.runs[0]!.ok ? null : body.runs[0]!.error, { code: "ACCESS_DENIED", message: "Нет прав на чтение регистра бухгалтерии" });
	// Предел, выбранный самой проверкой, — ответ базы, а не её пропажа: снимки после него всё равно снимаются.
	assert.ok(body.snapshots.every((s) => s.ok), "база ответила отказом — значит жива, и остальное ставится");
	assert.equal(report.failures, 2);
});

test("база перестала отвечать — остальные её проверки не ставятся, но посылка честно говорит, что не выполнялось", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: {
			"ag-1": [
				{ key: "Stuck", organizations: [{ id: "o1", name: "А", bin: BIN_A }] },
				{ key: "Fine", organizations: [{ id: "o3", name: "В", bin: BIN_C }] },
			],
		},
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_C]: { uuid: ORG_C, name: "В" } },
		reply: (c) => {
			if (c.type === "LIST_ACCOUNTING_CHECKS") return { state: "done", result: CATALOG };
			if (c.baseKey === "Stuck" && c.payload.check === "stock.negative") return null; // так и не ответила
			return { state: "done", result: { status: "ok" } };
		},
	});
	const report = await h.runner.run();
	const stuck = h.bodies.find((b) => b.baseKey === "Stuck")!;
	assert.deepEqual(stuck.runs.map((r) => (r.ok ? "ok" : r.error.code)), ["NO_ANSWER", "NOT_RUN", "NOT_RUN"]);
	assert.ok(stuck.snapshots.every((s) => !s.ok && s.error.code === "NOT_RUN"));
	assert.equal(h.enqueued.filter((c) => c.baseKey === "Stuck").length, 2, "после пропажи базы в неё больше ничего не ставится");
	// Соседняя база от этого не страдает.
	const fine = h.bodies.find((b) => b.baseKey === "Fine")!;
	assert.ok(fine.runs.every((r) => r.ok) && fine.snapshots.every((s) => s.ok));
	assert.equal(report.bases.length, 2);
});

test("каталог не получен — проверки вслепую не ставим, ERP получает «база не проверена», прогон идёт дальше", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [
			{ key: "NoExt", organizations: [{ id: "o1", name: "А", bin: BIN_A }] },
			{ key: "Dev_01", organizations: [{ id: "o3", name: "В", bin: BIN_C }] },
		] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_C]: { uuid: ORG_C, name: "В" } },
		reply: (c) => {
			if (c.type === "LIST_ACCOUNTING_CHECKS" && c.baseKey === "NoExt") return { state: "failed", error: { code: "UNKNOWN_COMMAND", message: "Команда не поддерживается" } };
			if (c.type === "LIST_ACCOUNTING_CHECKS") return { state: "done", result: CATALOG };
			return { state: "done", result: { status: "ok" } };
		},
	});
	const report = await h.runner.run();
	assert.deepEqual(h.bodies.map((b) => [b.baseKey, b.catalog === null]).sort(), [["Dev_01", false], ["NoExt", true]]);
	// Агент старой сборки не знает команды — та же причина, что у сборки без перечня: для ERP это CAPABILITY_MISSING.
	const why = unchecked(h.bodies.find((b) => b.baseKey === "NoExt")!);
	assert.equal(why.code, "CAPABILITY_MISSING");
	assert.match(why.message, /UNKNOWN_COMMAND/, "исходный код не теряется — он в тексте");
	// В журнале сервиса — как ответила база: по нему и разбираются.
	const noext = report.bases.find((b) => b.baseKey === "NoExt")!;
	assert.equal(noext.error?.code, "UNKNOWN_COMMAND");
	assert.deepEqual([noext.commands, noext.failures, noext.forwarded], [1, 1, 1]);
	assert.equal(h.enqueued.filter((c) => c.baseKey === "NoExt").length, 1, "без каталога проверки вслепую не ставим");
});

test("расширение старше 1.7 при агенте 25.09 11:56–21:58 — тоже «не умеет», а не сбой (ответ 1С, раздел 7в)", async () => {
	const BIN_D = "990000000004";
	const BIN_E = "990000000005";
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [
			{ key: "OldHttp", organizations: [{ id: "o1", name: "А", bin: BIN_A }] },
			{ key: "OldCom", organizations: [{ id: "o2", name: "Б", bin: BIN_B }] },
			{ key: "Broken", organizations: [{ id: "o3", name: "В", bin: BIN_C }] },
			{ key: "NotFound", organizations: [{ id: "o4", name: "Г", bin: BIN_D }] },
			{ key: "Fine", organizations: [{ id: "o5", name: "Д", bin: BIN_E }] },
		] },
		erpOrgs: {
			[BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_B]: { uuid: "b1410911-7421-45da-9632-7e4fc48e91c2", name: "Б" },
			[BIN_C]: { uuid: ORG_C, name: "В" }, [BIN_D]: { uuid: "d1410911-7421-45da-9632-7e4fc48e91c2", name: "Г" },
			[BIN_E]: { uuid: "e1410911-7421-45da-9632-7e4fc48e91c2", name: "Д" },
		},
		reply: (c) => {
			if (c.type !== "LIST_ACCOUNTING_CHECKS") return { state: "done", result: { status: "ok" } };
			// По HTTP IIS отвечает на незнакомый маршрут страницей 404 — агент отдаёт ONEC_BAD_RESPONSE.
			if (c.baseKey === "OldHttp") return { state: "failed", error: { code: "ONEC_BAD_RESPONSE", message: "1С вернула не JSON" }, onec_http_status: 404 };
			// По COM шлюз расширения не находит операцию.
			if (c.baseKey === "OldCom") return { state: "failed", error: { code: "NOT_FOUND", message: "Операция checks.list нет среди бизнес-операций" } };
			// Тот же код без признака «не знаю маршрута» — сбой: база должна выглядеть упавшей.
			if (c.baseKey === "Broken") return { state: "failed", error: { code: "ONEC_BAD_RESPONSE", message: "1С вернула не JSON" }, onec_http_status: 500 };
			if (c.baseKey === "NotFound") return { state: "failed", error: { code: "NOT_FOUND", message: "Организация не найдена" } };
			return { state: "done", result: CATALOG };
		},
	});
	const report = await h.runner.run();
	const why = (key: string) => unchecked(h.bodies.find((b) => b.baseKey === key)!);
	assert.equal(why("OldHttp").code, "CAPABILITY_MISSING");
	assert.match(why("OldHttp").message, /ONEC_BAD_RESPONSE/, "исходный код — в тексте");
	assert.equal(why("OldCom").code, "CAPABILITY_MISSING");
	assert.equal(why("Broken").code, "ONEC_BAD_RESPONSE");
	assert.equal(why("NotFound").code, "NOT_FOUND");
	assert.equal("onecHttpStatus" in why("Broken"), false, "в ERP уходят только код и текст");
	assert.equal(h.bodies.find((b) => b.baseKey === "Fine")!.catalog === null, false);
	// Журнал сервиса хранит ответ базы как есть.
	assert.equal(report.bases.find((b) => b.baseKey === "OldHttp")!.error?.code, "ONEC_BAD_RESPONSE");
});

test("1С не ответила на каталог или ответила не каталогом — отметка по каждой организации базы, одна на организацию", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [
			{ key: "Silent", organizations: [{ id: "o1", name: "А", bin: BIN_A }, { id: "o3", name: "В", bin: BIN_C }] },
			{ key: "Odd", organizations: [{ id: "o2", name: "Б", bin: BIN_B }] },
		] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_B]: { uuid: "b-uuid", name: "Б" }, [BIN_C]: { uuid: ORG_C, name: "В" } },
		reply: (c) => {
			if (c.baseKey === "Silent") return null; // так и не ответила: команда осталась у агента
			return { state: "done", result: { rows: [] } }; // не каталог
		},
		// ERP лежит на первой посылке: отметка — такая же посылка, повтор после сетевого сбоя и для неё.
		sink: (_b, attempt) => { if (attempt === 1) throw new ErpUnavailable("ERP не отвечает"); return {}; },
	});
	const report = await h.runner.run();
	const silent = h.bodies.filter((b) => b.baseKey === "Silent");
	assert.deepEqual(silent.map((b) => b.bin).sort(), [BIN_A, BIN_C].sort());
	for (const b of silent) {
		const why = unchecked(b);
		assert.equal(why.code, "NO_ANSWER");
		assert.equal(b.agentId, "ag-1");
		assert.ok(!Number.isNaN(Date.parse(b.startedAt)) && !Number.isNaN(Date.parse(b.finishedAt)));
	}
	assert.equal(unchecked(h.bodies.find((b) => b.baseKey === "Odd")!).code, "BAD_CATALOG");
	assert.equal(h.enqueued.length, 2, "по каждой базе — только запрос каталога");
	assert.deepEqual(report.forward, { ok: 3, failed: 0 });
	assert.equal(report.failures, 2);
});

test("сбой своей стороны на запросе каталога — тоже «база не проверена»: ERP не должна принять его за «находок нет»", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Dev_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
		reply: () => { throw new Error("очередь: соединение с базой потеряно"); },
	});
	const report = await h.runner.run();
	const why = unchecked(h.bodies[0]!);
	assert.equal(why.code, "INTERNAL");
	assert.match(why.message, /Сбой сервиса BuhProf AI/);
	assert.equal(report.bases[0]!.error?.code, "INTERNAL");
});

test("проверки базы идут один раз — с первой организацией; остальным организациям базы — только свои", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Multi", organizations: [
			{ id: "o1", name: "А", bin: BIN_A },
			{ id: "o3", name: "В", bin: BIN_C },
		] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_C]: { uuid: ORG_C, name: "В" } },
	});
	await h.runner.run();
	assert.deepEqual(h.bodies.map((b) => [b.bin, b.runs.filter((r) => r.scope === "base").length]), [[BIN_A, 1], [BIN_C, 0]]);
	assert.equal(h.enqueued.filter((c) => c.type === "LIST_ACCOUNTING_CHECKS").length, 1, "каталог — один на базу");
	assert.equal(h.enqueued.filter((c) => c.payload.check === "catalogs.duplicate_counterparties").length, 1);
});

test("сверх тарифа, лежащая база и БИН второй базы — не проверяются", async () => {
	const h = harness({
		agents: [agent("ag-1", { limits: { maxBases: 3, maxBins: null } })],
		bases: { "ag-1": [
			{ key: "Main", organizations: [{ id: "o1", name: "А", bin: BIN_A }] },
			// Копия основной базы: тот же БИН проверяется только в первой по порядку среза.
			{ key: "Copy", organizations: [{ id: "o1", name: "А", bin: BIN_A }] },
			{ key: "Down", status: "OFFLINE", organizations: [{ id: "o3", name: "В", bin: BIN_C }] },
			{ key: "OverLimit", organizations: [{ id: "o2", name: "Б", bin: BIN_B }] },
		] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_B]: { uuid: "b", name: "Б" }, [BIN_C]: { uuid: ORG_C, name: "В" } },
	});
	const report = await h.runner.run();
	assert.deepEqual([...new Set(h.enqueued.map((c) => c.baseKey))], ["Main"]);
	assert.deepEqual(report.skipped.basesOverLimit, ["OverLimit@ag-1"]);
	assert.deepEqual(report.skipped.basesOffline, ["Down@ag-1"]);
	assert.deepEqual(report.skipped.binsInOtherBase, [`${BIN_A}@Copy`]);
});

test("ручной запуск по одной базе — только она, даже если её БИН «принадлежит» другой базе", async () => {
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [
			{ key: "Main", organizations: [{ id: "o1", name: "А", bin: BIN_A }] },
			{ key: "Copy", organizations: [{ id: "o1", name: "А", bin: BIN_A }] },
		] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
	});
	await h.runner.run("copy");
	assert.deepEqual([...new Set(h.enqueued.map((c) => c.baseKey))], ["Copy"]);
});

// ── Кого проверяем: обслуживаемые фирмой (п. 10 реестра) ────────────────────

describe("отбор организаций: обслуживаемые фирмой, а пока обслуживание не настроено — все известные ERP", () => {
	const twoOrgs = {
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Multi", organizations: [{ id: "o3", name: "В", bin: BIN_C }, { id: "o1", name: "А", bin: BIN_A }] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" }, [BIN_C]: { uuid: ORG_C, name: "В" } },
	};

	it("список обслуживаемых не пуст — проверяются только они, и проверки базы достаются обслуживаемой", async () => {
		// Регистр uuid в ERP не должен решать, обслуживается ли организация.
		const h = harness({ ...twoOrgs, served: [ORG_A.toUpperCase(), "d0000000-0000-4000-8000-00000000000d"] });
		const report = await h.runner.run();
		assert.deepEqual(h.bodies.map((b) => b.bin), [BIN_A]);
		assert.ok(!h.enqueued.some((c) => c.payload.organizationBin === BIN_C), "по необслуживаемой организации в 1С не ходим");
		assert.deepEqual(report.skipped.binsNotServed, [BIN_C]);
		assert.equal(h.bodies[0]!.runs.filter((r) => r.scope === "base").length, 1, "справочники базы — обслуживаемой, хотя она вторая в срезе");
		assert.deepEqual(report.scope, { rule: "served", servedOrgs: 2, reason: report.scope!.reason });
		assert.ok(h.infos.some((i) => i.obj.rule === "served" && /только обслуживаемые/.test(i.msg)), "какое правило сработало — видно в логе");
	});

	it("обслуживаемых нет (стандарт не настроен) — все известные ERP, как до E17", async () => {
		const h = harness({ ...twoOrgs, served: [] });
		const report = await h.runner.run();
		assert.deepEqual(h.bodies.map((b) => b.bin), [BIN_C, BIN_A]);
		assert.deepEqual(report.skipped.binsNotServed, []);
		assert.equal(report.scope?.rule, "all");
		// Проверки базы — по-прежнему первой известной ERP.
		assert.deepEqual(h.bodies.map((b) => b.runs.filter((r) => r.scope === "base").length), [1, 0]);
		assert.ok(h.infos.some((i) => i.obj.rule === "all" && /не настроено/.test(i.msg)));
	});

	it("в базе ERP нет таблиц групп (схема старше E17) — все известные ERP с предупреждением; другой сбой — прогон не гадает", async () => {
		const old = harness({ ...twoOrgs, served: Object.assign(new Error('relation "staff_groups" does not exist'), { code: "42P01" }) });
		const report = await old.runner.run();
		assert.equal(report.scope?.rule, "all");
		assert.equal(old.bodies.length, 2);
		assert.ok(old.warnings.length > 0, "старая схема ERP — предупреждение в лог");

		const broken = harness({ ...twoOrgs, served: Object.assign(new Error("connection terminated"), { code: "57P01" }) });
		await assert.rejects(broken.runner.run(), /connection terminated/);
		assert.equal(broken.enqueued.length, 0, "без правила отбора — ни одной команды");
	});

	it("проверять некого — об обслуживании ERP не спрашиваем", async () => {
		const h = harness({ agents: [agent("ag-1")], bases: { "ag-1": [{ key: "Empty", organizations: [] }] }, served: [ORG_A] });
		const report = await h.runner.run();
		assert.equal(report.scope, null);
		assert.equal(h.erpSql.length, 0);
	});

	it("отметка «база не проверена» — тоже только по обслуживаемым", async () => {
		const h = harness({ ...twoOrgs, agents: [agent("old", { capabilities: ["HEALTH"] })], bases: { old: twoOrgs.bases["ag-1"] }, served: [ORG_C] });
		await h.runner.run();
		assert.deepEqual(h.bodies.map((b) => [b.bin, unchecked(b).code]), [[BIN_C, "CAPABILITY_MISSING"]]);
	});

	it("один БИН у двух живых организаций ERP — берётся обслуживаемая", async () => {
		const other = "e0000000-0000-4000-8000-00000000000e";
		const h = harness({
			agents: [agent("ag-1")],
			bases: { "ag-1": [{ key: "Dev_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }] },
			erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
			extraErpRows: [{ uuid: other, bin: BIN_A, name: "А (дубль)" }],
			served: [other],
		});
		const { targets } = await h.runner.collectTargets();
		assert.deepEqual(targets.map((t) => t.orgs.map((o) => [o.uuid, o.served])), [[[other, true]]]);
	});

	it("запрос обслуживаемых: группы без удалённых, связи — действующие и не истёкшие", () => {
		const sql = SERVED_ORGANIZATIONS_SQL.replace(/\s+/g, " ");
		assert.match(sql, /FROM staff_group_clients c JOIN staff_groups g ON g\.uuid = c\."groupUuid" AND g\."deletedAt" IS NULL/);
		assert.match(sql, /FROM service_links l WHERE l\.state = 'active' AND \(l\."validUntil" IS NULL OR l\."validUntil" > now\(\)\)/);
		assert.match(sql, /\bUNION\b/);
	});

	it("правило отбора — в сводке журнала, и «нечего проверять» говорит, среди кого искали", async () => {
		const h = harness({ ...twoOrgs, erpOrgs: {}, served: [ORG_A] });
		const started = await h.runner.start({ kind: "manual", userUuid: "u1" });
		assert.ok(started.ok);
		if (started.ok) await started.done;
		const t = h.finished[0]!.t as { summary: { scope: { rule: string } }; note: string | null };
		assert.equal(t.summary.scope.rule, "served");
		assert.match(t.note ?? "", /обслуживает фирма/);
	});
});

test("проверки базы — первой ОБСЛУЖИВАЕМОЙ организации, даже если в цели есть и другие", async () => {
	const h = harness({ agents: [agent("ag-1")], bases: {} });
	const report = await h.runner.runBase({
		agentId: "ag-1", agentOrganizationUuid: "org-owner", baseKey: "Multi", snapshots: false, blocked: null,
		orgs: [
			{ bin: BIN_C, uuid: ORG_C, name: "В", served: false },
			{ bin: BIN_A, uuid: ORG_A, name: "А", served: true },
		],
	});
	assert.deepEqual(h.bodies.map((b) => [b.bin, b.runs.filter((r) => r.scope === "base").map((r) => r.check)]), [
		[BIN_C, []],
		[BIN_A, ["catalogs.duplicate_counterparties"]],
	]);
	assert.equal(report.forwarded, 2);
});

test("ERP не приняла посылку — прогон не падает; сетевой сбой повторяется один раз", async () => {
	const refused = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Dev_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
		sink: () => { throw new ErpRefused(413, "ERP отказала (HTTP 413)"); },
	});
	const r1 = await refused.runner.run();
	assert.deepEqual(r1.forward, { ok: 0, failed: 1 });
	assert.ok(refused.warnings.length > 0, "отказ ERP виден в журнале службы");

	const flaky = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Dev_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
		sink: (_b, attempt) => { if (attempt === 1) throw new ErpUnavailable("ERP не отвечает"); return { created: 3 }; },
	});
	const r2 = await flaky.runner.run();
	assert.deepEqual(r2.forward, { ok: 1, failed: 0 });
});

// ── Тик и запуск ─────────────────────────────────────────────────────────────

test("тик: вне окна — нет, в окне — прогон фоном и отметка в журнале; второй тик той же ночи — нет", async () => {
	let now = local(2026, 9, 25, 2, 0);
	const base = { agents: [agent("ag-1")], bases: {}, cfg: {} };
	const h = harness(base);
	// Часы тика подменяем через замыкание: harness отдаёт now при создании, здесь — меняющиеся.
	(h.runner as unknown as { clock: () => Date }).clock = () => now;

	assert.equal(await h.runner.tick(), "not-due");
	now = local(2026, 9, 25, 2, 31);
	assert.equal(await h.runner.tick(), "started");
	assert.deepEqual(h.claims.map((c) => [c.kind, c.runDate, c.userUuid]), [["schedule", "2026-09-25", null]]);
	// Пока прогон идёт — тик ничего не делает; после — ночь уже отработана.
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(h.finished.length, 1);
	now = local(2026, 9, 25, 2, 45);
	assert.equal(await h.runner.tick(), "not-due");
	assert.equal(h.claims.length, 1);
});

test("тик: прогон этой ночи уже был (перезапуск сервиса) — журнал не даёт начать второй", async () => {
	const h = harness({ agents: [], bases: {}, claim: () => null });
	assert.equal(await h.runner.tick(), "already-ran");
	assert.equal(await h.runner.tick(), "not-due", "и в журнал больше не стучимся до следующей ночи");
	assert.equal(h.claims.length, 1);
});

test("тик: выключено — ничего; ERP не настроена — отказ один раз за ночь, а не каждую минуту", async () => {
	const off = harness({ agents: [], bases: {}, cfg: { enabled: false } });
	assert.equal(await off.runner.tick(), "disabled");
	assert.equal(off.claims.length, 0);

	const noErp = harness({ agents: [], bases: {}, sinkEnabled: false });
	assert.equal(await noErp.runner.tick(), "refused");
	assert.equal(await noErp.runner.tick(), "not-due");
	assert.equal(noErp.claims.length, 0, "без канала ERP прогон даже не занимается");
	assert.equal(noErp.warnings.length, 1);
});

test("второй запуск, пока идёт первый, — отказ с номером идущего", async () => {
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => { release = r; });
	const h = harness({
		agents: [agent("ag-1")],
		bases: { "ag-1": [{ key: "Dev_01", organizations: [{ id: "o1", name: "А", bin: BIN_A }] }] },
		erpOrgs: { [BIN_A]: { uuid: ORG_A, name: "А" } },
	});
	// Каталог «думает», пока тест не отпустит.
	const q = (h.runner as unknown as { d: { queue: { waitResult: (id: string, ms: number) => Promise<unknown> } } }).d.queue;
	const original = q.waitResult;
	q.waitResult = async (id: string, ms: number) => { await gate; return original(id, ms); };

	const first = await h.runner.start({ kind: "manual", userUuid: "u1" });
	assert.equal(first.ok, true);
	const second = await h.runner.start({ kind: "manual", userUuid: "u2" });
	assert.equal(second.ok, false);
	assert.equal(!second.ok && second.code, "RUN_IN_PROGRESS");
	assert.equal(!second.ok && second.runId, first.ok ? first.runId : "");
	assert.equal(h.runner.running?.kind, "manual");
	release();
	if (first.ok) await first.done;
	assert.equal(h.runner.running, null);
	assert.equal(h.finished.length, 1);
});

// ── Журнал: SQL ──────────────────────────────────────────────────────────────

test("журнал: плановый прогон занимается с защитой от второго за ночь, ручной — всегда новой строкой", async () => {
	const sqls: string[] = [];
	const store = new AccountingCheckRunStore({ query: (async (sql: string) => { sqls.push(sql); return { rows: [{ id: "x" }], rowCount: 1 }; }) as never });
	await store.claim({ kind: "schedule", runDate: "2026-09-25", userUuid: null });
	await store.claim({ kind: "manual", runDate: "2026-09-25", userUuid: "u1" });
	assert.match(sqls[0]!, /ON CONFLICT \(run_date\) WHERE kind = 'schedule' DO NOTHING/);
	assert.doesNotMatch(sqls[1]!, /ON CONFLICT/);
});

test("срок хранения: команды проверок удаляются через 14 дней, остальные — по общему сроку", async () => {
	const calls: { sql: string; p: unknown[] }[] = [];
	await purgeOldData({ query: async (sql: string, p: unknown[]) => { calls.push({ sql, p }); return { rowCount: 0, rows: [] }; } } as never, 180);
	const checks = calls.find((c) => c.sql.includes("type = ANY"))!;
	assert.ok(checks, "отдельное удаление команд проверок");
	assert.deepEqual(checks.p, [["LIST_ACCOUNTING_CHECKS", "RUN_ACCOUNTING_CHECK", "GET_ACCOUNTING_SNAPSHOT"], "14 days"]);
});

// ── Маршруты оператора ───────────────────────────────────────────────────────

const JWT_SECRET = "test-secret";
const USER = "11111111-1111-1111-1111-111111111111";

/** ERP для loadErpUser: суперадмин или пользователь с правом «Администрирование 1С» нужного уровня. */
const erpDb = (who: { superAdmin?: boolean; full?: number; any?: number }) => ({
	query: async (sql: string) => {
		if (sql.includes("FROM users")) return { rows: [{ uuid: USER, is_super_admin: !!who.superAdmin, organization_uuid: "org-1" }], rowCount: 1 };
		if (sql.includes("FROM access_rights")) return { rows: [{ organization_uuid: "org-1", role: "admin" }], rowCount: 1 };
		if (sql.includes("count(*) FILTER")) return { rows: [{ full: String(who.full ?? 0), any: String(who.any ?? 0) }], rowCount: 1 };
		return { rows: [], rowCount: 0 };
	},
});

async function routes(who: { superAdmin?: boolean; full?: number; any?: number }, scope: "all" | "organizations" = "all") {
	const started: { kind: string; userUuid: string | null; baseKey?: string | null }[] = [];
	const audited: unknown[] = [];
	const runner = {
		running: null,
		start: async (o: { kind: "manual"; userUuid: string | null; baseKey?: string | null }) => {
			started.push(o);
			return { ok: true as const, runId: "run-1", done: Promise.resolve(null) };
		},
	};
	const app = express();
	app.use(express.json());
	app.use("/v1/onec/accounting-checks", accountingChecksRouter({
		erp: erpDb(who) as never, cfg: { JWT_SECRET, ONEC_SERVER_SCOPE: scope }, runner: runner as never,
		store: { list: async () => [{ id: "run-0", kind: "schedule" }] as never }, audit: { write: async (e) => { audited.push(e); } }, log: silent,
	}));
	const srv = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(0, () => ok(s)); });
	const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/onec/accounting-checks`;
	const token = jwt.sign({ uuid: USER }, JWT_SECRET);
	const call = async (method: string, path: string, body?: unknown) => {
		const r = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
		return { status: r.status, body: await r.json() as { success: boolean; data?: any; error?: { code: string; message: string } } };
	};
	return { call, started, audited, close: () => srv.close() };
}

test("маршруты: запуск с полным доступом — 202 и номер прогона; только просмотр — журнал да, запуск нет", async () => {
	const full = await routes({ full: 1, any: 1 });
	try {
		const r = await full.call("POST", "/run", { baseKey: " Dev_01 " });
		assert.equal(r.status, 202);
		assert.equal(r.body.data.runId, "run-1");
		assert.deepEqual(full.started, [{ kind: "manual", userUuid: USER, baseKey: "Dev_01" }]);
		assert.equal(full.audited.length, 1, "кто запустил прогон по базам клиентов — в журнале действий");
	} finally { full.close(); }

	const ro = await routes({ full: 0, any: 1 });
	try {
		const runs = await ro.call("GET", "/runs");
		assert.equal(runs.status, 200);
		assert.equal(runs.body.data.items[0].id, "run-0");
		const r = await ro.call("POST", "/run", {});
		assert.equal(r.status, 403);
		assert.equal(r.body.error!.code, "FORBIDDEN_READONLY");
		assert.equal(ro.started.length, 0);
	} finally { ro.close(); }
});

test("маршруты: без права «Администрирование 1С» — нет; в многоклиентской установке — только администратору BuhProf", async () => {
	const none = await routes({ full: 0, any: 0 });
	try {
		assert.equal((await none.call("GET", "/runs")).status, 403);
	} finally { none.close(); }

	const tenant = await routes({ full: 1, any: 1 }, "organizations");
	try {
		const r = await tenant.call("POST", "/run", {});
		assert.equal(r.status, 403, "прогон идёт по базам всех клиентов — клиенту его не запустить");
		assert.equal(tenant.started.length, 0);
	} finally { tenant.close(); }

	const owner = await routes({ superAdmin: true }, "organizations");
	try {
		assert.equal((await owner.call("POST", "/run", {})).status, 202);
	} finally { owner.close(); }
});
