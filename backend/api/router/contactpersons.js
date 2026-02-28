import express from "express";
import cors from "cors";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();
router.use(cors());

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

		const TEXT_FIELDS = ["fullName", "position", "phone", "email", "ownerName"];
		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhereClause = {};
		if (searchWords.length > 0) {
			searchWhereClause = {
				AND: searchWords.map((word) => ({
					OR: TEXT_FIELDS.map((field) => ({
						[field]: { contains: word, mode: "insensitive" },
					})),
				})),
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

		const baseWhere = { ...searchWhereClause, ...filterWhereClause };

		const queryOptions = { take: limitNumber, where: baseWhere, orderBy };
		if (cursorNumber !== null) {
			queryOptions.cursor = { id: cursorNumber };
			queryOptions.skip = 1;
		}

		const items = await prisma.contactPerson.findMany(queryOptions);
		const hasMore = items.length === limitNumber;
		const nextCursor = hasMore ? items[items.length - 1].id : null;

		let total;
		if (cursorNumber === null)
			total = await prisma.contactPerson.count({ where: baseWhere });

		return res
			.status(200)
			.json({
				success: true,
				items,
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
					include: { contacts: true },
				})
			: await prisma.contactPerson.findUnique({
					where: { uuid: param },
					include: { contacts: true },
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
			position,
			phone,
			email,
			ownerName,
			organizationUuid,
			counterpartyUuid,
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
				position: position?.trim() || null,
				phone: phone?.trim() || null,
				email: email?.trim() || null,
				ownerName: ownerName?.trim() || null,
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
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
			position,
			phone,
			email,
			ownerName,
			organizationUuid,
			counterpartyUuid,
		} = req.body;
		const data = {};
		if (firstName !== undefined) data.firstName = firstName?.trim() || null;
		if (lastName !== undefined) data.lastName = lastName?.trim() || null;
		if (middleName !== undefined) data.middleName = middleName?.trim() || null;
		if (fullName !== undefined) data.fullName = fullName?.trim() || null;
		if (position !== undefined) data.position = position?.trim() || null;
		if (phone !== undefined) data.phone = phone?.trim() || null;
		if (email !== undefined) data.email = email?.trim() || null;
		if (ownerName !== undefined) data.ownerName = ownerName?.trim() || null;
		if (organizationUuid !== undefined)
			data.organizationUuid = organizationUuid || null;
		if (counterpartyUuid !== undefined)
			data.counterpartyUuid = counterpartyUuid || null;

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

export default router;
