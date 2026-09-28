// P3 аудита 27.09 (учёт): общие округления money.js вместо местных и год номера документа в
// поясе учёта. Headless, без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateImportLandedCost } from "../services/importLandedCost.js";
import { replayProductCosting } from "../services/costingReplay.js";
import { assertUniqueNumber } from "../utils/uniqueNumber.js";
import { yearBounds } from "../services/periodBounds.js";

test("P3: landed cost ГТД — «половинка» тийына не теряется (1.005 → 1.01)", () => {
	const m = allocateImportLandedCost({ dutyAmount: 1.005 }, [{ uuid: "a", amount: 100, quantity: 1 }], true);
	assert.equal(m.get("a").capitalized, 1.01);
	assert.equal(m.get("a").landed, 101.01);
});

test("P3: движок себестоимости отчётов — деньги по money.js, количества — 3 знака", () => {
	const res = replayProductCosting([
		{ date: new Date("2026-09-01"), movementType: "in", quantity: 1.0005, amount: 1.005, documentType: "purchase", warehouseUuid: "w" },
	], { method: "AVERAGE", costBearingInDocs: new Set(["purchase"]) });
	assert.equal(res.inAmount, 1.01, "1.005 → 1.01, а не 1.00");
	assert.equal(res.inQty, 1.001, "количество — 3 знака");
});

test("P3: уникальность номера — год и его границы в поясе учёта, а не сервера", async () => {
	const prevTz = process.env.TZ;
	const prevAcc = process.env.ACCOUNTING_TIME_ZONE;
	try {
		process.env.TZ = "UTC"; // сервер не в поясе учёта
		process.env.ACCOUNTING_TIME_ZONE = "Asia/Almaty";
		let where = null;
		const client = { sale: { findFirst: async (args) => { where = args.where; return null; } } };
		// 01.01.2027 01:00 по Алматы = 31.12.2026 20:00 UTC.
		await assertUniqueNumber("sale", { number: "5", date: new Date("2026-12-31T20:00:00.000Z"), organizationUuid: "o" }, client);
		const { start, end } = yearBounds(2027, "Asia/Almaty");
		assert.equal(where.date.gte.toISOString(), start.toISOString(), "год документа — 2027 по поясу учёта");
		assert.equal(where.date.lt.toISOString(), end.toISOString());
	} finally {
		if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
		if (prevAcc === undefined) delete process.env.ACCOUNTING_TIME_ZONE; else process.env.ACCOUNTING_TIME_ZONE = prevAcc;
	}
});
