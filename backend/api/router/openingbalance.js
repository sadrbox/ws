// Ввод остатков серий/партий — разметка УЖЕ имеющегося остатка (см. services/openingBalance.js).
// Количество на складе не меняется: это не приход, а маркировка.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import {
	serialGap, batchGap, addOpeningSerials, addOpeningBatch, respondOpeningBalanceError,
} from "../../services/openingBalance.js";
import { resolveWritableOrg, respondOrgAccessError, checkFkOwnership, OrgAccessError } from "../../utils/auth.js";

const router = express.Router();
const ROUTE = "opening-balance";

/*
 * ОРГАНИЗАЦИЯ, ТОВАР И СКЛАД — ДОСТУПНЫЕ ПОЛЬЗОВАТЕЛЮ (Б8 аудита 26.09). Раньше организация
 * приходила из запроса как есть: без неё остаток считался по ВСЕМ организациям установки, а
 * ввод остатков размечал серии и партии на чужом складе. Не указана — активная организация.
 */
async function scopeArgs(req, src) {
	const organizationUuid = resolveWritableOrg(req, src.organizationUuid ? String(src.organizationUuid) : null);
	const fkError = await checkFkOwnership(req, prisma, [
		{ model: "product", uuid: src.productUuid ? String(src.productUuid) : null },
		{ model: "warehouse", uuid: src.warehouseUuid ? String(src.warehouseUuid) : null },
	]);
	if (fkError) throw new OrgAccessError(403, "Товар или склад недоступен");
	return organizationUuid;
}

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
			organizationUuid: await scopeArgs(req, { productUuid, warehouseUuid, organizationUuid }),
		};
		const data = kind === "batch" ? await batchGap(args) : await serialGap(args);
		return res.status(200).json({ success: true, ...data });
	} catch (error) {
		if (respondOrgAccessError(error, res)) return;
		console.error(`GET /${ROUTE}/gap error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/** Ввод остатков СЕРИЙ. */
router.post(`/${ROUTE}/serials`, async (req, res) => {
	try {
		const body = req.body ?? {};
		const organizationUuid = await scopeArgs(req, body);
		const result = await addOpeningSerials({ ...body, organizationUuid });
		return res.status(201).json({ success: true, ...result });
	} catch (error) {
		if (respondOrgAccessError(error, res)) return;
		if (respondOpeningBalanceError(error, res)) return;
		console.error(`POST /${ROUTE}/serials error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

/** Ввод остатков ПАРТИЙ. */
router.post(`/${ROUTE}/batches`, async (req, res) => {
	try {
		const body = req.body ?? {};
		const organizationUuid = await scopeArgs(req, body);
		const result = await addOpeningBatch({ ...body, organizationUuid });
		return res.status(201).json({ success: true, ...result });
	} catch (error) {
		if (respondOrgAccessError(error, res)) return;
		if (respondOpeningBalanceError(error, res)) return;
		console.error(`POST /${ROUTE}/batches error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
