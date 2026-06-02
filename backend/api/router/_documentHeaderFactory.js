// ─────────────────────────────────────────────────────────────────────────────
// Фабрика роутеров шапки документа (CRUD + список с поиском/фильтром/курсором).
// Зеркалит структуру существующих роутеров (purchaserequisitions.js,
// cashreceiptorders.js), но параметризуется набором полей, include и проведением,
// чтобы не дублировать ~230 строк на каждый однотипный документ.
//
// Параметры:
//   MODEL          — prisma-модель (например "purchaseOrder")
//   ROUTE          — путь ("purchase-orders")
//   TEXT_FIELDS    — текстовые поля для полнотекстового поиска (по умолчанию ["comment"])
//   stringFields   — строковые поля шапки (FK/строки), читаются из body как есть|null
//   numberFields   — числовые поля (parseFloat|null), по умолчанию ["amount"]
//   include        — include для возвращаемых записей
//   hasBasis       — обрабатывать basisDocumentType/Uuid/Label
//   posting        — { docType } если документ проводится (валидация + проводки)
//   defaultPosted  — значение posted по умолчанию при создании
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import {
	reconcileDocumentEntries,
	removeDocumentEntries,
	assertPostable,
	validatePosting,
	respondPostingError,
} from "../../services/accountingPosting.js";

const BASIS_FIELDS = ["basisDocumentType", "basisDocumentUuid", "basisDocumentLabel"];

export function createDocumentHeaderRouter({
	MODEL,
	ROUTE,
	TEXT_FIELDS = ["comment"],
	stringFields = ["organizationUuid", "counterpartyUuid", "contractUuid"],
	numberFields = ["amount"],
	include = {
		organization: true,
		counterparty: true,
		contract: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	hasBasis = false,
	posting = null,
	defaultPosted = false,
	// Доп. хуки: afterSave(uuid) — после create/update; afterDelete(doc) — после удаления.
	afterSave = null,
	afterDelete = null,
}) {
	const router = express.Router();

	// ── GET list ─────────────────────────────────────────────────────────────
	router.get(`/${ROUTE}`, async (req, res) => {
		try {
			const rawLimit = req.query.limit;
			const rawCursor = req.query.cursor;
			const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
			const limitNumber = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1), 999999);
			const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
			if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
				return res.status(400).json({ success: false, message: "Некорректный cursor" });
			const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};
			const orderBy = [];
			if (typeof req.query.sort === "string") {
				try {
					const s = JSON.parse(req.query.sort);
					if (s)
						for (const [f, d] of Object.entries(s)) {
							if (d === "asc" || d === "desc") {
								const parts = f.split(".");
								orderBy.push(parts.length === 2 ? { [parts[0]]: { [parts[1]]: d } } : { [f]: d });
							}
						}
				} catch {}
			}
			if (!orderBy.length) orderBy.push({ id: "desc" });
			else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });
			const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
			let searchWhere = {};
			if (searchWords.length)
				searchWhere = {
					AND: searchWords.map((w) => {
						const orConditions = TEXT_FIELDS.map((f) => ({ [f]: { contains: w, mode: "insensitive" } }));
						const num = Number(w);
						if (Number.isInteger(num) && num > 0) orConditions.push({ id: { equals: num } });
						return { OR: orConditions };
					}),
				};
			const ALLOWED = ["contains", "equals", "gte", "lte", "gt", "lt"];
			const filterWhere = {};
			for (const [field, conds] of Object.entries(filter)) {
				if (field === "searchBy" || !conds || typeof conds !== "object") continue;
				if (field === "dateRange") {
					const dr = {};
					if (conds.startDate) dr.gte = new Date(conds.startDate);
					if (conds.endDate) dr.lte = new Date(conds.endDate);
					if (Object.keys(dr).length > 0) filterWhere.date = dr;
					continue;
				}
				for (const [op, val] of Object.entries(conds)) {
					if (!ALLOWED.includes(op)) continue;
					if (op === "contains") filterWhere[field] = { contains: String(val), mode: "insensitive" };
					else {
						if (!filterWhere[field]) filterWhere[field] = {};
						filterWhere[field][op] = val;
					}
				}
			}
			const baseWhere = { ...searchWhere, ...filterWhere, ...tenantFilter(req) };
			const opts = { take: limitNumber, where: baseWhere, orderBy, include };
			if (cursorNumber !== null) {
				opts.cursor = { id: cursorNumber };
				opts.skip = 1;
			}
			const items = await prisma[MODEL].findMany(opts);
			const hasMore = items.length === limitNumber;
			const nextCursor = hasMore ? items[items.length - 1].id : null;
			let total;
			if (cursorNumber === null) total = await prisma[MODEL].count({ where: baseWhere });
			return res.status(200).json({ success: true, items, nextCursor, hasMore, ...(total !== undefined ? { total } : {}) });
		} catch (error) {
			console.error(`GET /${ROUTE} error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── GET by id/uuid ─────────────────────────────────────────────────────────
	router.get(`/${ROUTE}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			const item = await prisma[MODEL].findUnique({ where: w, include });
			if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
			return res.status(200).json({ success: true, item });
		} catch (error) {
			console.error(`GET /${ROUTE}/:id error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── POST create ────────────────────────────────────────────────────────────
	router.post(`/${ROUTE}`, async (req, res) => {
		try {
			if (!req.user?.uuid)
				return res.status(401).json({ success: false, message: "Автор документа обязателен: требуется авторизация" });
			const b = req.body;
			const data = {
				date: b.date ? new Date(b.date) : new Date(),
				posted: typeof b.posted === "boolean" ? b.posted : defaultPosted,
				authorUuid: req.user.uuid,
			};
			for (const f of stringFields) data[f] = b[f]?.trim?.() ?? b[f] ?? null;
			for (const f of numberFields) data[f] = b[f] != null ? parseFloat(b[f]) : null;
			if (hasBasis) for (const f of BASIS_FIELDS) data[f] = b[f] || null;

			// Stage D: org-зависимые поля должны принадлежать организации документа.
			await assertOrgFieldMembership(data, prisma);
			if (posting && data.posted) await validatePosting(posting.docType, data, []);
			const item = await prisma[MODEL].create({ data, include });
			if (posting && item.posted) await reconcileDocumentEntries(posting.docType, item.uuid);
			if (afterSave) await afterSave(item.uuid);
			return res.status(201).json({ success: true, item });
		} catch (error) {
			if (respondOrgFieldError(error, res)) return;
			if (posting && respondPostingError(error, res)) return;
			console.error(`POST /${ROUTE} error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── PUT update ─────────────────────────────────────────────────────────────
	router.put(`/${ROUTE}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			const b = req.body;
			const data = {};
			for (const f of stringFields) if (b[f] !== undefined) data[f] = b[f]?.trim?.() ?? b[f] ?? null;
			for (const f of numberFields) if (b[f] !== undefined) data[f] = b[f] != null ? parseFloat(b[f]) : null;
			if (b.date !== undefined) data.date = b.date ? new Date(b.date) : null;
			if (b.posted !== undefined) data.posted = !!b.posted;
			if (hasBasis) for (const f of BASIS_FIELDS) if (b[f] !== undefined) data[f] = b[f] || null;

			// Существующий документ нужен и для проверки принадлежности полей
			// организации (мерж data поверх текущих значений ловит и смену орг,
			// и смену поля), и для проверки проведения.
			const existing = await prisma[MODEL].findUnique({ where: w });
			if (!existing) return res.status(404).json({ success: false, message: "Не найдено" });

			// Stage D: org-зависимые поля принадлежат организации документа.
			await assertOrgFieldMembership({ ...existing, ...data }, prisma);

			if (posting) {
				const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
				if (willBePosted) await assertPostable(posting.docType, existing.uuid, { ...data, posted: true });
			}
			const item = await prisma[MODEL].update({ where: w, data, include });
			if (posting) await reconcileDocumentEntries(posting.docType, item.uuid);
			if (afterSave) await afterSave(item.uuid);
			return res.status(200).json({ success: true, item });
		} catch (error) {
			if (respondOrgFieldError(error, res)) return;
			if (posting && respondPostingError(error, res)) return;
			if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
			console.error(`PUT /${ROUTE}/:id error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── DELETE ─────────────────────────────────────────────────────────────────
	const onDeleted = (posting || afterDelete)
		? async (doc) => {
			if (posting) await removeDocumentEntries(posting.docType, doc.uuid);
			if (afterDelete) await afterDelete(doc);
		}
		: undefined;
	router.delete(`/${ROUTE}/:id`, (req, res) => handleDelete({ req, res, prisma, modelName: MODEL, onDeleted }));
	router.post(`/${ROUTE}/batch-delete`, (req, res) => handleBatchDelete({ req, res, prisma, modelName: MODEL, onDeleted }));

	return router;
}
