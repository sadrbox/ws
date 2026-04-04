import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();

const MODEL = "accessRight";
const ROUTE = "access-rights";

// ── GET list (filtered by employeeUuid) ─────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { employeeUuid } = req.query;
		if (!employeeUuid)
			return res.status(400).json({
				success: false,
				message: "Параметр employeeUuid обязателен",
			});

		const items = await prisma[MODEL].findMany({
			where: { employeeUuid },
			orderBy: { modelName: "asc" },
		});

		return res.status(200).json({
			success: true,
			items,
			total: items.length,
		});
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { modelName, accessLevel, employeeUuid } = req.body;
		if (!employeeUuid)
			return res.status(400).json({
				success: false,
				message: "employeeUuid обязателен",
			});
		if (!modelName)
			return res.status(400).json({
				success: false,
				message: "modelName обязателен",
			});
		const item = await prisma[MODEL].create({
			data: {
				modelName: modelName.trim(),
				accessLevel: accessLevel?.trim() || "none",
				employeeUuid,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		// Уникальное ограничение [employeeUuid, modelName]
		if (error.code === "P2002")
			return res.status(409).json({
				success: false,
				message: "Право доступа для этой модели уже существует",
			});
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ─────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		if (req.body.modelName !== undefined)
			data.modelName = req.body.modelName?.trim() ?? null;
		if (req.body.accessLevel !== undefined)
			data.accessLevel = req.body.accessLevel?.trim() || "none";

		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		if (error.code === "P2002")
			return res.status(409).json({
				success: false,
				message: "Право доступа для этой модели уже существует",
			});
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		await prisma[MODEL].delete({ where: w });
		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
