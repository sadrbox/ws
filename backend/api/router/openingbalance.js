// Ввод остатков серий/партий — разметка УЖЕ имеющегося остатка (см. services/openingBalance.js).
// Количество на складе не меняется: это не приход, а маркировка.
import express from "express";
import {
	serialGap, batchGap, addOpeningSerials, addOpeningBatch, respondOpeningBalanceError,
} from "../../services/openingBalance.js";

const router = express.Router();
const ROUTE = "opening-balance";

/** Сколько остатка ещё не размечено (для подсказки в форме). */
router.get(`/${ROUTE}/gap`, async (req, res) => {
	try {
		const { productUuid, warehouseUuid, organizationUuid, kind } = req.query;
		if (!productUuid) {
			return res.status(400).json({ success: false, message: "Нужен productUuid" });
		}
		// Склад НЕОБЯЗАТЕЛЕН: без него считаем по всем складам — так карточка товара
		// узнаёт, есть ли вообще неразмеченный остаток, чтобы предупредить при
		// включении учёта по сериям/партиям.
		const args = {
			productUuid: String(productUuid),
			warehouseUuid: warehouseUuid ? String(warehouseUuid) : null,
			organizationUuid: organizationUuid ? String(organizationUuid) : null,
		};
		const data = kind === "batch" ? await batchGap(args) : await serialGap(args);
		return res.status(200).json({ success: true, ...data });
	} catch (error) {
		console.error(`GET /${ROUTE}/gap error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/** Ввод остатков СЕРИЙ. */
router.post(`/${ROUTE}/serials`, async (req, res) => {
	try {
		const result = await addOpeningSerials(req.body ?? {});
		return res.status(201).json({ success: true, ...result });
	} catch (error) {
		if (respondOpeningBalanceError(error, res)) return;
		console.error(`POST /${ROUTE}/serials error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/** Ввод остатков ПАРТИЙ. */
router.post(`/${ROUTE}/batches`, async (req, res) => {
	try {
		const result = await addOpeningBatch(req.body ?? {});
		return res.status(201).json({ success: true, ...result });
	} catch (error) {
		if (respondOpeningBalanceError(error, res)) return;
		console.error(`POST /${ROUTE}/batches error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
