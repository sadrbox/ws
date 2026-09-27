/**
 * Обмен /sync/push после Б1: сервер принимает только справочники. Отклонённые изменения
 * (SYNC_PUSH_REFUSED) и изменения таблиц, которые обмен не принимает, не повторяются при
 * каждом обмене и не теряются молча — пользователю сообщается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const pending = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
const { update, remove, post, notify } = vi.hoisted(() => ({
	update: vi.fn(async () => { await Promise.resolve(); return 1; }),
	remove: vi.fn(async () => { }),
	post: vi.fn(),
	notify: vi.fn(() => ""),
}));
vi.mock("src/services/networkStatus", () => ({ getIsOnline: () => true }));
vi.mock("src/services/api/client", () => ({ default: { post, get: vi.fn() } }));
vi.mock("src/components/TechMessages/store", () => ({ notify }));
vi.mock("src/services/offlineDb", () => ({
	offlineDb: { _pendingChanges: { update } },
	SYNCABLE_TABLES: ["counterparties", "sales"],
	ensureOfflineDb: vi.fn(),
	getLastSyncAt: vi.fn(async () => { await Promise.resolve(); return null; }),
	setLastSyncAt: vi.fn(async () => { }),
	getAllPendingChanges: vi.fn(async () => { await Promise.resolve(); return pending.list; }),
	removePendingChange: remove,
	upsertRecords: vi.fn(async () => { }),
	addPendingChange: vi.fn(),
	getRecordByUuid: vi.fn(),
	getActiveRecords: vi.fn(async () => { await Promise.resolve(); return []; }),
	countActiveRecords: vi.fn(async () => { await Promise.resolve(); return 0; }),
	searchRecords: vi.fn(async () => { await Promise.resolve(); return []; }),
}));

import { fullSync } from "src/services/syncManager";

const pullOk = { data: { success: true, serverTime: "2026-09-26T00:00:00.000Z", data: {} } };

beforeEach(() => { update.mockClear(); remove.mockClear(); post.mockReset(); notify.mockClear(); });

describe("syncManager: отказы /sync/push", () => {
	it("документ из очереди не отправляется, помечается отклонённым и о нём сообщается", async () => {
		pending.list = [
			{ id: 1, table: "sales", uuid: "s1", action: "create", data: {}, clientUpdatedAt: "x", createdAt: "x" },
			{ id: 2, table: "counterparties", uuid: "c1", action: "create", data: {}, clientUpdatedAt: "x", createdAt: "x" },
		];
		post.mockImplementation(async (url: string, body: { changes?: Array<{ table: string }> }) => { await Promise.resolve();
			if (url === "/sync/push") {
				expect(body.changes?.map((c) => c.table)).toEqual(["counterparties"]);
				return { data: { success: true, applied: 1, conflicts: [], errors: [] } };
			}
			return pullOk;
		});
		const r = await fullSync();
		expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ refused: expect.any(String) as string }));
		expect(remove).toHaveBeenCalledWith(2);
		expect(remove).not.toHaveBeenCalledWith(1);
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ severity: "error" }));
		expect(r.errors.map((e) => e.code)).toEqual(["SYNC_PUSH_REFUSED"]);
	});

	it("SYNC_PUSH_REFUSED от сервера — изменение помечается и больше не отправляется", async () => {
		pending.list = [
			{ id: 3, table: "counterparties", uuid: "c2", action: "update", data: {}, clientUpdatedAt: "x", createdAt: "x" },
			{ id: 4, table: "counterparties", uuid: "c3", action: "update", data: {}, clientUpdatedAt: "x", createdAt: "x" },
		];
		post.mockImplementation((url: string) => Promise.resolve(url === "/sync/push"
			? { data: { success: true, applied: 1, conflicts: [], errors: [{ table: "counterparties", uuid: "c2", code: "SYNC_PUSH_REFUSED", error: "нет прав" }] } }
			: pullOk));
		await fullSync();
		expect(update).toHaveBeenCalledWith(3, { refused: "нет прав" });
		expect(remove).toHaveBeenCalledWith(4);
		expect(remove).not.toHaveBeenCalledWith(3);
		expect(notify).toHaveBeenCalled();

		// Следующий обмен: отклонённое уже помечено — не отправляется.
		pending.list = [{ ...pending.list[0], refused: "нет прав" }];
		post.mockClear();
		post.mockImplementation(async () => { await Promise.resolve(); return pullOk; });
		await fullSync();
		expect(post.mock.calls.some((c) => c[0] === "/sync/push")).toBe(false);
	});
});
