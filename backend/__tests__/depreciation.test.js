import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDepreciationEntries } from "../services/depreciation.js";

// Мок-клиент: fixedAssetAcceptance.findMany отдаёт заданные акты (как будто БД уже
// отфильтровала по posted/deletedAt/сроку); accountingEntryAnalytic.findMany
// возвращает накопленную амортизацию по objectUuid (для расчёта остатка).
function mockClient({ acceptances = [], accumulated = {} } = {}) {
	return {
		fixedAssetAcceptance: { findMany: async () => acceptances },
		accountingEntryAnalytic: {
			findMany: async ({ where }) => {
				const amt = accumulated[where.objectUuid] || 0;
				return amt > 0 ? [{ entry: { amount: amt } }] : [];
			},
		},
	};
}

const asset = (over = {}) => ({
	fixedAssetUuid: "fa-1",
	initialCost: 1200,
	liquidationValue: 0,
	usefulLifeMonths: 12,
	depreciationStartDate: "2026-01-15T00:00:00.000Z",
	depreciationAccount: "7210",
	accumulatedAccount: "2420",
	...over,
});

test("линейно: месяц ПОСЛЕ ввода → 1/срок базы", async () => {
	const client = mockClient({ acceptances: [asset()] });
	const out = await computeDepreciationEntries(client, "org-1", "2026-02-01", "2026-02-28");
	assert.equal(out.length, 1);
	assert.deepEqual(out[0], { fixedAssetUuid: "fa-1", amount: 100, debitAccount: "7210", creditAccount: "2420" });
});

test("в МЕСЯЦ ввода амортизация не начисляется", async () => {
	const client = mockClient({ acceptances: [asset()] });
	const out = await computeDepreciationEntries(client, "org-1", "2026-01-01", "2026-01-31");
	assert.equal(out.length, 0);
});

test("ликвидационная стоимость уменьшает базу", async () => {
	const client = mockClient({ acceptances: [asset({ liquidationValue: 200, usefulLifeMonths: 10 })] });
	const out = await computeDepreciationEntries(client, "org-1", "2026-02-01", "2026-02-28");
	assert.equal(out[0].amount, 100); // (1200-200)/10
});

test("остаток ограничивает начисление (конец срока)", async () => {
	const client = mockClient({ acceptances: [asset()], accumulated: { "fa-1": 1150 } });
	const out = await computeDepreciationEntries(client, "org-1", "2026-02-01", "2026-02-28");
	assert.equal(out[0].amount, 50); // осталось 1200-1150
});

test("полностью самортизировано → нет начисления", async () => {
	const client = mockClient({ acceptances: [asset()], accumulated: { "fa-1": 1200 } });
	const out = await computeDepreciationEntries(client, "org-1", "2026-02-01", "2026-02-28");
	assert.equal(out.length, 0);
});

test("многомесячный период начисляет за каждый месяц", async () => {
	const client = mockClient({ acceptances: [asset({ depreciationStartDate: "2025-11-10T00:00:00.000Z" })] });
	const out = await computeDepreciationEntries(client, "org-1", "2026-01-01", "2026-03-31");
	assert.equal(out[0].amount, 300); // 3 мес × 100
});

test("без orgUuid → пусто", async () => {
	const client = mockClient({ acceptances: [asset()] });
	const out = await computeDepreciationEntries(client, null, "2026-02-01", "2026-02-28");
	assert.equal(out.length, 0);
});
