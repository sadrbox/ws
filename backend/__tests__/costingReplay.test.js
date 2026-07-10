import { test } from "node:test";
import assert from "node:assert/strict";
import { replayProductCosting } from "../services/costingReplay.js";

const COST_IN = new Set(["purchase", "goods_receipt", "import_declaration", "sale_return", "inventory_transfer"]);
const d = (s) => new Date(s);
// helper движения
const mv = (date, type, qty, amount, documentType = "purchase", warehouseUuid = "W1") =>
	({ date: d(date), movementType: type, quantity: qty, amount, documentType, warehouseUuid });

test("FIFO: расход списывает старейшие слои", () => {
	const movements = [
		mv("2026-01-01", "in", 5, 500),   // 100/шт
		mv("2026-01-02", "in", 5, 1000),  // 200/шт
		mv("2026-01-03", "out", 7, 0, "write_off"), // 5×100 + 2×200 = 900
	];
	const r = replayProductCosting(movements, { method: "FIFO", costBearingInDocs: COST_IN });
	assert.equal(r.cogsOut, 900);
	assert.equal(r.closeQty, 3);
	assert.equal(r.closeAmount, 600); // остались 3×200
});

test("AVERAGE: расход по скользящей средней", () => {
	const movements = [
		mv("2026-01-01", "in", 5, 500),   // avg 100
		mv("2026-01-02", "in", 5, 1000),  // avg (500+1000)/10 = 150
		mv("2026-01-03", "out", 7, 0, "write_off"), // 7×150 = 1050
	];
	const r = replayProductCosting(movements, { method: "AVERAGE", costBearingInDocs: COST_IN });
	assert.equal(r.cogsOut, 1050);
	assert.equal(r.closeQty, 3);
	assert.equal(r.closeAmount, 450);
});

test("реализация: выручка из amount, COGS из метода; прибыль сходится", () => {
	const movements = [
		mv("2026-01-01", "in", 10, 1000, "purchase"), // 100/шт
		mv("2026-01-05", "out", 4, 600, "sale"),      // выручка 600, COGS 400
	];
	const r = replayProductCosting(movements, { method: "FIFO", costBearingInDocs: COST_IN });
	assert.equal(r.salesRevenue, 600);
	assert.equal(r.salesCogs, 400);
	assert.equal(r.salesRevenue - r.salesCogs, 200);
});

test("себестоимость ведётся ПО СКЛАДУ (расход с дорогого склада ≠ с дешёвого)", () => {
	const movements = [
		mv("2026-01-01", "in", 5, 500, "purchase", "W1"),   // W1: 100/шт
		mv("2026-01-01", "in", 5, 1500, "purchase", "W2"),  // W2: 300/шт
		mv("2026-01-02", "out", 5, 0, "write_off", "W2"),   // списываем с W2 → 1500
	];
	const r = replayProductCosting(movements, { method: "FIFO", costBearingInDocs: COST_IN });
	assert.equal(r.cogsOut, 1500, "списание с W2 берёт стоимость W2, а не среднюю по складам");
	assert.equal(r.closeQty, 5); // остался W1
	assert.equal(r.closeAmount, 500);
});

test("начальный остаток = состояние перед первым движением периода", () => {
	const movements = [
		mv("2026-01-01", "in", 10, 1000, "purchase"), // до периода
		mv("2026-02-10", "out", 3, 0, "write_off"),   // в периоде
	];
	const r = replayProductCosting(movements, { method: "AVERAGE", from: d("2026-02-01"), costBearingInDocs: COST_IN });
	assert.equal(r.openQty, 10);
	assert.equal(r.openAmount, 1000);
	assert.equal(r.inQty, 0, "приход до периода не входит в оборот периода");
	assert.equal(r.outQty, 3);
	assert.equal(r.cogsOut, 300);
	assert.equal(r.closeQty, 7);
});

test("нехватка слоёв не роняет (остаток по средней/0)", () => {
	const movements = [
		mv("2026-01-01", "in", 2, 200, "purchase"),
		mv("2026-01-02", "out", 5, 0, "write_off"), // просят 5, есть 2
	];
	const r = replayProductCosting(movements, { method: "FIFO", costBearingInDocs: COST_IN });
	assert.equal(r.cogsOut, 200, "списана стоимость доступных 2 шт; недостающие 3 по avg=0");
	assert.equal(r.closeQty, -3);
});

test("перемещение переносит себестоимость между складами", () => {
	const movements = [
		mv("2026-01-01", "in", 10, 1000, "purchase", "W1"),        // W1: 100/шт
		mv("2026-01-02", "out", 4, 400, "inventory_transfer", "W1"), // −4 с W1 (cost 400)
		mv("2026-01-02", "in", 4, 400, "inventory_transfer", "W2"),  // +4 на W2 по 100
		mv("2026-01-03", "out", 4, 0, "write_off", "W2"),            // списываем с W2 → 400
	];
	const r = replayProductCosting(movements, { method: "FIFO", costBearingInDocs: COST_IN });
	// W1: 6 шт × 100 = 600; W2: 0. cogsOut = transfer 400 + write_off 400 = 800.
	assert.equal(r.closeQty, 6);
	assert.equal(r.closeAmount, 600);
	assert.equal(r.cogsOut, 800);
});
