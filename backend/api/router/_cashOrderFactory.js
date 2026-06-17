/**
 * Фабрика роутера кассовых ордеров. ПКО и РКО — это ОДНА таблица `cash_orders`
 * (модель CashOrder), различаются полем `direction` ("receipt"|"expense").
 * Каждый маршрут (/cash-receipt-orders, /cash-expense-orders) — тонкая обёртка
 * над этой фабрикой со своим direction/docType. Документ-тип для проводок и
 * нумерации остаётся прежним (cash_receipt_order/cash_expense_order), поэтому
 * AccountingEntry и последовательности номеров не трогаются.
 */
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, checkOwnership } from "../../utils/auth.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { reconcileDocumentEntries, removeDocumentEntries, assertPostable, validatePosting, respondPostingError } from "../../services/accountingPosting.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";

const MODEL = "cashOrder";
const TEXT_FIELDS = ["comment"];
const INCLUDE = {
	organization: true,
	counterparty: true,
	contract: true,
	cashbox: true,
	employee: { select: { uuid: true, fullName: true } },
	author: { select: { uuid: true, username: true, email: true } },
};

export function createCashOrderRouter({ direction, route, docType }) {
	const router = express.Router();

	router.get(`/${route}`, async (req, res) => {
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
					if (s) for (const [f, d] of Object.entries(s)) {
						if (d === "asc" || d === "desc") { const parts = f.split("."); orderBy.push(parts.length === 2 ? { [parts[0]]: { [parts[1]]: d } } : { [f]: d }); }
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
					else { if (!filterWhere[field]) filterWhere[field] = {}; filterWhere[field][op] = val; }
				}
			}
			// direction жёстко задаёт маршрут (ПКО/РКО), tenantFilter — организацию.
			const baseWhere = { direction, ...searchWhere, ...filterWhere, ...tenantFilter(req) };
			const opts = { take: limitNumber, where: baseWhere, orderBy, include: INCLUDE };
			if (cursorNumber !== null) { opts.cursor = { id: cursorNumber }; opts.skip = 1; }
			const items = await prisma[MODEL].findMany(opts);
			const hasMore = items.length === limitNumber;
			const nextCursor = hasMore ? items[items.length - 1].id : null;
			let total;
			if (cursorNumber === null) total = await prisma[MODEL].count({ where: baseWhere });
			return res.status(200).json({ success: true, items, nextCursor, hasMore, ...(total !== undefined ? { total } : {}) });
		} catch (error) {
			console.error(`GET /${route} error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	router.get(`/${route}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			// findFirst c direction — чтобы маршрут отдавал только свой тип ордера.
			const item = await prisma[MODEL].findFirst({ where: { ...w, direction }, include: INCLUDE });
			if (!item || !checkOwnership(item, req))
				return res.status(404).json({ success: false, message: "Не найдено" });
			return res.status(200).json({ success: true, item });
		} catch (error) {
			console.error(`GET /${route}/:id error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	router.post(`/${route}`, async (req, res) => {
		try {
			if (!req.user?.uuid)
				return res.status(401).json({ success: false, message: "Автор документа обязателен: требуется авторизация" });
			const { date, comment, amount, organizationUuid, counterpartyUuid, contractUuid, cashboxUuid, employeeUuid, posted,
				operationType, basisDocumentType, basisDocumentUuid, basisDocumentLabel } = req.body;
			const willPost = posted === undefined ? true : !!posted;
			const docData = {
				direction,
				date: date ? new Date(date) : new Date(),
				comment: comment?.trim() ?? null,
				amount: amount != null ? parseFloat(amount) : null,
				// Тип операции определяет проводку; при отсутствии — дефолт по направлению.
				operationType: operationType || (direction === "receipt" ? "payment_from_customer" : "payment_to_supplier"),
				basisDocumentType: basisDocumentType || null,
				basisDocumentUuid: basisDocumentUuid || null,
				basisDocumentLabel: basisDocumentLabel?.trim?.() ?? basisDocumentLabel ?? null,
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
				contractUuid: contractUuid || null,
				cashboxUuid: cashboxUuid || null,
				employeeUuid: employeeUuid || null,
				posted: willPost,
				authorUuid: req.user.uuid,
			};
			await assertOrgFieldMembership(docData, prisma);
			// Блокировка закрытого периода: нельзя создавать кассовый ордер в закрытом месяце.
			await assertPeriodOpen(docData.organizationUuid, docData.date);
			if (willPost) await validatePosting(docType, docData, []);
			// Номер документа: автоматически при записи (ручной/импорт или автоген) + уникальность.
			docData.number = await ensureDocumentNumber({ docType, modelName: MODEL, manual: req.body.number, organizationUuid: docData.organizationUuid, date: docData.date, uniqueWhere: { direction } });
			const item = await prisma[MODEL].create({ data: docData, include: INCLUDE });
			if (item.posted) await reconcileDocumentEntries(docType, item.uuid);
			return res.status(201).json({ success: true, item });
		} catch (error) {
			if (respondOrgFieldError(error, res)) return;
			if (respondPeriodLockError(error, res)) return;
			if (respondDuplicateNumberError(error, res)) return;
			if (respondPostingError(error, res)) return;
			console.error(`POST /${route} error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	router.put(`/${route}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			const data = {};
			for (const f of ["comment", "organizationUuid", "counterpartyUuid", "contractUuid", "cashboxUuid", "employeeUuid",
				"operationType", "basisDocumentType", "basisDocumentUuid", "basisDocumentLabel"]) {
				if (req.body[f] !== undefined) data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
			}
			if (req.body.date !== undefined) data.date = req.body.date ? new Date(req.body.date) : null;
			if (req.body.amount !== undefined) data.amount = req.body.amount != null ? parseFloat(req.body.amount) : null;
			if (req.body.posted !== undefined) data.posted = !!req.body.posted;
			// Номер из payload (ручной ввод / переприсвоение) — иначе он терялся при PUT.
			if (req.body.number !== undefined) data.number = req.body.number?.trim?.() || null;
			// Проверяем существование И принадлежность маршруту (direction).
			const existing = await prisma[MODEL].findFirst({ where: { ...w, direction }, select: { uuid: true, organizationUuid: true, posted: true, number: true, contractUuid: true, cashboxUuid: true, date: true } });
			if (!existing || !checkOwnership(existing, req))
				return res.status(404).json({ success: false, message: "Не найдено" });
			// Блокировка закрытого периода: нельзя трогать закрытый ордер и переносить в закрытый период.
			await assertPeriodOpen(existing.organizationUuid, existing.date);
			await assertPeriodOpen(data.organizationUuid ?? existing.organizationUuid, data.date ?? existing.date);
			await assertOrgFieldMembership({
				organizationUuid: data.organizationUuid !== undefined ? data.organizationUuid : existing.organizationUuid,
				contractUuid: data.contractUuid !== undefined ? data.contractUuid : existing.contractUuid,
				cashboxUuid: data.cashboxUuid !== undefined ? data.cashboxUuid : existing.cashboxUuid,
			}, prisma);
			const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
			if (willBePosted) await assertPostable(docType, existing.uuid, { ...data, posted: true });
			// Номер документа: гарантируем при записи (автоген если пусто) + уникальность.
			{
				const _num = await ensureDocumentNumber({ docType, modelName: MODEL, manual: data.number, existingNumber: existing.number, organizationUuid: data.organizationUuid ?? existing.organizationUuid, date: data.date ?? existing.date, excludeUuid: existing.uuid, uniqueWhere: { direction } });
				if (_num) data.number = _num; // всегда фиксируем итоговый номер (в т.ч. при очистке поля)
			}
			const item = await prisma[MODEL].update({ where: { uuid: existing.uuid }, data, include: INCLUDE });
			await reconcileDocumentEntries(docType, item.uuid);
			return res.status(200).json({ success: true, item });
		} catch (error) {
			if (respondOrgFieldError(error, res)) return;
			if (respondPeriodLockError(error, res)) return;
			if (respondPostingError(error, res)) return;
			if (respondDuplicateNumberError(error, res)) return;
			if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
			console.error(`PUT /${route}/:id error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	router.delete(`/${route}/:id`, (req, res) =>
		handleDelete({ req, res, prisma, modelName: MODEL, onDeleted: (doc) => removeDocumentEntries(docType, doc.uuid), numberDocType: docType }),
	);
	router.post(`/${route}/batch-delete`, (req, res) =>
		handleBatchDelete({ req, res, prisma, modelName: MODEL, onDeleted: (doc) => removeDocumentEntries(docType, doc.uuid), numberDocType: docType }),
	);

	return router;
}
