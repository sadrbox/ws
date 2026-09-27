/**
 * Регрессия аудита 26.09 (И10): офлайн-подсказки поля выбора учитывают поиск и фильтры.
 */
import { describe, it, expect, vi } from "vitest";

const RECORDS = [
	{ uuid: "c1", id: 1, name: "Договор Рога", organizationUuid: "org-A" },
	{ uuid: "c2", id: 2, name: "Договор Копыта", organizationUuid: "org-A" },
	{ uuid: "c3", id: 3, name: "Договор Рога", organizationUuid: "org-B" },
];
vi.mock("src/services/networkStatus", () => ({ getIsOnline: () => false }));
vi.mock("src/services/api/client", () => ({ default: { get: vi.fn() } }));
vi.mock("src/services/offlineDb", () => ({
	offlineDb: {},
	SYNCABLE_TABLES: ["contracts", "sales", "counterparties"],
	upsertRecords: vi.fn(),
	getRecordByUuid: vi.fn(),
	addPendingChange: vi.fn(async () => { await Promise.resolve(); return 1; }),
	countActiveRecords: vi.fn(async () => { await Promise.resolve(); return RECORDS.length; }),
	getActiveRecords: vi.fn(async (_t: string, o?: { limit?: number; offset?: number }) => { await Promise.resolve();
		const off = o?.offset ?? 0;
		return RECORDS.slice(off, off + (o?.limit ?? RECORDS.length));
	}),
	searchRecords: vi.fn(async (_t: string, q: string) => { await Promise.resolve(); return RECORDS.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())); }),
}));

import { fetchList, createRecord, OfflineWriteRefusedError } from "src/services/offlineDataService";
import { addPendingChange } from "src/services/offlineDb";
import { isNetworkError } from "src/services/networkUtils";

describe("fetchList офлайн (И10)", () => {
	it("поиск и организация из параметров запроса применяются к кэшу", async () => {
		const r = await fetchList("contracts", undefined, { search: "Рога", limit: 10, organizationUuid: "org-A" });
		expect(r.items.map((i) => (i as { uuid: string }).uuid)).toEqual(["c1"]);
		expect(r.fromCache).toBe(true);
	});
	it("быстрый выбор без поиска — только своя организация", async () => {
		const r = await fetchList("contracts", undefined, { limit: 200, organizationUuid: "org-B" });
		expect(r.items.map((i) => (i as { uuid: string }).uuid)).toEqual(["c3"]);
	});
});

describe("Запись без связи (Б1 → frontend)", () => {
	it("документ офлайн не «сохраняется локально», а даёт сетевую ошибку", async () => {
		await expect(createRecord("sales", { number: "1" })).rejects.toBeInstanceOf(OfflineWriteRefusedError);
		await createRecord("sales", { number: "1" }).catch((e: unknown) => { expect(isNetworkError(e)).toBe(true); });
		expect(addPendingChange).not.toHaveBeenCalled();
	});
	it("справочник офлайн ставится в очередь обмена", async () => {
		const r = await createRecord("counterparties", { name: "Рога" });
		expect(r.offline).toBe(true);
		expect(addPendingChange).toHaveBeenCalledTimes(1);
	});
});
