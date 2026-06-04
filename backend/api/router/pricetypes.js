// Справочник «Типы цен» (Цена продажи / закупки / оптовая …).
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";

const router = express.Router();
const MODEL = "priceType";
const ROUTE = "price-types";

// Единственный тип «по умолчанию»: при установке снимаем флаг с остальных.
async function ensureSingleDefault(tx, uuid) {
	await tx[MODEL].updateMany({ where: { isDefault: true, NOT: { uuid } }, data: { isDefault: false } });
}

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const where = { ...tenantFilter(req) };
		if (search) where.name = { contains: search, mode: "insensitive" };
		const items = await prisma[MODEL].findMany({ where, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { name, isDefault, sortOrder } = req.body;
		if (!name?.trim()) return res.status(400).json({ success: false, message: "Наименование обязательно" });
		const item = await prisma.$transaction(async (tx) => {
			const created = await tx[MODEL].create({
				data: { name: name.trim(), isDefault: isDefault === true, sortOrder: sortOrder != null ? parseInt(sortOrder, 10) : 100, organizationUuid: req.user?.organizationUuid ?? null },
			});
			if (created.isDefault) await ensureSingleDefault(tx, created.uuid);
			return created;
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		if (req.body.name !== undefined) data.name = req.body.name?.trim() ?? null;
		if (req.body.isDefault !== undefined) data.isDefault = req.body.isDefault === true;
		if (req.body.sortOrder !== undefined) data.sortOrder = req.body.sortOrder != null ? parseInt(req.body.sortOrder, 10) : 100;
		const item = await prisma.$transaction(async (tx) => {
			const updated = await tx[MODEL].update({ where: w, data });
			if (data.isDefault === true) await ensureSingleDefault(tx, updated.uuid);
			return updated;
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) => handleDelete({ req, res, prisma, modelName: MODEL }));
router.post(`/${ROUTE}/batch-delete`, (req, res) => handleBatchDelete({ req, res, prisma, modelName: MODEL }));

export default router;
