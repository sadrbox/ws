import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { handleDelete } from "../../utils/checkReferences.js";

const router = express.Router();

const MODEL = "employee";
const ROUTE = "employees";
const TEXT_FIELDS = ["fullName", "lastName", "firstName", "middleName", "iin"];

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

// ── GET list ────────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};
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
		if (orderBy.length === 0) orderBy.push({ id: "asc" });
		else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });

		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhere = {};
		if (searchWords.length > 0)
			searchWhere = {
				AND: searchWords.map((w) => {
					const orConditions = TEXT_FIELDS.map((f) => ({
						[f]: { contains: w, mode: "insensitive" },
					}));
					const num = Number(w);
					if (Number.isInteger(num) && num > 0) {
						orConditions.push({ id: { equals: num } });
					}
					return { OR: orConditions };
				}),
			};

		const ALLOWED = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const filterWhere = {};
		for (const [field, conds] of Object.entries(filter)) {
			if (
				["searchBy", "dateRange"].includes(field) ||
				!conds ||
				typeof conds !== "object"
			)
				continue;
			for (const [op, val] of Object.entries(conds)) {
				if (!ALLOWED.includes(op)) continue;
				if (op === "contains")
					filterWhere[field] = { contains: String(val), mode: "insensitive" };
				else {
					if (!filterWhere[field]) filterWhere[field] = {};
					filterWhere[field][op] = val;
				}
			}
		}

		const baseWhere = { ...searchWhere, ...filterWhere, ...tenantFilter(req) };
		const opts = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: { organization: true },
		};
		if (cursorNumber !== null) {
			opts.cursor = { id: cursorNumber };
			opts.skip = 1;
		}

		const items = await prisma[MODEL].findMany(opts);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;
		let total;
		if (cursorNumber === null)
			total = await prisma[MODEL].count({ where: baseWhere });

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
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: { organization: true },
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
			firstName,
			lastName,
			middleName,
			fullName,
			iin,
			organizationUuid,
			avatarPath,
		} = req.body;
		// Автоматически строим fullName если не передан
		const computedFullName =
			fullName?.trim() ||
			[lastName, firstName, middleName]
				.filter(Boolean)
				.map((s) => s.trim())
				.join(" ") ||
			null;
		if (!computedFullName)
			return res.status(400).json({
				success: false,
				message: "ФИО обязательно (fullName или lastName + firstName)",
			});
		const item = await prisma[MODEL].create({
			data: {
				firstName: firstName?.trim() ?? null,
				lastName: lastName?.trim() ?? null,
				middleName: middleName?.trim() ?? null,
				fullName: computedFullName,
				iin: iin?.trim() ?? null,
				organizationUuid: organizationUuid || null,
				avatarPath: avatarPath?.trim() ?? null,
			},
			include: { organization: true },
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
		if (req.body.firstName !== undefined)
			data.firstName = req.body.firstName?.trim() ?? null;
		if (req.body.lastName !== undefined)
			data.lastName = req.body.lastName?.trim() ?? null;
		if (req.body.middleName !== undefined)
			data.middleName = req.body.middleName?.trim() ?? null;
		if (req.body.fullName !== undefined)
			data.fullName = req.body.fullName?.trim() ?? null;
		if (req.body.iin !== undefined) data.iin = req.body.iin?.trim() ?? null;
		if (req.body.organizationUuid !== undefined)
			data.organizationUuid = req.body.organizationUuid || null;
		if (req.body.avatarPath !== undefined)
			data.avatarPath = req.body.avatarPath?.trim() ?? null;
		// Автоматически строим fullName если есть ФИО-поля и fullName не передан явно
		if (
			data.fullName === undefined &&
			(data.firstName !== undefined ||
				data.lastName !== undefined ||
				data.middleName !== undefined)
		) {
			const existing = await prisma[MODEL].findUnique({ where: w });
			if (existing) {
				const fn =
					data.firstName !== undefined ? data.firstName : existing.firstName;
				const ln =
					data.lastName !== undefined ? data.lastName : existing.lastName;
				const mn =
					data.middleName !== undefined ? data.middleName : existing.middleName;
				data.fullName = [ln, fn, mn].filter(Boolean).join(" ") || null;
			}
		}
		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: { organization: true },
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

// ── POST avatar ─────────────────────────────────────────────────────────
router.post(
	`/${ROUTE}/:id/avatar`,
	avatarUpload.single("avatar"),
	async (req, res) => {
		try {
			if (!req.file)
				return res
					.status(400)
					.json({ success: false, message: "Файл не передан" });
			const p = req.params.id;
			const n = Number(p);
			const w =
				!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

			// Удалить старый аватар если есть
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
				include: { organization: true },
			});
			return res.status(200).json({ success: true, item });
		} catch (error) {
			if (error.code === "P2025")
				return res.status(404).json({ success: false, message: "Не найдено" });
			console.error(`POST /${ROUTE}/:id/avatar error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	},
);

// ── GET avatar ──────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id/avatar`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const employee = await prisma[MODEL].findUnique({ where: w });
		if (!employee?.avatarPath)
			return res
				.status(404)
				.json({ success: false, message: "Аватар не найден" });
		const filePath = path.resolve(AVATAR_DIR, employee.avatarPath);
		if (!filePath.startsWith(AVATAR_DIR) || !fs.existsSync(filePath)) {
			return res
				.status(404)
				.json({ success: false, message: "Файл не найден" });
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
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
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
			include: { organization: true },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id/avatar error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
