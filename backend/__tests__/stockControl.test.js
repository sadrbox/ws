// Контроль остатка по хронологии (У4 аудита 26.09) и закрытие резерва реализацией — на
// мок-клиенте, без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	computeStockChangeShortages,
	computeShortages,
	assertStockAfterChange,
	StockShortageError,
} from "../services/productRegister.js";
import { reservedQuantities } from "../services/reservationRegister.js";

const D = (s) => new Date(`${s}T12:00:00+05:00`);
let n = 0;
const reg = (documentType, documentUuid, movementType, quantity, date, extra = {}) => ({
	id: ++n, documentType, documentUuid, documentId: n, movementType, quantity, date: D(date),
	productUuid: "p", warehouseUuid: "w", ...extra,
});

// Мини-исполнитель where для productRegister (только нужные условия).
function match(r, w) {
	for (const [k, v] of Object.entries(w ?? {})) {
		if (k === "NOT") { if (match(r, v)) return false; continue; }
		if (k === "OR") { if (!v.some((x) => match(r, x))) return false; continue; }
		if (v && typeof v === "object" && !(v instanceof Date)) {
			if ("in" in v && !v.in.includes(r[k])) return false;
			if ("lt" in v && !(r[k] < v.lt)) return false;
			if ("gte" in v && !(r[k] >= v.gte)) return false;
			continue;
		}
		if (r[k] !== v) return false;
	}
	return true;
}

function mockClient({ register = [], services = [], reservations = [], soldOnReservations = [], stockControl = true } = {}) {
	return {
		productRegister: {
			findMany: async ({ where }) => register.filter((r) => match(r, where)),
			groupBy: async ({ where }) => {
				const g = new Map();
				for (const r of register.filter((x) => match(x, where))) {
					const k = `${r.productUuid}|${r.warehouseUuid}|${r.movementType}`;
					const cur = g.get(k) ?? { productUuid: r.productUuid, warehouseUuid: r.warehouseUuid, movementType: r.movementType, _sum: { quantity: 0 } };
					cur._sum.quantity += r.quantity;
					g.set(k, cur);
				}
				return [...g.values()];
			},
		},
		product: {
			findMany: async ({ where }) => {
				if (where.isService) return services.filter((u) => where.uuid.in.includes(u)).map((uuid) => ({ uuid }));
				return where.uuid.in.map((uuid) => ({ uuid, name: `Товар ${uuid}`, sku: "" }));
			},
		},
		warehouse: { findMany: async ({ where }) => where.uuid.in.map((uuid) => ({ uuid, name: `Склад ${uuid}` })) },
		reservationRegister: {
			groupBy: async ({ where }) => reservations
				.filter((r) => where.productUuid.in.includes(r.productUuid) && (!where.NOT || r.reservationUuid !== where.NOT.reservationUuid))
				.map((r) => ({ ...r, _sum: { quantity: r.quantity } })),
		},
		saleItem: { findMany: async () => soldOnReservations },
		organizationAccountingSetting: { findFirst: async () => ({ stockControl }) },
	};
}

const sale = (date, qty, extra = {}) => ({
	doc: { uuid: "sale-new", id: 900, posted: true, warehouseUuid: "w", date: D(date), organizationUuid: "o", ...extra },
	items: [{ productUuid: "p", quantity: qty }],
});

test("реализация задним числом ДО поступления товара — дефицит (раньше проходила)", async () => {
	const client = mockClient({ register: [reg("purchase", "pur-1", "in", 10, "2026-06-10")] });
	const { doc, items } = sale("2026-06-05", 5);
	const sh = await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", doc, items }, client);
	assert.equal(sh.length, 1);
	assert.equal(sh[0].requested, 5);
	assert.equal(sh[0].available, 0);
	assert.equal(sh[0].kind, "out");
});

test("реализация после поступления — проходит", async () => {
	const client = mockClient({ register: [reg("purchase", "pur-1", "in", 10, "2026-06-10")] });
	const { doc, items } = sale("2026-06-12", 5);
	assert.deepEqual(await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", doc, items }, client), []);
});

test("поступление и реализация в один момент — приход раньше расхода, проходит", async () => {
	const client = mockClient({ register: [reg("purchase", "pur-1", "in", 10, "2026-06-10")] });
	const { doc, items } = sale("2026-06-10", 10);
	assert.deepEqual(await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", doc, items }, client), []);
});

test("расход сейчас, но позже уже продано — остаток в будущем уходил бы в минус", async () => {
	const client = mockClient({
		register: [reg("purchase", "pur-1", "in", 10, "2026-06-01"), reg("sale", "s-2", "out", 8, "2026-06-20")],
	});
	const { doc, items } = sale("2026-06-10", 5); // 10 − 5 − 8 = −3 на 20.06
	const sh = await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", doc, items }, client);
	assert.equal(sh.length, 1);
	assert.equal(sh[0].deficit, 3);
	assert.equal(sh[0].available, 2);
});

test("распроведение прихода, из которого уже продано, — отказ (раньше не проверялось)", async () => {
	const client = mockClient({
		register: [reg("purchase", "pur-1", "in", 10, "2026-06-01"), reg("sale", "s-2", "out", 6, "2026-06-05")],
	});
	await assert.rejects(
		() => assertStockAfterChange("purchase", "pur-1", { posted: false }, {
			...client,
			purchase: { findUnique: async () => ({ uuid: "pur-1", id: 1, posted: true, warehouseUuid: "w", date: D("2026-06-01"), organizationUuid: "o" }) },
			purchaseItem: { findMany: async () => [{ productUuid: "p", quantity: 10 }] },
		}),
		(e) => e instanceof StockShortageError && e.shortages[0].kind === "inflow" && /без этого прихода/.test(e.message),
	);
});

test("старый «провал» остатка, к которому изменение не причастно, не блокирует", async () => {
	// Легаси: продали 15 при приходе 10 (контроль был выключен) → −5 после 20.06.
	const client = mockClient({
		register: [
			reg("purchase", "pur-1", "in", 10, "2026-06-01"),
			reg("sale", "s-old", "out", 15, "2026-06-20"),
			reg("sale", "sale-new", "out", 2, "2026-06-25", { documentId: 900 }),
		],
	});
	// Перепроведение продажи 25.06 без изменений — пара не меняется, проверки нет.
	const { doc, items } = sale("2026-06-25", 2);
	assert.deepEqual(await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", doc, items }, client), []);
	// Уменьшение количества — только улучшает, тоже проходит.
	const less = sale("2026-06-25", 1);
	assert.deepEqual(await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", doc: less.doc, items: less.items }, client), []);
});

test("услуги склад не двигают и не проверяются (строка «Доставка»)", async () => {
	const client = mockClient({ register: [], services: ["p"] });
	const { doc, items } = sale("2026-06-10", 1);
	assert.deepEqual(await computeShortages({ documentType: "sale", doc, items }, client), []);
});

test("резерв: реализация на его основании проводится, чужая — видит резерв; после отгрузки резерв закрыт", async () => {
	const register = [reg("purchase", "pur-1", "in", 5, "2026-06-01")];
	const reservations = [{ reservationUuid: "res-1", productUuid: "p", warehouseUuid: "w", quantity: 4 }];
	// 1) Реализация на основании резерва на 4 — свой резерв исключён.
	const own = sale("2026-06-10", 4, { basisDocumentType: "reservation", basisDocumentUuid: "res-1" });
	assert.deepEqual(await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", ...own }, mockClient({ register, reservations })), []);
	// 2) Другая реализация на 2 при активном резерве 4 — доступно 1.
	const other = sale("2026-06-10", 2);
	const sh = await computeStockChangeShortages({ documentType: "sale", documentUuid: "sale-new", ...other }, mockClient({ register, reservations }));
	assert.equal(sh.length, 1);
	assert.equal(sh[0].available, 1);
	// 3) Резерв отгружен реализацией на его основании — активный остаток резерва 0.
	const sold = [{ productUuid: "p", quantity: 4, sale: { basisDocumentUuid: "res-1", warehouseUuid: "w" } }];
	const m = await reservedQuantities([{ productUuid: "p", warehouseUuid: "w" }], null, mockClient({ reservations, soldOnReservations: sold }));
	assert.equal(m.get("p|w"), 0);
});

test("контроль остатков выключен у организации — минус разрешён", async () => {
	const client = mockClient({ register: [], stockControl: false });
	await assert.doesNotReject(() => assertStockAfterChange("sale", "sale-new", { posted: true }, {
		...client,
		sale: { findUnique: async () => ({ uuid: "sale-new", id: 900, posted: false, warehouseUuid: "w", date: D("2026-06-10"), organizationUuid: "o" }) },
		saleItem: { findMany: async () => [{ productUuid: "p", quantity: 3 }] },
	}));
});
