import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";

const router = express.Router();

const MODEL = "userPermissionDefault";
const ROUTE = "user-permission-defaults";

// ── GET list ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid, organizationUuid } = req.query;

		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res.status(400).json({ success: false, message: "Некорректный параметр cursor" });
		}

		const where = {
			...(userUuid ? { userUuid } : {}),
			...(organizationUuid ? { organizationUuid } : {}),
		};

		const queryOptions = {
			take: limitNumber,
			where,
			orderBy: [{ id: "asc" }],
		};

		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma[MODEL].findMany(queryOptions);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null) {
			total = await prisma[MODEL].count({ where });
		}

		return res.status(200).json({
			success: true,
			items,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
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
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /batch ─────────────────────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });

		await prisma.$transaction(async (tx) => {
			for (const op of operations) {
				const { action, uuid, data } = op;
				if (action === "create" && data) {
					await tx[MODEL].upsert({
						where: {
							userUuid_organizationUuid_valueType: {
								userUuid: data.userUuid,
								organizationUuid: data.organizationUuid,
								valueType: data.valueType,
							},
						},
						update: {
							valueUuid: data.valueUuid,
							valueName: data.valueName ?? "",
						},
						create: {
							userUuid: data.userUuid,
							organizationUuid: data.organizationUuid,
							valueType: data.valueType,
							valueUuid: data.valueUuid,
							valueName: data.valueName ?? "",
						},
					});
				} else if (action === "update" && uuid && data) {
					await tx[MODEL].update({
						where: { uuid },
						data: {
							...(data.valueType !== undefined ? { valueType: data.valueType } : {}),
							...(data.valueUuid !== undefined ? { valueUuid: data.valueUuid } : {}),
							...(data.valueName !== undefined ? { valueName: data.valueName } : {}),
						},
					});
				} else if (action === "delete" && uuid) {
					await tx[MODEL].delete({ where: { uuid } });
				}
			}
		});

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { userUuid, organizationUuid, valueType, valueUuid, valueName } = req.body;
		if (!userUuid) return res.status(400).json({ success: false, message: "userUuid обязателен" });
		if (!organizationUuid) return res.status(400).json({ success: false, message: "organizationUuid обязателен" });
		if (!valueType) return res.status(400).json({ success: false, message: "valueType обязателен" });
		if (!valueUuid) return res.status(400).json({ success: false, message: "valueUuid обязателен" });

		const item = await prisma[MODEL].upsert({
			where: {
				userUuid_organizationUuid_valueType: { userUuid, organizationUuid, valueType },
			},
			update: { valueUuid, valueName: valueName ?? "" },
			create: { userUuid, organizationUuid, valueType, valueUuid, valueName: valueName ?? "" },
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
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		if (req.body.valueType !== undefined) data.valueType = req.body.valueType;
		if (req.body.valueUuid !== undefined) data.valueUuid = req.body.valueUuid;
		if (req.body.valueName !== undefined) data.valueName = req.body.valueName ?? "";

		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		if (error.code === "P2002")
			return res.status(409).json({ success: false, message: "Такой тип значения уже задан" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
