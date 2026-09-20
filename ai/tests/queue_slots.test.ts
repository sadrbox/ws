/**
 * Очередь команд: место базы, сроки, повторы — аудит 14.09, С1–С6, С10–С12, С14.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CommandQueue, BUSY_MAX_ATTEMPTS, BUSY_RETRY_DELAYS_SECS, RETRY_LATER_CODES, RUNNING_LEASE_CAP_SECS, runningLeaseSecs } from "../src/commands/queue.ts";
import { findAdminCommand, marksReachability, runsInsideBase, validateSchedulePayload } from "../src/commands/admin.ts";
import { isDestructive } from "../src/onec/access.ts";
import { ibFailureReason } from "../src/bases/service.ts";
import { humanizeAgentError } from "../src/onec/errorHints.ts";
import type { Db } from "../src/db/pool.ts";

type Call = { sql: string; params: unknown[] };
const fakeDb = (calls: Call[], rows: unknown[] = []): Db => ({
	query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows, rowCount: rows.length }; },
	connect: async () => { throw new Error("не нужен"); },
}) as unknown as Db;

describe("С1: место базы — только у команд внутрь базы", () => {
	it("кластерные команды с базой внутрь базы не идут", () => {
		for (const t of ["CLUSTER_TERMINATE_SESSION", "CLUSTER_SET_SESSIONS_LOCK", "CLUSTER_DROP_INFOBASE", "CLUSTER_DISCONNECT"]) {
			assert.equal(runsInsideBase(findAdminCommand(t)!), false, t);
		}
		assert.equal(runsInsideBase(findAdminCommand("IB_RESTORE")!), true);
	});

	it("постановка записывает признак и срок выполнения отдельно от ожидания очереди (С2)", async () => {
		const calls: Call[] = [];
		await new CommandQueue(fakeDb(calls, [{ id: "cmd_1" }])).enqueue({
			agentId: "a", organizationUuid: "o", baseKey: "b", type: "CLUSTER_TERMINATE_SESSION", payload: {},
			ttlSeconds: 900, queueWaitSeconds: 43200, inBase: false,
		});
		const ins = calls.find((c) => c.sql.includes("INSERT INTO commands"))!;
		assert.match(ins.sql, /in_base, ttl_seconds/);
		assert.equal(ins.params[9], "43200");
		assert.equal(ins.params[11], false);
		assert.equal(ins.params[12], 900);
	});

	it("выдача: место по признаку, срок — от выдачи, истёкшая без ответа держит место (С3)", async () => {
		const calls: Call[] = [];
		await new CommandQueue(fakeDb(calls), 1, 600).take("a", 0);
		const sql = calls.map((c) => c.sql).join("\n");
		assert.match(sql, /COALESCE\(d\.in_base, d\.base_key IS NOT NULL\)/);
		assert.match(sql, /PARTITION BY CASE WHEN COALESCE\(c\.in_base/);
		assert.match(sql, /make_interval\(secs => ttl_seconds\)/);
		assert.match(sql, /d\.state = 'expired' AND d\.dispatched_at IS NOT NULL AND d\.result_status IS NULL/);
		assert.ok(calls.some((c) => c.params.includes(600)), "запас передан");
		assert.match(sql, /COMMAND_QUEUE_TIMEOUT/);
		assert.match(sql, /c\.available_at IS NULL OR c\.available_at <= now\(\)/);
		// TIMEOUT держит место, пока процесс команды жив (С18).
		assert.match(sql, /d\.error->>'code' = 'TIMEOUT'/);
		assert.match(sql, /pr->>'commandId' = d\.id/);
	});
});

describe("С10–С11: повтор при занятой базе и конец ожидания", () => {
	it("повтор — копия в том же задании с ограничением попыток и отметкой исходной", async () => {
		const calls: Call[] = [];
		const id = await new CommandQueue(fakeDb(calls, [{ id: "cmd_new", agent_id: "a" }])).retryBusy("cmd_old", 43200);
		assert.equal(id, "cmd_new");
		assert.match(calls[0].sql, /batch_id IS NOT NULL/);
		assert.match(calls[0].sql, /retried_by IS NULL AND attempt < \$3/);
		assert.match(calls[0].sql, /UPDATE commands SET retried_by = \$2/);
		assert.equal(calls[0].params[2], BUSY_MAX_ATTEMPTS);
		// Пауза перед повтором (С19): не выдавать раньше available_at, срок очереди — от конца паузы.
		assert.match(calls[0].sql, /attempt, available_at\)/);
		assert.deepEqual(calls[0].params.slice(4), [...BUSY_RETRY_DELAYS_SECS]);
	});

	it("отменённая команда — конец ожидания, без лишних секунд", async () => {
		const q = new CommandQueue(fakeDb([], [{ id: "c", state: "canceled" }]));
		const t0 = Date.now();
		const row = await q.waitResult("c", 5000);
		assert.equal(row?.state, "canceled");
		assert.ok(Date.now() - t0 < 1000);
	});
});

describe("С4–С6, С12, С14", () => {
	it("С4: проверка с «Исправлять» — только полному доступу", () => {
		assert.equal(isDestructive("POST", "/bases/b/check", { repair: true }), true);
		assert.equal(isDestructive("POST", "/bases/b/check", { repair: false }), false);
		assert.equal(isDestructive("POST", "/bases/b/check"), false);
	});

	it("С5: сухой прогон отметку «в базу не войти» не меняет", () => {
		const restore = findAdminCommand("IB_RESTORE")!;
		assert.equal(marksReachability(restore, { baseKey: "b", dryRun: true }), false);
		assert.equal(marksReachability(restore, { baseKey: "b" }), true);
		assert.equal(marksReachability(findAdminCommand("CLUSTER_SET_SESSIONS_LOCK")!, { baseKey: "b" }), false);
	});

	it("С6: отказ входа по коду — NO_ACCESS", () => {
		assert.equal(ibFailureReason({ code: "IB_AUTH_FAILED", message: "Authentication failed" }), "NO_ACCESS");
	});

	it("С12: расписание без секретов и по схеме команды", () => {
		assert.match(validateSchedulePayload("IB_BACKUP", { password: "x" }, "b") ?? "", /password/);
		assert.equal(validateSchedulePayload("IB_BACKUP", { dir: "D:\\backup" }, "b"), null);
		assert.match(validateSchedulePayload("IB_CHECK", { unknownField: 1 }, "b") ?? "", /^payload:/);
	});

	it("С14: публикация принимает apache22", () => {
		const r = findAdminCommand("IB_PUBLISH")!.schema.safeParse({ baseKey: "b", webServer: "apache22" });
		assert.equal(r.success, true);
	});

	it("С13: у кода TIMEOUT есть подсказка", () => {
		assert.match(humanizeAgentError({ code: "TIMEOUT", message: "превышено время" })!.message, /пределу времени/);
	});
});

describe("С21: поздний результат отмечается", () => {
	it("приём результата ставит late, если команда уже истекла", async () => {
		const calls: Call[] = [];
		await new CommandQueue(fakeDb(calls, [{ id: "c", base_key: null, late: true }]))
			.complete("a", { commandId: "c", agentId: "a", status: "SUCCESS", result: {} });
		assert.match(calls[0].sql, /late = late OR state = 'expired'/);
	});
});

describe("С33: продление срока выполняемых команд", () => {
	it("запас — три интервала heartbeat, не меньше 90 с и не больше 15 мин", () => {
		const now = Date.parse("2026-09-15T18:00:00Z");
		assert.equal(runningLeaseSecs(new Date(now - 30_000), now), 90);
		assert.equal(runningLeaseSecs(new Date(now - 60_000), now), 180);
		assert.equal(runningLeaseSecs(new Date(now - 3_600_000), now), 900);
		assert.equal(runningLeaseSecs(null, now), 90);
	});
	it("продлеваются только выданные команды этого агента, не дальше потолка от выдачи", async () => {
		const calls: Call[] = [];
		const n = await new CommandQueue(fakeDb(calls, [{ id: "cmd_1" }]))
			.extendRunning("a", [{ commandId: "cmd_1", startedAt: "2026-09-15T17:00:00Z" }, { commandId: "cmd_2", startedAt: "мусор" }], 90);
		assert.equal(n, 1);
		assert.match(calls[0].sql, /c\.agent_id = \$1 AND c\.state = 'dispatched'/);
		assert.match(calls[0].sql, /LEAST\(GREATEST\(c\.expires_at/);
		assert.equal(calls[0].params[3], RUNNING_LEASE_CAP_SECS);
		assert.deepEqual(calls[0].params[4], ["2026-09-15T17:00:00.000Z", null]);
		assert.equal(await new CommandQueue(fakeDb([], [])).extendRunning("a", [], 90), 0);
	});
	it("С25: IB_TIMEOUT повторяется в задании", () => {
		assert.equal(RETRY_LATER_CODES.has("IB_TIMEOUT"), true);
	});
});

describe("предел внутрибазовых команд по роли агента (19.09)", () => {
	it("переданный предел заменяет общий: бизнес-агент берёт столько баз сразу, сколько ему задано", async () => {
		const slotsOf = async (parallel?: number) => {
			const calls: Call[] = [];
			await new CommandQueue(fakeDb(calls, [{ n: "1" }]), 1, 600).take("a", 0, null, parallel);
			const upd = calls.find((c) => c.sql.includes("ib_rank <= $2"))!;
			return upd.params[1];
		};
		assert.equal(await slotsOf(), 0, "общий предел 1, одна уже выполняется — мест нет");
		assert.equal(await slotsOf(4), 3, "у бизнес-агента 4 — осталось 3");
	});
});
