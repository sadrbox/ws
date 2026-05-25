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
// Материальная ведомость (только проведённые документы).
// Params: dateFrom, dateTo, organizationUuid, warehouseUuid
router.get("/reports/material-statement", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, warehouseUuid } = req.query;

		const docWhere = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });
		if (warehouseUuid) docWhere.warehouseUuid = warehouseUuid;

		const [purchases, sales] = await Promise.all([
			prisma.purchase.findMany({ where: docWhere, select: { uuid: true } }),
			prisma.sale.findMany({ where: docWhere, select: { uuid: true } }),
		]);

		const purchaseUuids = purchases.map((p) => p.uuid);
		const saleUuids = sales.map((s) => s.uuid);

		const includeProduct = {
			product: { select: { uuid: true, name: true } },
			unitOfMeasure: { select: { name: true } },
		};

		const [purchaseItems, saleItems] = await Promise.all([
			purchaseUuids.length > 0
				? prisma.purchaseItem.findMany({
						where: { purchaseUuid: { in: purchaseUuids }, deletedAt: null },
						include: includeProduct,
					})
				: [],
			saleUuids.length > 0
				? prisma.saleItem.findMany({
						where: { saleUuid: { in: saleUuids }, deletedAt: null },
						include: includeProduct,
					})
				: [],
		]);

		const map = new Map();
		const ensure = (item) => {
			const key = item.productUuid ?? "__no_product__";
			if (!map.has(key)) {
				map.set(key, {
					productUuid: item.productUuid,
					productName: item.product?.name ?? "—",
					uom: item.unitOfMeasure?.name ?? "",
					qtyIn: 0, amountIn: 0, qtyOut: 0, amountOut: 0,
				});
			}
			return map.get(key);
		};

		for (const item of purchaseItems) {
			const row = ensure(item);
			row.qtyIn += Number(item.quantity);
			row.amountIn += Number(item.amount);
		}
		for (const item of saleItems) {
			const row = ensure(item);
			row.qtyOut += Number(item.quantity);
			row.amountOut += Number(item.amount);
		}

		const items = Array.from(map.values())
			.map((r) => ({
				...r,
				qtyIn: Math.round(r.qtyIn * 1000) / 1000,
				amountIn: Math.round(r.amountIn * 100) / 100,
				qtyOut: Math.round(r.qtyOut * 1000) / 1000,
				amountOut: Math.round(r.amountOut * 100) / 100,
			}))
			.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

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

export default router;
