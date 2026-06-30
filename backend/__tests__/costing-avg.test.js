// Юнит-тесты себестоимости на МОК-клиенте (без БД) — прогоняют реальную
// resolveUnitCost из services/accountingPosting.js. Безопасны для прод-БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUnitCost } from "../services/accountingPosting.js";

const D = (s) => new Date(s);
const r2 = (n) => Math.round(n * 100) / 100;

// Мок Prisma: метод учёта организации + строки регистра товаров.
function mock(method, rows) {
	return {
		organizationAccountingSetting: { findFirst: async () => ({ costingMethod: method }) },
		productRegister: {
			findMany: async ({ where }) => {
				if (where.movementType === "in") return rows.filter((r) => r.movementType === "in");
				if (where.movementType === "out") return rows.filter((r) => r.movementType === "out");
				return rows; // avgCost (скользящая) запрашивает все типы движений
			},
		},
	};
}

const IN = (q, amt, date, id) => ({ quantity: q, amount: amt, date: D(date), id, documentId: id, movementType: "in" });
const OUT = (q, amt, date, id) => ({ quantity: q, amount: amt, date: D(date), id, documentId: id, movementType: "out" });

const unit = (method, rows, qty, dateUpTo) => resolveUnitCost("o", "p", "w", dateUpTo, qty, mock(method, rows));

test("Средняя: накопление приходов — (1000+650)/15 = 110", async () => {
	const u = await unit("AVERAGE", [IN(10, 1000, "2026-06-01", 1), IN(5, 650, "2026-06-02", 2)], 8, D("2026-06-03"));
	assert.equal(r2(u), 110);
});

test("Скользящая: продал→докупил пересчитывает среднюю (10@100 → −10 → 10@200 = 200)", async () => {
	// out.amount=1500 это ВЫРУЧКА — должна игнорироваться (COGS считается по средней).
	const rows = [IN(10, 1000, "2026-06-01", 1), OUT(10, 1500, "2026-06-02", 2), IN(10, 2000, "2026-06-03", 3)];
	const u = await unit("AVERAGE", rows, 1, D("2026-06-04"));
	assert.equal(r2(u), 200);
});

test("Скользящая: расход не меняет среднюю до следующего прихода", async () => {
	// 10@100 → продажа 4 → средняя для следующей продажи всё ещё 100.
	const rows = [IN(10, 1000, "2026-06-01", 1), OUT(4, 999, "2026-06-02", 2)];
	const u = await unit("AVERAGE", rows, 3, D("2026-06-03"));
	assert.equal(r2(u), 100);
});

test("Средняя: только приход (регресс, без расходов) = цена прихода", async () => {
	const u = await unit("AVERAGE", [IN(10, 1000, "2026-06-01", 1)], 5, D("2026-06-02"));
	assert.equal(r2(u), 100);
});

test("FIFO не задет: 15 из 10@100 + 10@120 → эффективная 1600/15", async () => {
	const u = await unit("FIFO", [IN(10, 1000, "2026-06-01", 1), IN(10, 1200, "2026-06-02", 2)], 15, D("2026-06-03"));
	assert.equal(r2(u * 15), 1600);
});

test("Себестоимость не отрицательна при продаже сверх остатка (ФИФО)", async () => {
	const u = await unit("FIFO", [IN(10, 1000, "2026-06-01", 1)], 15, D("2026-06-03"));
	assert.equal(r2(u * 15), 1000); // списана только доступная стоимость, недостаток = 0
});
