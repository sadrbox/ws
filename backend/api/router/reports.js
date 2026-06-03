import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";

const router = express.Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildDocWhere(req, { dateFrom, dateTo, organizationUuid } = {}) {
	const where = { posted: true, ...tenantFilter(req) };
	if (dateFrom || dateTo) {
		where.date = {};
		if (dateFrom) where.date.gte = new Date(dateFrom);
		if (dateTo) where.date.lte = new Date(dateTo + "T23:59:59.999Z");
	}
	if (organizationUuid) where.organizationUuid = organizationUuid;
	return where;
}

// ─── GET /reports/sales-by-product ───────────────────────────────────────────
// Params: dateFrom, dateTo, organizationUuid, counterpartyUuid
router.get("/reports/sales-by-product", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, counterpartyUuid } = req.query;

		const saleWhere = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });
		if (counterpartyUuid) saleWhere.counterpartyUuid = counterpartyUuid;

		const sales = await prisma.sale.findMany({
			where: saleWhere,
			select: { uuid: true, organization: { select: { name: true } } },
		});

		const saleUuids = sales.map((s) => s.uuid);
		const orgName = organizationUuid
			? (sales.find((s) => s.organization)?.organization?.name ?? "")
			: "";

		if (saleUuids.length === 0) return res.json({ success: true, items: [], orgName });

		const items = await prisma.saleItem.findMany({
			where: { saleUuid: { in: saleUuids }, deletedAt: null },
			include: {
				product: { select: { uuid: true, name: true } },
				unitOfMeasure: { select: { name: true } },
			},
			orderBy: { id: "asc" },
		});

		const map = new Map();
		for (const item of items) {
			const key = item.productUuid ?? "__no_product__";
			if (!map.has(key)) {
				map.set(key, {
					productUuid: item.productUuid,
					productName: item.product?.name ?? "—",
					uom: item.unitOfMeasure?.name ?? "",
					qtySale: 0, qtyReturn: 0, amountSale: 0, amountReturn: 0,
					exciseAmountSale: 0, vatAmountSale: 0, amountNoTaxSale: 0,
				});
			}
			const row = map.get(key);
			row.qtySale += Number(item.quantity);
			row.amountSale += Number(item.amount);
			row.exciseAmountSale += Number(item.exciseAmount);
			row.vatAmountSale += Number(item.vatAmount);
			row.amountNoTaxSale += Number(item.amountWithoutVat);
		}

		const rows = Array.from(map.values())
			.map((r) => ({
				...r,
				qtySale: Math.round(r.qtySale * 10000) / 10000,
				qtyNet: Math.round((r.qtySale - r.qtyReturn) * 10000) / 10000,
				amountSale: Math.round(r.amountSale * 100) / 100,
				amountNet: Math.round((r.amountSale - r.amountReturn) * 100) / 100,
				exciseAmountSale: Math.round(r.exciseAmountSale * 100) / 100,
				vatAmountSale: Math.round(r.vatAmountSale * 100) / 100,
				amountNoTaxSale: Math.round(r.amountNoTaxSale * 100) / 100,
				costNoVat: 0,
				profit: 0,
			}))
			.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

		return res.json({ success: true, items: rows, orgName });
	} catch (err) {
		console.error("GET /reports/sales-by-product error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/material-statement ─────────────────────────────────────────
// Материальная ведомость по средневзвешенной (скользящей) себестоимости.
// Источник — регистр накопления product_register (только проведённые документы).
//
// Метод: перпетуальная средневзвешенная. По каждому товару движения
// обрабатываются хронологически; средняя себестоимость единицы пересчитывается
// при каждом ПОСТУПЛЕНИИ (purchase), а любой расход списывается по текущей
// средней и НЕ меняет её. Возвраты и перемещения тоже двигают остаток
// (по текущей средней), но не формируют выручку/прибыль.
//
//   Себестоимость(ед.)  = Сумма закупок ÷ Кол-во закупок (нарастающим итогом)
//   Себестоимость расхода = Кол-во расхода × Себестоимость(на момент)
//   Сумма продажи        = Σ amount строк реализаций (выручка)
//   Прибыль              = Сумма продажи − Себестоимость проданного
//
// Params: dateFrom, dateTo, organizationUuid, warehouseUuid
const INVENTORY_ACCOUNT_CODE = "1330"; // ТМЗ (товары) — типовой счёт учёта РК
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

router.get("/reports/material-statement", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, warehouseUuid } = req.query;

		// Фильтр регистра: tenant + явная орг/склад. Дата — до конца dateTo
		// включительно (движения после периода не загружаем; начальный остаток
		// формируется движениями ДО dateFrom).
		const where = { ...tenantFilter(req) };
		if (organizationUuid) where.organizationUuid = organizationUuid;
		if (warehouseUuid) where.warehouseUuid = warehouseUuid;
		if (dateTo) where.date = { lte: new Date(dateTo + "T23:59:59.999Z") };

		const movements = await prisma.productRegister.findMany({
			where,
			include: {
				product: { select: { uuid: true, name: true, sku: true } },
				unitOfMeasure: { select: { name: true } },
			},
			orderBy: [{ date: "asc" }, { id: "asc" }],
		});

		const from = dateFrom ? new Date(dateFrom) : null;

		// Группируем движения по товару (порядок внутри группы сохраняется).
		const byProduct = new Map();
		for (const mv of movements) {
			const key = mv.productUuid ?? "__no_product__";
			if (!byProduct.has(key)) byProduct.set(key, []);
			byProduct.get(key).push(mv);
		}

		const items = [];
		for (const mvs of byProduct.values()) {
			let qty = 0;      // текущий остаток, кол-во
			let value = 0;    // текущий остаток, сумма по себестоимости
			let avg = 0;      // текущая средневзвешенная себестоимость единицы
			let openQty = 0, openAmount = 0, openCaptured = !from;

			const p = {
				inQty: 0, inAmount: 0,           // приход (все поступающие движения, по себестоимости)
				outQty: 0, cogsOut: 0,           // расход (все исходящие движения, по себестоимости)
				salesQty: 0, salesRevenue: 0, salesCogs: 0, // только реализации
			};

			let product = null, uom = "";
			for (const mv of mvs) {
				if (!product && mv.product) product = mv.product;
				if (!uom && mv.unitOfMeasure?.name) uom = mv.unitOfMeasure.name;

				// Начальный остаток = состояние перед первым движением периода.
				if (!openCaptured && from && mv.date >= from) {
					openQty = qty; openAmount = value; openCaptured = true;
				}
				const inPeriod = !from || mv.date >= from;
				const q = Number(mv.quantity) || 0;
				const amt = Number(mv.amount) || 0;

				if (mv.movementType === "in") {
					// Поступление задаёт себестоимость; прочий приход (возврат от
					// покупателя, перемещение «в») приходуется по текущей средней.
					const addCost = mv.documentType === "purchase" ? amt : (avg > 0 ? q * avg : amt);
					qty += q;
					value += addCost;
					if (qty > 0) avg = value / qty;
					if (inPeriod) { p.inQty += q; p.inAmount += addCost; }
				} else {
					// Расход списывается по текущей средней и не меняет её.
					const outCost = avg > 0 ? q * avg : 0;
					qty -= q;
					value -= outCost;
					if (qty > 0) avg = value / qty;
					else value = Math.max(value, 0);
					if (inPeriod) {
						p.outQty += q;
						p.cogsOut += outCost;
						if (mv.documentType === "sale") {
							p.salesQty += q;
							p.salesRevenue += amt;
							p.salesCogs += outCost;
						}
					}
				}
			}
			if (!openCaptured) { openQty = qty; openAmount = value; }

			const closeQty = qty;
			const closeAmount = Math.max(value, 0);
			const hasActivity =
				openQty || openAmount || closeQty || closeAmount ||
				p.inQty || p.outQty || p.salesRevenue;
			if (!hasActivity) continue;

			items.push({
				productUuid: product?.uuid ?? null,
				productName: product?.name ?? "—",
				sku: product?.sku ?? "",
				accountCode: INVENTORY_ACCOUNT_CODE,
				uom,
				unitCost: r2(avg),
				openQty: r3(openQty),
				openAmount: r2(openAmount),
				inQty: r3(p.inQty),
				inAmount: r2(p.inAmount),
				outQty: r3(p.outQty),
				cogsOut: r2(p.cogsOut),
				salePrice: r2(p.salesQty > 0 ? p.salesRevenue / p.salesQty : 0),
				saleAmount: r2(p.salesRevenue),
				profit: r2(p.salesRevenue - p.salesCogs),
				closeQty: r3(closeQty),
				closeAmount: r2(closeAmount),
			});
		}

		items.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

		return res.json({ success: true, items });
	} catch (err) {
		console.error("GET /reports/material-statement error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/product-movements ──────────────────────────────────────────
// Детализация приход/расход по конкретному товару (только проведённые).
// Params: productUuid, dateFrom, dateTo, organizationUuid
router.get("/reports/product-movements", async (req, res) => {
	try {
		const { productUuid, dateFrom, dateTo, organizationUuid } = req.query;
		if (!productUuid) return res.status(400).json({ success: false, message: "productUuid обязателен" });

		const docWhere = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });

		const [purchases, sales] = await Promise.all([
			prisma.purchase.findMany({
				where: docWhere,
				select: { uuid: true, id: true, date: true, counterparty: { select: { name: true } } },
			}),
			prisma.sale.findMany({
				where: docWhere,
				select: { uuid: true, id: true, date: true, counterparty: { select: { name: true } } },
			}),
		]);

		const purchaseMap = new Map(purchases.map((d) => [d.uuid, d]));
		const saleMap = new Map(sales.map((d) => [d.uuid, d]));

		const [purchaseItems, saleItems] = await Promise.all([
			purchases.length > 0
				? prisma.purchaseItem.findMany({
						where: {
							purchaseUuid: { in: purchases.map((p) => p.uuid) },
							productUuid,
							deletedAt: null,
						},
					})
				: [],
			sales.length > 0
				? prisma.saleItem.findMany({
						where: {
							saleUuid: { in: sales.map((s) => s.uuid) },
							productUuid,
							deletedAt: null,
						},
					})
				: [],
		]);

		// Fetch product name
		const product = await prisma.product.findUnique({
			where: { uuid: productUuid },
			select: { name: true },
		});

		const rows = [];

		for (const item of purchaseItems) {
			const doc = purchaseMap.get(item.purchaseUuid);
			if (!doc) continue;
			rows.push({
				date: doc.date?.toISOString().slice(0, 10) ?? "",
				direction: "in",
				docType: "purchase",
				docId: doc.id,
				docUuid: doc.uuid,
				counterpartyName: doc.counterparty?.name ?? "",
				quantity: Number(item.quantity),
				price: Number(item.price),
				amount: Number(item.amount),
			});
		}

		for (const item of saleItems) {
			const doc = saleMap.get(item.saleUuid);
			if (!doc) continue;
			rows.push({
				date: doc.date?.toISOString().slice(0, 10) ?? "",
				direction: "out",
				docType: "sale",
				docId: doc.id,
				docUuid: doc.uuid,
				counterpartyName: doc.counterparty?.name ?? "",
				quantity: Number(item.quantity),
				price: Number(item.price),
				amount: Number(item.amount),
			});
		}

		rows.sort((a, b) => a.date.localeCompare(b.date) || a.docId - b.docId);

		return res.json({
			success: true,
			items: rows,
			productName: product?.name ?? productUuid,
		});
	} catch (err) {
		console.error("GET /reports/product-movements error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/sales-by-manager ───────────────────────────────────────────
// Продажи по менеджерам (аналитика учёта «Manager»). Только проведённые
// документы. Реализация — оборот продаж, возврат от покупателя — уменьшает.
// Params: dateFrom, dateTo, organizationUuid.
router.get("/reports/sales-by-manager", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
		const where = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });

		const [sales, returns] = await Promise.all([
			prisma.sale.groupBy({ by: ["managerUuid"], where, _sum: { amount: true }, _count: { _all: true } }),
			prisma.saleReturn.groupBy({ by: ["managerUuid"], where, _sum: { amount: true }, _count: { _all: true } }),
		]);

		// Имена менеджеров.
		const uuids = [...new Set([...sales, ...returns].map((r) => r.managerUuid).filter(Boolean))];
		const emps = uuids.length
			? await prisma.employee.findMany({
					where: { uuid: { in: uuids } },
					select: { uuid: true, fullName: true, firstName: true, lastName: true, middleName: true },
				})
			: [];
		const nameOf = new Map(
			emps.map((e) => [e.uuid, e.fullName || [e.lastName, e.firstName, e.middleName].filter(Boolean).join(" ") || e.uuid]),
		);

		const map = new Map();
		const ensure = (u) => {
			const k = u || "__none__";
			if (!map.has(k)) {
				map.set(k, {
					managerUuid: u || null,
					managerName: u ? nameOf.get(u) || u : "— без менеджера —",
					salesCount: 0, salesAmount: 0, returnsCount: 0, returnsAmount: 0,
				});
			}
			return map.get(k);
		};
		for (const s of sales) { const r = ensure(s.managerUuid); r.salesCount = s._count._all; r.salesAmount = r2(s._sum.amount); }
		for (const rr of returns) { const r = ensure(rr.managerUuid); r.returnsCount = rr._count._all; r.returnsAmount = r2(rr._sum.amount); }

		const rows = [...map.values()].map((r) => ({ ...r, netAmount: r2(r.salesAmount - r.returnsAmount) }));
		rows.sort((a, b) => b.netAmount - a.netAmount);

		const totals = rows.reduce(
			(t, r) => ({
				salesCount: t.salesCount + r.salesCount,
				salesAmount: r2(t.salesAmount + r.salesAmount),
				returnsCount: t.returnsCount + r.returnsCount,
				returnsAmount: r2(t.returnsAmount + r.returnsAmount),
				netAmount: r2(t.netAmount + r.netAmount),
			}),
			{ salesCount: 0, salesAmount: 0, returnsCount: 0, returnsAmount: 0, netAmount: 0 },
		);

		return res.json({ success: true, items: rows, totals });
	} catch (err) {
		console.error("GET /reports/sales-by-manager error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
