/**
 * Состояние сервера, журнал, «агент устарел», самопроверка и кто держит очередь —
 * R1–R5 (docs/TASKS_DEV_2026-09-14.md).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agentBuild, buildOutdated, missingFeatures } from "../src/agents/features.ts";
import { mergeDurationStats } from "../src/agents/commandStats.ts";
import { buildAdminPayload, commandRequestId, findAdminCommand } from "../src/commands/admin.ts";
import { isDestructive } from "../src/onec/access.ts";

describe("R3: сборка агента и её отставание", () => {
	it("сборка разбирается из версии агента и из эталона", () => {
		assert.equal(agentBuild("0.1.0+2026-09-14 23:16 (+05)"), "2026-09-14 23:16");
		assert.equal(agentBuild("0.1.0"), null);
		assert.equal(buildOutdated("0.1.0+2026-09-14 01:35 (+05)", "2026-09-14 23:16"), true);
		assert.equal(buildOutdated("0.1.0+2026-09-14 23:16 (+05)", "2026-09-14 23:16"), false);
		// Эталон не задан или сборка не разобрана — сравнивать не с чем.
		assert.equal(buildOutdated("0.1.0+2026-09-14 01:35 (+05)", undefined), null);
		assert.equal(buildOutdated("0.1.0", "2026-09-14 23:16"), null);
	});

	it("недостающее — только у админ-агента и по способностям", () => {
		const old = { role: "admin", capabilities: ["cluster.admin", "ib.admin", "CLUSTER_LIST_INFOBASES"], commandStats: null };
		assert.deepEqual(missingFeatures(old), ["abort", "roles", "commandStats", "health", "log", "selftest"]);
		const fresh = {
			role: "admin",
			capabilities: ["agent.cancel", "ib.roles", "AGENT_HEALTH", "AGENT_LOG_TAIL", "IB_SELFTEST"],
			commandStats: { durationsByType: {} },
		};
		assert.deepEqual(missingFeatures(fresh), []);
		assert.deepEqual(missingFeatures({ ...old, role: "business" }), []);
	});
});

describe("R1, R2, R4: служебные команды агента", () => {
	it("журнал: параметры по схеме, ключ склейки — с параметрами", () => {
		const spec = findAdminCommand("AGENT_LOG_TAIL")!;
		assert.equal(buildAdminPayload(spec, { lines: 500, level: "problems", contains: "IB_BUSY" }).ok, true);
		assert.equal(buildAdminPayload(spec, { lines: 0 }).ok, false);
		assert.equal(buildAdminPayload(spec, { lines: Number("abc") }).ok, false);
		assert.equal(buildAdminPayload(spec, { level: "debug" }).ok, false);
		assert.notEqual(
			commandRequestId(spec, { lines: 200 }, null),
			commandRequestId(spec, { lines: 1000 }, null),
		);
	});

	it("состояние — чтение без базы; самопроверка — запись в базу и только полному доступу", () => {
		const health = findAdminCommand("AGENT_HEALTH")!;
		assert.equal(health.operation, "READ");
		assert.equal(health.requiresBase, false);
		const selftest = findAdminCommand("IB_SELFTEST")!;
		assert.equal(selftest.operation, "WRITE");
		assert.equal(buildAdminPayload(selftest, { baseKey: "_transition" }).ok, true);
		// Сухого прогона у самопроверки нет (контракт агента 23:16).
		assert.equal(buildAdminPayload(selftest, { baseKey: "_transition", dryRun: true }).ok, false);
		assert.equal(isDestructive("POST", "/bases/_transition/selftest"), true);
		assert.equal(isDestructive("GET", "/agents/a1/health"), false);
	});
});

describe("R5: время по типам сводно по агентам", () => {
	it("среднее — взвешенное, максимум — общий, корзина — худшая", () => {
		const merged = mergeDurationStats([
			{ IB_LIST_USERS: { count: 1, avgMs: 1000, maxMs: 1000, p95LeSecs: 1, buckets: {} } },
			{ IB_LIST_USERS: { count: 3, avgMs: 3000, maxMs: 9000, p95LeSecs: 15, buckets: {} } },
			null,
			{ IB_CHECK: { count: 1, avgMs: 400000, maxMs: 400000, p95LeSecs: null, buckets: {} } },
		]);
		assert.deepEqual(merged.IB_LIST_USERS, { count: 4, avgMs: 2500, maxMs: 9000, p95LeSecs: 15 });
		assert.equal(merged.IB_CHECK.p95LeSecs, null);
	});
});
