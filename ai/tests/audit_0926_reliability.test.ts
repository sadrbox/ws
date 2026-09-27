/**
 * НАДЁЖНОСТЬ СЕРВИСА ИИ — ИСПРАВЛЕНИЯ АУДИТА 26.09 (Н9 и P3 отчётов очереди и ERP).
 *
 *   — расписание обслуживания занимает окно ДО постановки задания: сбой посреди постановки не повторяет выгрузку
 *     каждую минуту окна, а исключение одного расписания не останавливает остальные;
 *   — служебный канал ERP отличает «не ответила вовремя» (запрос мог быть принят — не повторять) от обрыва
 *     соединения; зависшее тело ответа тоже ограничено сроком.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { runDueSchedules } from "../src/onec/maintenanceRunner.ts";
import { ErpTasks, ErpTimeout, ErpUnavailable } from "../src/erp/tasks.ts";
import type { Logger } from "../src/logger.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

/** Расписание «каждый день в 02:00» и хранилище, которое помнит занятое окно, как настоящее (claimRun). */
function schedulesStore(list: { id: string; name: string }[]) {
	const lastRun = new Map<string, string | null>(list.map((s) => [s.id, null]));
	const claims: string[] = [];
	return {
		claims,
		store: {
			enabled: async () => list.map((s) => ({
				id: s.id, organizationUuid: "org", userUuid: null, name: s.name, type: "IB_BACKUP", baseKeys: ["Бух"],
				payload: { dir: "D:\\dump" }, serverId: null, atTime: "02:00", weekdays: [], enabled: true, lastRunAt: lastRun.get(s.id) ?? null, lastBatchId: null,
			})),
			claimRun: async (id: string, seen: string | null) => {
				if ((lastRun.get(id) ?? null) !== seen) return false;
				lastRun.set(id, "2026-09-14T02:00:30.000Z");
				claims.push(id);
				return true;
			},
			markRun: async () => {},
		},
	};
}

test("Н9: сбой посреди постановки — окно уже занято: следующая минута окна задание не повторяет", async () => {
	const { store, claims } = schedulesStore([{ id: "s1", name: "Выгрузка" }, { id: "s2", name: "Проверка" }]);
	let creates = 0;
	const deps = {
		agents: { pickAdminAgent: async () => ({ id: "adm", organizationUuid: "org", role: "admin", disabled: false, online: true, serverId: "srv", capabilities: ["ib.admin", "cluster.admin"], version: "2026-09-19" }) },
		queue: { enqueue: async () => { throw new Error("БД недоступна"); } },
		batches: { create: async () => { creates++; return `batch-${creates}`; }, attach: async () => {}, noteSkipped: async () => {} },
		bases: { findByKeyGlobal: async (key: string) => ({ key, disabled: false, clusterStatus: "ONLINE", status: "ONLINE" }) },
		schedules: store, audit: { write: async () => {} }, log: silent,
	};
	const at = new Date("2026-09-14T02:00:00");
	const first = await runDueSchedules(deps as never, at);
	assert.deepEqual(first, { started: 0, failed: 2 }, "исключение первого расписания не остановило второе");
	assert.deepEqual(claims, ["s1", "s2"]);
	const next = await runDueSchedules(deps as never, new Date("2026-09-14T02:01:00"));
	assert.deepEqual(next, { started: 0, failed: 0 }, "через минуту окно уже занято — IB_BACKUP по кругу не идёт");
	assert.equal(creates, 2);
});

test("Н9: два тика разом — окно получает только один", async () => {
	const { store, claims } = schedulesStore([{ id: "s1", name: "Выгрузка" }]);
	const deps = {
		agents: { pickAdminAgent: async () => ({ id: "adm", organizationUuid: "org", role: "admin", disabled: false, online: true, serverId: "srv", capabilities: ["ib.admin", "cluster.admin"], version: "2026-09-19" }) },
		queue: { enqueue: async () => ({ id: "cmd" }) },
		batches: { create: async () => "batch", attach: async () => {}, noteSkipped: async () => {} },
		bases: { findByKeyGlobal: async (key: string) => ({ key, disabled: false, clusterStatus: "ONLINE", status: "ONLINE" }) },
		schedules: store, audit: { write: async () => {} }, log: silent,
	};
	const at = new Date("2026-09-14T02:00:00");
	const [a, b] = await Promise.all([runDueSchedules(deps as never, at), runDueSchedules(deps as never, at)]);
	assert.equal(a.started + b.started, 1);
	assert.equal(claims.length, 1);
});

/** Сервер ERP, который молчит: не отвечает вовсе или шлёт заголовки и замолкает посреди тела. */
async function stallingErp(mode: "no-answer" | "stalled-body" | "down") {
	const server = http.createServer((_req, res) => {
		if (mode === "stalled-body") {
			res.writeHead(200, { "content-type": "application/json" });
			res.write('{"success": true, "da');
		}
		// no-answer: держим соединение и ничего не пишем.
	});
	await new Promise<void>((ok) => server.listen(0, ok));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	if (mode === "down") await new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); });
	return { url, close: () => { server.closeAllConnections(); server.close(); } };
}

test("Н9: ERP не ответила вовремя — ErpTimeout (не повторять); обрыв соединения — просто «недоступна»", async () => {
	const silentErp = await stallingErp("no-answer");
	const stalled = await stallingErp("stalled-body");
	const down = await stallingErp("down");
	try {
		const t1 = new ErpTasks({ url: silentErp.url, key: "k", timeoutMs: 200, log: silent });
		await assert.rejects(t1.statuses(), (e: unknown) => e instanceof ErpTimeout);
		// Тело, зависшее после заголовков, раньше ждали без предела — ночной прогон «шёл» до перезапуска.
		const t2 = new ErpTasks({ url: stalled.url, key: "k", timeoutMs: 200, log: silent });
		const started = Date.now();
		await assert.rejects(t2.statuses(), (e: unknown) => e instanceof ErpTimeout);
		assert.ok(Date.now() - started < 3000);
		const t3 = new ErpTasks({ url: down.url, key: "k", timeoutMs: 200, log: silent });
		await assert.rejects(t3.statuses(), (e: unknown) => e instanceof ErpUnavailable && !(e instanceof ErpTimeout));
	} finally { silentErp.close(); stalled.close(); }
});
