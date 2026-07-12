import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildNestedItemsConditions } from "../../utils/nestedSearch.js";
import { tenantFilter, checkOwnership, checkFkOwnership } from "../../utils/auth.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { syncItemsFromParent } from "./_documentItemsFactory.js";
import { warehouseBalances } from "../../services/productRegister.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";
import { idSearchCondition } from "../../utils/searchId.js";

const router = express.Router();

const MODEL = "stockCount";
const ROUTE = "stockcounts";
const DOC_TYPE = "stock_count";
const TEXT_FIELDS = ["comment"];

const INCLUDE = {
	organization: true,
	warehouse: true,
	author: { select: { uuid: true, username: true, email: true } },
};

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const limitNumber = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res.status(400).json({ success: false, message: "Некорректный параметр cursor" });
		const filter = req.query.filter && typeof req.query.filter === "object" ? req.query.filter : {};
		const orderBy = [];
		if (typeof req.query.sort === "string") {
			try {
				const s = JSON.parse(req.query.sort);
				if (s)
					for (const [f, d] of Object.entries(s)) {
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
					const idNum = idSearchCondition(w);
					if (idNum) orConditions.push(idNum);
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
		// Поиск по ВЛОЖЕННЫМ строкам документа: «[номенклатура: ноут]» → покажи
		// документы, в позициях которых есть такой товар. Дописываем в AND, а не
		// разливаем в корень: searchWhere уже может занимать ключ AND.
		const nestedConds = buildNestedItemsConditions(MODEL, req.query.nested);
		if (nestedConds.length) baseWhere.AND = [...(baseWhere.AND ?? []), ...nestedConds];
		const opts = { take: limitNumber, where: baseWhere, orderBy, include: INCLUDE };
		if (cursorNumber !== null) { opts.cursor = { id: cursorNumber }; opts.skip = 1; }
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

// Заполнить позиции остатками по учёту (снимок регистра на дату документа).
// Существующие строки обновляются (accountingQuantity), недостающие создаются с
// фактом = учёту. Строки по товарам, которых нет в остатке, НЕ удаляются:
// кладовщик мог внести фактически найденный товар с нулевым учётным остатком.
router.post(`/${ROUTE}/:id/fill-accounting`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const doc = await prisma[MODEL].findUnique({ where: w });
		if (!doc || !checkOwnership(doc, req)) return res.status(404).json({ success: false, message: "Не найдено" });
		if (!doc.warehouseUuid) return res.status(400).json({ success: false, message: "Укажите склад" });
		await assertPeriodOpen(doc.organizationUuid, doc.date);

		const balances = await warehouseBalances(doc.organizationUuid, doc.warehouseUuid, doc.date);
		const existing = await prisma.stockCountItem.findMany({ where: { stockCountUuid: doc.uuid } });
		const byProduct = new Map(existing.filter((r) => r.productUuid).map((r) => [r.productUuid, r]));

		const products = balances.size
			? await prisma.product.findMany({ where: { uuid: { in: [...balances.keys()] } }, select: { uuid: true, unitOfMeasureUuid: true } })
			: [];
		const unitByProduct = new Map(products.map((p) => [p.uuid, p.unitOfMeasureUuid]));

		let created = 0;
		let updated = 0;
		for (const [productUuid, bal] of balances) {
			const row = byProduct.get(productUuid);
			if (row) {
				await prisma.stockCountItem.update({ where: { uuid: row.uuid }, data: { accountingQuantity: bal.quantity } });
				updated++;
			} else {
				await prisma.stockCountItem.create({
					data: {
						stockCountUuid: doc.uuid,
						productUuid,
						unitOfMeasureUuid: unitByProduct.get(productUuid) ?? null,
						accountingQuantity: bal.quantity,
						quantity: bal.quantity, // факт по умолчанию = учёт; кладовщик правит
						organizationUuid: doc.organizationUuid ?? null,
					},
				});
				created++;
			}
		}
		// Товары со строкой, но без остатка — учётное количество обнуляем.
		for (const row of existing) {
			if (row.productUuid && !balances.has(row.productUuid) && Number(row.accountingQuantity) !== 0) {
				await prisma.stockCountItem.update({ where: { uuid: row.uuid }, data: { accountingQuantity: 0 } });
				updated++;
			}
		}
		return res.status(200).json({ success: true, created, updated });
	} catch (error) {
		if (respondPeriodLockError(error, res)) return;
		console.error(`POST /${ROUTE}/:id/fill-accounting error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w, include: INCLUDE });
		if (!item || !checkOwnership(item, req)) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}`, async (req, res) => {
	try {
		if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Автор документа обязателен: требуется авторизация" });
		const { date, comment, organizationUuid, warehouseUuid, posted } = req.body;
		const fkError = await checkFkOwnership(req, prisma, [{ model: "warehouse", uuid: warehouseUuid }]);
		if (fkError) return res.status(403).json({ success: false, message: fkError });
		await assertOrgFieldMembership({ organizationUuid, warehouseUuid }, prisma);
		await assertPeriodOpen(organizationUuid, date);
		const docNumber = await ensureDocumentNumber({ docType: DOC_TYPE, modelName: MODEL, manual: req.body.number, organizationUuid, date });
		const item = await prisma[MODEL].create({
			data: {
				number: docNumber,
				date: date ? new Date(date) : new Date(),
				comment: comment?.trim() ?? null,
				organizationUuid: organizationUuid || null,
				warehouseUuid: warehouseUuid || null,
				posted: typeof posted === "boolean" ? posted : false,
				authorUuid: req.user.uuid,
			},
			include: INCLUDE,
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (respondOrgFieldError(error, res)) return;
		if (respondPeriodLockError(error, res)) return;
		if (respondDuplicateNumberError(error, res)) return;
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
		for (const f of ["comment", "organizationUuid", "warehouseUuid"]) {
			if (req.body[f] !== undefined) data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.posted !== undefined) data.posted = !!req.body.posted;
		if (req.body.date !== undefined) data.date = req.body.date ? new Date(req.body.date) : null;
		if (req.body.number !== undefined) data.number = req.body.number?.trim?.() || null;
		if (data.warehouseUuid) {
			const fkError = await checkFkOwnership(req, prisma, [{ model: "warehouse", uuid: data.warehouseUuid }]);
			if (fkError) return res.status(403).json({ success: false, message: fkError });
		}
		const existing = await prisma[MODEL].findUnique({ where: w, select: { uuid: true, organizationUuid: true, posted: true, number: true, warehouseUuid: true, date: true } });
		if (!existing || !checkOwnership(existing, req)) return res.status(404).json({ success: false, message: "Не найдено" });
		await assertPeriodOpen(existing.organizationUuid, existing.date);
		await assertPeriodOpen(data.organizationUuid ?? existing.organizationUuid, data.date ?? existing.date);
		{
			const _num = await ensureDocumentNumber({ docType: DOC_TYPE, modelName: MODEL, manual: data.number, existingNumber: existing.number, organizationUuid: data.organizationUuid ?? existing.organizationUuid, date: data.date ?? existing.date, excludeUuid: existing.uuid });
			if (_num) data.number = _num;
		}
		await assertOrgFieldMembership({
			organizationUuid: data.organizationUuid !== undefined ? data.organizationUuid : existing.organizationUuid,
			warehouseUuid: data.warehouseUuid !== undefined ? data.warehouseUuid : existing.warehouseUuid,
		}, prisma);
		// Инвентаризация не двигает регистр и не даёт проводок: reconcile не нужен.
		const item = await prisma[MODEL].update({ where: w, data, include: INCLUDE });
		await syncItemsFromParent("stockCountItem", "stockCountUuid", item.uuid, item);
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondOrgFieldError(error, res)) return;
		if (respondPeriodLockError(error, res)) return;
		if (respondDuplicateNumberError(error, res)) return;
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, numberDocType: DOC_TYPE }),
);

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL, numberDocType: DOC_TYPE }),
);

export default router;
