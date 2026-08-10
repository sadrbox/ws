// Строки табличной части «Основные средства» документа Поступление (Purchase).
// Контракт как у прочих *items: GET ?purchaseUuid=… (список) + POST /batch
// (operations: create/update/delete). НДС считается «в том числе» из amount+vatRate.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
const MODEL = "purchaseFixedAssetItem";
const ROUTE = "purchasefixedassetitems";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** НДС «в том числе»: из суммы с НДС и ставки → (без НДС, НДС). */
function splitVat(amount, vatRate) {
	const amt = r2(amount);
	const rate = Number(vatRate) || 0;
	const net = rate > 0 ? r2(amt / (1 + rate / 100)) : amt;
	return { amountWithoutVat: net, vatAmount: r2(amt - net) };
}

/** Готовит данные строки из payload (переданные fixedAssetUuid/Name/amount/vatRate). */
function buildData(d) {
	const amount = r2(d.amount);
	const vatRate = d.vatRate != null ? Number(d.vatRate) : 12;
	const { amountWithoutVat, vatAmount } = splitVat(amount, vatRate);
	return {
		purchaseUuid: d.purchaseUuid,
		fixedAssetUuid: d.fixedAssetUuid || null,
		fixedAssetName: d.fixedAssetName?.trim?.() || null,
		amount,
		vatRate,
		amountWithoutVat,
		vatAmount,
		sourceRowId: d.sourceRowId || null,
		organizationUuid: d.organizationUuid || null,
	};
}

// GET /purchasefixedassetitems?purchaseUuid=…
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const purchaseUuid = typeof req.query.purchaseUuid === "string" ? req.query.purchaseUuid : "";
		if (!purchaseUuid) return res.json({ success: true, items: [], total: 0 });
		const items = await prisma[MODEL].findMany({
			where: { purchaseUuid, deletedAt: null },
			orderBy: [{ id: "asc" }],
		});
		return res.json({ success: true, items, total: items.length });
	} catch (err) {
		console.error(`GET /${ROUTE} error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /purchasefixedassetitems/batch  { operations: [{action, data|uuid}] }
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const ops = Array.isArray(req.body?.operations) ? req.body.operations : [];
		await prisma.$transaction(async (tx) => {
			for (const op of ops) {
				if (op.action === "create" && op.data?.purchaseUuid) {
					await tx[MODEL].create({ data: buildData(op.data) });
				} else if (op.action === "update" && op.uuid) {
					await tx[MODEL].update({ where: { uuid: op.uuid }, data: buildData(op.data ?? {}) });
				} else if (op.action === "delete" && op.uuid) {
					await tx[MODEL].delete({ where: { uuid: op.uuid } });
				}
			}
		});
		return res.json({ success: true });
	} catch (err) {
		console.error(`POST /${ROUTE}/batch error:`, err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
