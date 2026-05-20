import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";

const router = express.Router();

// GET /reports/sales-by-product
// Params: dateFrom, dateTo, organizationUuid, counterpartyUuid
router.get("/reports/sales-by-product", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, counterpartyUuid } = req.query;

		// Step 1: collect relevant sale UUIDs
		// tenantFilter isolates data by the user's active organization (same as sales.js)
		const saleWhere = { posted: true, ...tenantFilter(req) };
		if (dateFrom || dateTo) {
			saleWhere.date = {};
			if (dateFrom) saleWhere.date.gte = new Date(dateFrom);
			if (dateTo) saleWhere.date.lte = new Date(dateTo + "T23:59:59.999Z");
		}
		// Query param org filter overrides tenantFilter if explicitly provided
		if (organizationUuid) saleWhere.organizationUuid = organizationUuid;
		if (counterpartyUuid) saleWhere.counterpartyUuid = counterpartyUuid;

		const sales = await prisma.sale.findMany({
			where: saleWhere,
			select: { uuid: true, organization: { select: { shortName: true } } },
		});

		const saleUuids = sales.map((s) => s.uuid);
		const orgName =
			organizationUuid
				? (sales.find((s) => s.organization)?.organization?.shortName ?? "")
				: "";

		if (saleUuids.length === 0) {
			return res.json({ success: true, items: [], orgName });
		}

		// Step 2: fetch all sale items for those sales
		const items = await prisma.saleItem.findMany({
			where: { saleUuid: { in: saleUuids }, deletedAt: null },
			include: {
				product: { select: { uuid: true, shortName: true } },
				unitOfMeasure: { select: { shortName: true } },
			},
			orderBy: { id: "asc" },
		});

		// Aggregate by product
		const map = new Map();
		for (const item of items) {
			const key = item.productUuid ?? "__no_product__";
			if (!map.has(key)) {
				map.set(key, {
					productUuid: item.productUuid,
					productName: item.product?.shortName ?? "—",
					uom: item.unitOfMeasure?.shortName ?? "",
					qtySale: 0,
					qtyReturn: 0,
					amountSale: 0,
					amountReturn: 0,
					exciseAmountSale: 0,
					vatAmountSale: 0,
					amountNoTaxSale: 0,
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

export default router;
