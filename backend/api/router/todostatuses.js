// Справочник «Статусы задач» (E9.5). Заменяет захардкоженный enum в UI: набор
// статусов настраивается, т.к. команды ведут учёт по-своему.
//
// `code` — стабильный идентификатор, который лежит в todos.status. Менять его у
// существующего статуса нельзя: это осиротит уже созданные задачи, поэтому PUT
// код игнорирует (правится только название/порядок/признак завершения).
// Справочник общий для всех организаций (набор статусов — методология работы,
// а не данные организации), поэтому tenantFilter здесь не применяется.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";

const router = express.Router();
const MODEL = "todoStatus";
const ROUTE = "todo-statuses";

/** Приводит произвольную строку к виду кода: латиница/цифры/подчёркивание. */
function toCode(raw) {
	return String(raw ?? "")
		.trim().toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const where = { deletedAt: null };
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
		const { name, code, sortOrder, isFinal } = req.body;
		if (!name?.trim()) return res.status(400).json({ success: false, message: "Наименование обязательно" });
		// Код можно не задавать — выведем из названия (для кириллицы уйдём в fallback).
		const finalCode = toCode(code) || toCode(name) || `status_${Date.now().toString(36)}`;
		const clash = await prisma[MODEL].findUnique({ where: { code: finalCode } });
		if (clash) return res.status(409).json({ success: false, message: `Статус с кодом «${finalCode}» уже есть` });

		const item = await prisma[MODEL].create({
			data: {
				code: finalCode,
				name: name.trim(),
				sortOrder: sortOrder != null ? parseInt(sortOrder, 10) : 100,
				isFinal: isFinal === true,
			},
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
		// code НЕ меняем намеренно — он лежит в todos.status у существующих задач.
		const data = {};
		if (req.body.name !== undefined) data.name = req.body.name?.trim() ?? null;
		if (req.body.sortOrder !== undefined) data.sortOrder = req.body.sortOrder != null ? parseInt(req.body.sortOrder, 10) : 100;
		if (req.body.isFinal !== undefined) data.isFinal = req.body.isFinal === true;
		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// Удаление статуса, который уже проставлен задачам, осиротило бы их — поэтому
// сначала проверяем использование (checkReferences не знает про строковую связь
// status↔code, связь не через FK).
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const status = await prisma[MODEL].findUnique({ where: w });
		if (!status) return res.status(404).json({ success: false, message: "Не найдено" });
		const used = await prisma.todo.count({ where: { status: status.code, deletedAt: null } });
		if (used > 0) {
			return res.status(409).json({
				success: false,
				message: `Статус «${status.name}» используется в задачах (${used}) и не может быть удалён`,
			});
		}
		return handleDelete({ req, res, prisma, modelName: MODEL });
	} catch (error) {
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch-delete`, (req, res) => handleBatchDelete({ req, res, prisma, modelName: MODEL }));

export default router;
