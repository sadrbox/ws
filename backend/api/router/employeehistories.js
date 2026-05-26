import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";

const router = express.Router();

const MODEL = "employeeHistory";
const ROUTE = "employee-histories";

// ── GET list (filtered by employeeUuid) ─────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { employeeUuid } = req.query;
		if (!employeeUuid)
			return res.status(400).json({
				success: false,
				message: "Параметр employeeUuid обязателен",
			});

		const rawLimit = req.query.limit;
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);

		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const s = JSON.parse(sortParam);
				if (s && typeof s === "object")
					for (const [f, d] of Object.entries(s)) {
						if (d === "asc" || d === "desc") orderBy.push({ [f]: d });
					}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ eventDate: "desc" });
		else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });

		const items = await prisma[MODEL].findMany({
			take: limitNumber,
			where: { employeeUuid },
			orderBy,
			include: { position: true, employee: true, organization: true },
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
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: { position: true, employee: true, organization: true },
		});
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
		const {
			eventDate,
			eventType,
			salary,
			employeeUuid,
			positionUuid,
			organizationUuid,
		} = req.body;
		if (!employeeUuid)
			return res.status(400).json({
				success: false,
				message: "employeeUuid обязателен",
			});
		if (!eventType)
			return res.status(400).json({
				success: false,
				message: "eventType обязателен (hire, fire, transfer)",
			});
		const item = await prisma[MODEL].create({
			data: {
				eventDate: eventDate ? new Date(eventDate) : new Date(),
				eventType: eventType.trim(),
				salary: salary != null ? parseFloat(salary) : null,
				employeeUuid,
				positionUuid: positionUuid || null,
				organizationUuid: organizationUuid || null,
			},
			include: { position: true, employee: true, organization: true },
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
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
		if (req.body.eventDate !== undefined)
			data.eventDate = req.body.eventDate ? new Date(req.body.eventDate) : null;
		if (req.body.eventType !== undefined)
			data.eventType = req.body.eventType?.trim() ?? null;
		if (req.body.salary !== undefined)
			data.salary =
				req.body.salary != null ? parseFloat(req.body.salary) : null;
		if (req.body.positionUuid !== undefined)
			data.positionUuid = req.body.positionUuid || null;
		if (req.body.organizationUuid !== undefined)
			data.organizationUuid = req.body.organizationUuid || null;

		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: { position: true, employee: true, organization: true },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);

// ── POST /employee-histories/batch ────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data) {
					await tx[MODEL].create({
						data: {
							eventDate: data.eventDate ? new Date(data.eventDate) : new Date(),
							eventType: (data.eventType ?? "hire").trim(),
							salary: data.salary != null ? parseFloat(data.salary) : null,
							employeeUuid: data.employeeUuid,
							positionUuid: data.positionUuid || null,
							organizationUuid: data.organizationUuid || null,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.eventDate !== undefined) updateData.eventDate = data.eventDate ? new Date(data.eventDate) : null;
					if (data.eventType !== undefined) updateData.eventType = data.eventType.trim();
					if (data.salary !== undefined) updateData.salary = data.salary != null ? parseFloat(data.salary) : null;
					if (data.positionUuid !== undefined) updateData.positionUuid = data.positionUuid || null;
					if (data.organizationUuid !== undefined) updateData.organizationUuid = data.organizationUuid || null;
					if (Object.keys(updateData).length > 0)
						await tx[MODEL].update({ where: { uuid }, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx[MODEL].delete({ where: { uuid } }); } catch {}
				}
			}
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
