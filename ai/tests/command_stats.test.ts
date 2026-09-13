/**
 * S5 из docs/TASKS_ONEC_FIXES_2026-09-13.md: отказы и время команд из heartbeat.
 *
 * Держим три вещи: снимок формы из контракта агента принимается; кривое поле отбрасывается,
 * не роняя остального (heartbeat из-за диагностики не должен стать 400); поле, которого нет,
 * прежний снимок не затирает — старая сборка шлёт только часть.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommandStats } from "../src/agents/commandStats.ts";
import { AgentService } from "../src/agents/service.ts";
import type { Db } from "../src/db/pool.ts";

type Call = { sql: string; params: unknown[] };

function fakeDb(calls: Call[], rows: unknown[] = []): Db {
	return {
		query: async (sql: string, params: unknown[] = []) => {
			calls.push({ sql, params });
			return { rows, rowCount: rows.length };
		},
		connect: async () => { throw new Error("не нужен"); },
	} as unknown as Db;
}

// Форма из контракта агента (сборка 13.09 15:21).
const contract = {
	failuresByCode: { IB_BUSY: 87, IB_AUTH_FAILED: 3 },
	durationsByType: {
		IB_LIST_USERS: {
			count: 42, avgMs: 28150, maxMs: 61200, p95LeSecs: 60,
			buckets: { le1s: 0, le5s: 2, le15s: 5, le60s: 34, le300s: 1, over300s: 0 },
		},
		CLUSTER_LIST_SESSIONS: { count: 5, avgMs: 900, maxMs: 1400, p95LeSecs: null, buckets: {} },
	},
};

test("снимок из контракта агента принимается целиком", () => {
	const r = parseCommandStats(contract);
	assert.deepEqual(r.rejected, []);
	assert.equal(r.stats?.failuresByCode?.IB_BUSY, 87);
	assert.equal(r.stats?.durationsByType?.IB_LIST_USERS.avgMs, 28150);
	assert.equal(r.stats?.durationsByType?.CLUSTER_LIST_SESSIONS.p95LeSecs, null);
});

test("старая сборка без полей — снимка нет, затирать нечего", () => {
	assert.deepEqual(parseCommandStats({}), { stats: null, rejected: [] });
});

test("кривое поле отбрасывается и называется, остальное принимается", () => {
	const r = parseCommandStats({
		failuresByCode: { IB_BUSY: 87 },
		durationsByType: { IB_LIST_USERS: { count: "много", avgMs: 1 } },
	});
	assert.deepEqual(r.rejected, ["durationsByType"]);
	assert.deepEqual(r.stats, { failuresByCode: { IB_BUSY: 87 } });
	assert.deepEqual(parseCommandStats({ failuresByCode: { IB_BUSY: -1 } }).rejected, ["failuresByCode"]);
});

test("запись снимка не затирает поле, которого в нём нет", async () => {
	const calls: Call[] = [];
	await new AgentService(fakeDb(calls), 90).setCommandStats("agent-1", { failuresByCode: { IB_BUSY: 1 } });
	const upd = calls.find((c) => c.sql.includes("command_stats_seen_at"));
	assert.ok(upd);
	assert.match(upd.sql, /durations_by_type = COALESCE\(\$3::jsonb, durations_by_type\)/);
	assert.deepEqual(upd.params, ["agent-1", JSON.stringify({ IB_BUSY: 1 }), null]);
});

test("представление агента: снимок есть — отдаётся, не было — null", async () => {
	const base = { id: "a", organization_uuid: "o", role: "admin", name: "Сервер 1С", capabilities: [], status: "ONLINE", created_at: new Date() };
	const views = await new AgentService(fakeDb([], [
		{ ...base, failures_by_code: contract.failuresByCode, durations_by_type: contract.durationsByType, command_stats_seen_at: new Date("2026-09-13T10:00:00Z") },
		{ ...base, id: "b", failures_by_code: null, durations_by_type: null, command_stats_seen_at: null },
	]), 90).listAll();
	assert.equal(views[0].commandStats?.failuresByCode.IB_BUSY, 87);
	assert.equal(views[0].commandStats?.durationsByType.IB_LIST_USERS.count, 42);
	assert.equal(views[1].commandStats, null);
});
