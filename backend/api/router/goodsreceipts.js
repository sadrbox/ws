import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, checkOwnership, checkFkOwnership } from "../../utils/auth.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { syncItemsFromParent } from "./_documentItemsFactory.js";
import { reconcileDocumentRegister, removeDocumentRegister } from "../../services/productRegister.js";
import { reconcileDocumentEntries, removeDocumentEntries, assertPostable, respondPostingError } from "../../services/accountingPosting.js";
import { assertDocumentSerials, respondSerialError, releaseIssuedSerials, removeReceiptSerials } from "../../services/serialNumbers.js";
import { assertDocumentBatches, respondBatchError } from "../../services/batches.js";
import { recomputeIfRetroactive } from "../../services/recomputeCosting.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { assertBasisExists, respondBasisError } from "../../services/basisValidation.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";

const router = express.Router();

const MODEL = "goodsReceipt";
const ROUTE = "goodsreceipts";
const DOC_TYPE = "goods_receipt";
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
		const { date, comment, organizationUuid, warehouseUuid, posted, basisDocumentType, basisDocumentUuid, basisDocumentLabel } = req.body;
		const fkError = await checkFkOwnership(req, prisma, [{ model: "warehouse", uuid: warehouseUuid }]);
		if (fkError) return res.status(403).json({ success: false, message: fkError });
		await assertOrgFieldMembership({ organizationUuid, warehouseUuid }, prisma);
		await assertPeriodOpen(organizationUuid, date);
		if (basisDocumentUuid) await assertBasisExists(basisDocumentType, basisDocumentUuid);
		const docNumber = await ensureDocumentNumber({ docType: DOC_TYPE, modelName: MODEL, manual: req.body.number, organizationUuid, date });
		const item = await prisma[MODEL].create({
			data: {
				number: docNumber,
				date: date ? new Date(date) : new Date(),
				comment: comment?.trim() ?? null,
				organizationUuid: organizationUuid || null,
				warehouseUuid: warehouseUuid || null,
				posted: typeof posted === "boolean" ? posted : false,
				basisDocumentType: basisDocumentType || null,
				basisDocumentUuid: basisDocumentUuid || null,
				basisDocumentLabel: basisDocumentLabel || null,
				authorUuid: req.user.uuid,
			},
			include: INCLUDE,
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (respondBasisError(error, res)) return;
		if (respondOrgFieldError(error, res)) return;
		if (respondSerialError(error, res)) return;
		if (respondBatchError(error, res)) return;
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
		if (req.body.amount !== undefined) data.amount = req.body.amount != null ? parseFloat(req.body.amount) : null;
		if (req.body.number !== undefined) data.number = req.body.number?.trim?.() || null;
		for (const f of ["basisDocumentType", "basisDocumentUuid", "basisDocumentLabel"]) {
			if (req.body[f] !== undefined) data[f] = req.body[f] || null;
		}
		if (data.warehouseUuid) {
			const fkError = await checkFkOwnership(req, prisma, [{ model: "warehouse", uuid: data.warehouseUuid }]);
			if (fkError) return res.status(403).json({ success: false, message: fkError });
		}
		if (data.basisDocumentUuid) await assertBasisExists(data.basisDocumentType, data.basisDocumentUuid);
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
		const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
		if (willBePosted) {
			// Серийные номера: число серий строки должно совпадать с количеством.
			await assertDocumentSerials({ docType: DOC_TYPE, docUuid: existing.uuid, itemModel: "goodsReceiptItem", parentField: "goodsReceiptUuid" });
			await assertDocumentBatches({ docType: DOC_TYPE, docUuid: existing.uuid, itemModel: "goodsReceiptItem", parentField: "goodsReceiptUuid" });
			await assertPostable(DOC_TYPE, existing.uuid, { ...data, posted: true });
		}
		const item = await prisma[MODEL].update({ where: w, data, include: INCLUDE });
		await syncItemsFromParent("goodsReceiptItem", "goodsReceiptUuid", item.uuid, item);
		await reconcileDocumentRegister(DOC_TYPE, item.uuid);
		await reconcileDocumentEntries(DOC_TYPE, item.uuid);
		// Ввод задним числом делает COGS последующих документов устаревшим —
		// пересчитываем хвост истории (не трогая закрытый период).
		await recomputeIfRetroactive({ organizationUuid: item.organizationUuid, date: item.date });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondBasisError(error, res)) return;
		if (respondOrgFieldError(error, res)) return;
		if (respondPostingError(error, res)) return;
		if (respondSerialError(error, res)) return;
		if (respondBatchError(error, res)) return;
		if (respondPeriodLockError(error, res)) return;
		if (respondDuplicateNumberError(error, res)) return;
		if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

const onDeleted = async (doc) => {
	await removeDocumentRegister(DOC_TYPE, doc.uuid);
	await removeDocumentEntries(DOC_TYPE, doc.uuid);
	await removeReceiptSerials(DOC_TYPE, doc.uuid);
};

router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, numberDocType: DOC_TYPE, onDeleted }),
);

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL, numberDocType: DOC_TYPE, onDeleted }),
);

export default router;
