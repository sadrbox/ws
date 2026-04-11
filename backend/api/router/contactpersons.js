import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../../prisma/prisma-client.js";
import { enrichWithOwnerName } from "../../utils/resolveOwnerName.js";

const router = express.Router();

const MODEL = "contactPerson";
const ROUTE = "contactpersons";

// ── Avatar upload setup ─────────────────────────────────────────────────
const AVATAR_DIR = path.resolve("uploads/avatars");
if (!fs.existsSync(AVATAR_DIR)) {
	fs.mkdirSync(AVATAR_DIR, { recursive: true });
}
const avatarStorage = multer.diskStorage({
	destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
	filename: (_req, file, cb) => {
		const ext = path.extname(file.originalname) || ".jpg";
		cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
	},
});
const avatarUpload = multer({
	storage: avatarStorage,
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (file.mimetype.startsWith("image/")) cb(null, true);
		else cb(new Error("Только изображения"));
	},
});

// GET /contactpersons — курсорная пагинация
router.get("/contactpersons", async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";

		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;

		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0)) {
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });
		}

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};

		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const sortObj = JSON.parse(sortParam);
				if (sortObj && typeof sortObj === "object") {
					for (const [field, dir] of Object.entries(sortObj)) {
						if (dir !== "asc" && dir !== "desc") continue;
						orderBy.push({ [field]: dir });
					}
				}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ id: "asc" });

		const TEXT_FIELDS = ["fullName", "comment"];
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};
		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => {
					const orConditions = TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					}));
					const num = Number(word);
					if (Number.isInteger(num) && num > 0) {
						orConditions.push({ id: { equals: num } });
					}
					return { OR: orConditions };
				}),
			};
		}

		const ALLOWED_OPERATORS = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const SKIP_KEYS = ["searchBy", "dateRange"];
		const filterWhereClause = {};
		for (const [field, conditions] of Object.entries(filter)) {
			if (SKIP_KEYS.includes(field)) continue;
			if (!conditions || typeof conditions !== "object") continue;
			for (const [operator, value] of Object.entries(conditions)) {
				if (!ALLOWED_OPERATORS.includes(operator)) continue;
				if (!filterWhereClause[field]) filterWhereClause[field] = {};
				if (operator === "contains") {
					filterWhereClause[field] = {
						contains: String(value),
						mode: "insensitive",
					};
				} else {
					filterWhereClause[field][operator] = value;
				}
			}
		}

		// ── Фильтрация по ownerType + ownerUuid ────
		const fkFilter = {};
		if (typeof req.query.ownerType === "string" && req.query.ownerType.trim()) {
			fkFilter.ownerType = req.query.ownerType.trim();
		}
		if (typeof req.query.ownerUuid === "string" && req.query.ownerUuid.trim()) {
			fkFilter.ownerUuid = req.query.ownerUuid.trim();
		}

		const baseWhere = { ...searchWhereClause, ...filterWhereClause, ...fkFilter };

		const queryOptions = { take: limitNumber, where: baseWhere, orderBy };
		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.contactPerson.findMany({
			...queryOptions,
		});
		const enrichedItems = await enrichWithOwnerName(items);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null)
			total = await prisma.contactPerson.count({ where: baseWhere });

		return res.status(200).json({
			success: true,
			items: enrichedItems,
			nextCursor,
			hasMore,
			...(total !== undefined ? { total } : {}),
		});
	} catch (error) {
		console.error("GET /contactpersons error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// GET /contactpersons/:id
router.get("/contactpersons/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;

		const item = isNumeric
			? await prisma.contactPerson.findUnique({
					where: { id: numId },
				})
			: await prisma.contactPerson.findUnique({
					where: { uuid: param },
				});

		if (!item)
			return res
				.status(404)
				.json({ success: false, message: "Контактное лицо не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error("GET /contactpersons/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /contactpersons
router.post("/contactpersons", async (req, res) => {
	try {
		const {
			firstName,
			lastName,
			middleName,
			fullName,
			ownerType,
			ownerUuid,
			comment,
		} = req.body;
		const nameFinal =
			fullName?.trim() ||
			[lastName, firstName, middleName].filter(Boolean).join(" ").trim() ||
			null;
		const item = await prisma.contactPerson.create({
			data: {
				firstName: firstName?.trim() || null,
				lastName: lastName?.trim() || null,
				middleName: middleName?.trim() || null,
				fullName: nameFinal,
				ownerType: ownerType?.trim() || null,
				ownerUuid: ownerUuid?.trim() || null,
				comment: comment?.trim() || null,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error("POST /contactpersons error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// PUT /contactpersons/:id
router.put("/contactpersons/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		const {
			firstName,
			lastName,
			middleName,
			fullName,
			ownerType,
			ownerUuid,
			comment,
		} = req.body;
		const data = {};
		if (firstName !== undefined) data.firstName = firstName?.trim() || null;
		if (lastName !== undefined) data.lastName = lastName?.trim() || null;
		if (middleName !== undefined) data.middleName = middleName?.trim() || null;
		if (fullName !== undefined) data.fullName = fullName?.trim() || null;
		if (ownerType !== undefined) data.ownerType = ownerType?.trim() || null;
		if (ownerUuid !== undefined) data.ownerUuid = ownerUuid?.trim() || null;
		if (comment !== undefined) data.comment = comment?.trim() || null;

		const item = await prisma.contactPerson.update({
			where: isNumeric ? { id: numId } : { uuid: param },
			data,
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res
				.status(404)
				.json({ success: false, message: "Контактное лицо не найдено" });
		console.error("PUT /contactpersons/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// DELETE /contactpersons/:id
router.delete("/contactpersons/:id", async (req, res) => {
	try {
		const param = req.params.id;
		const numId = Number(param);
		const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
		await prisma.contactPerson.delete({
			where: isNumeric ? { id: numId } : { uuid: param },
		});
		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025")
			return res
				.status(404)
				.json({ success: false, message: "Контактное лицо не найдено" });
		console.error("DELETE /contactpersons/:id error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST avatar ─────────────────────────────────────────────────────────
router.post(`/${ROUTE}/:id/avatar`, avatarUpload.single("avatar"), async (req, res) => {
	try {
		if (!req.file) return res.status(400).json({ success: false, message: "Файл не передан" });
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const existing = await prisma[MODEL].findUnique({ where: w });
		if (existing?.avatarPath) {
			const oldPath = path.resolve(AVATAR_DIR, existing.avatarPath);
			if (oldPath.startsWith(AVATAR_DIR) && fs.existsSync(oldPath)) {
				fs.unlinkSync(oldPath);
			}
		}

		const item = await prisma[MODEL].update({
			where: w,
			data: { avatarPath: req.file.filename },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`POST /${ROUTE}/:id/avatar error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET avatar ──────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id/avatar`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item?.avatarPath) return res.status(404).json({ success: false, message: "Аватар не найден" });
		const filePath = path.resolve(AVATAR_DIR, item.avatarPath);
		if (!filePath.startsWith(AVATAR_DIR) || !fs.existsSync(filePath)) {
			return res.status(404).json({ success: false, message: "Файл не найден" });
		}
		return res.sendFile(filePath);
	} catch (error) {
		console.error(`GET /${ROUTE}/:id/avatar error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE avatar ───────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id/avatar`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const existing = await prisma[MODEL].findUnique({ where: w });
		if (existing?.avatarPath) {
			const filePath = path.resolve(AVATAR_DIR, existing.avatarPath);
			if (filePath.startsWith(AVATAR_DIR) && fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		}
		const item = await prisma[MODEL].update({
			where: w,
			data: { avatarPath: null },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id/avatar error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
