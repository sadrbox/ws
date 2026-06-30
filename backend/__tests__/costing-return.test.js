import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUnitCost } from "../services/accountingPosting.js";

const D = (s) => new Date(s);
const r2 = (n) => Math.round(n * 100) / 100;

// Мок с учётом фильтра по дате (date.lte) и типу движения.
function mock(method, rows) {
  return {
    organizationAccountingSetting: { findFirst: async () => ({ costingMethod: method }) },
    productRegister: {
      findMany: async ({ where }) => {
        let out = rows.slice();
        if (where.movementType === "in") out = out.filter((r) => r.movementType === "in");
        else if (where.movementType === "out") out = out.filter((r) => r.movementType === "out");
        const lte = where.date?.lte;
        if (lte) out = out.filter((r) => new Date(r.date).getTime() <= new Date(lte).getTime());
        return out;
      },
    },
  };
}
const IN = (q, amt, date, id) => ({ quantity: q, amount: amt, date: D(date), id, documentId: id, movementType: "in" });
const OUT = (q, date, id) => ({ quantity: q, amount: 0, date: D(date), id, documentId: id, movementType: "out" });

// D1 приход 10@100; D2 продажа 10 (вся партия-1); D3 приход 10@120; возврат 3.
const rows = () => [IN(10, 1000, "2026-06-01", 1), OUT(10, "2026-06-02", 2), IN(10, 1200, "2026-06-03", 3)];

test("ФИФО: возврат по себестоимости на дату ПРОДАЖИ = 100 (верно)", async () => {
  const u = await resolveUnitCost("o", "p", "w", D("2026-06-02"), 3, mock("FIFO", rows()));
  assert.equal(r2(u), 100);
});

test("ФИФО: на дату ВОЗВРАТА было бы 120 — искажение, которое устраняем", async () => {
  const u = await resolveUnitCost("o", "p", "w", D("2026-06-04"), 3, mock("FIFO", rows()));
  assert.equal(r2(u), 120);
});
