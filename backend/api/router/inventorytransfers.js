import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildNestedItemsConditions } from "../../utils/nestedSearch.js";
import { tenantFilter } from "../../utils/auth.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { reconcileDocumentRegister, removeDocumentRegister, assertStockForPosting, respondStockError } from "../../services/productRegister.js";
import { reconcileDocumentEntries, removeDocumentEntries, assertPostable, respondPostingError } from "../../services/accountingPosting.js";
import { recomputeIfRetroactive } from "../../services/recomputeCosting.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";
import { idSearchCondition } from "../../utils/searchId.js";
const router = express.Router();
const MODEL = "inventoryTransfer";
const ROUTE = "inventory-transfers";
const TEXT_FIELDS = ["comment"];

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";
		const limitNumber = Math.min(
			Math.max(rawLimit !== undefined ? Number(rawLimit) : 500, 1),
			999999,
		);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res
				.status(400)
				.json({ success: false, message: "Некорректный cursor" });
		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};
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
					const orConditions = TEXT_FIELDS.map((f) => ({
						[f]: { contains: w, mode: "insensitive" },
					}));
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
				if (op === "contains")
					filterWhere[field] = { contains: String(val), mode: "insensitive" };
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
		const opts = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: {
				fromWarehouse: true,
				toWarehouse: true,
				organization: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
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
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: {
				fromWarehouse: true,
				toWarehouse: true,
				organization: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		if (!req.user?.uuid) {
			return res.status(401).json({
				success: false,
				message: "Автор документа обязателен: требуется авторизация",
			});
		}
		const {
			date,
			comment,
			fromWarehouseUuid,
			toWarehouseUuid,
			organizationUuid,
			posted,
			amount,
		} = req.body;
		// Stage D: оба склада принадлежат организации документа.
		await assertOrgFieldMembership({ organizationUuid, fromWarehouseUuid, toWarehouseUuid }, prisma);
		// Блокировка закрытого периода: нельзя создавать документ в закрытом месяце.
		await assertPeriodOpen(organizationUuid, date);
		// Номер документа: автоматически при записи (ручной/импорт или автоген) + уникальность.
		const docNumber = await ensureDocumentNumber({ docType: "inventory_transfer", modelName: MODEL, manual: req.body.number, organizationUuid, date });
		const item = await prisma[MODEL].create({
			data: {
				number: docNumber,
				date: date ? new Date(date) : new Date(),
				comment: comment?.trim() ?? null,
				fromWarehouseUuid: fromWarehouseUuid || null,
				toWarehouseUuid: toWarehouseUuid || null,
				organizationUuid: organizationUuid || null,
				posted: typeof posted === "boolean" ? posted : false,
				amount: amount != null ? parseFloat(amount) : null,
				authorUuid: req.user.uuid,
			},
			include: {
				fromWarehouse: true,
				toWarehouse: true,
				organization: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
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
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		for (const f of [
			"comment",
			"fromWarehouseUuid",
			"toWarehouseUuid",
			"organizationUuid",
		]) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.date !== undefined)
			data.date = req.body.date ? new Date(req.body.date) : null;
		if (req.body.posted !== undefined) data.posted = !!req.body.posted;
		if (req.body.amount !== undefined)
			data.amount =
				req.body.amount != null ? parseFloat(req.body.amount) : null;
		// Номер из payload (ручной ввод / переприсвоение) — иначе он терялся при PUT
		// и сохранялся прежний. Пусто → ensureDocumentNumber выдаст авто-номер.
		if (req.body.number !== undefined) data.number = req.body.number?.trim?.() || null;
		// Контроль остатка ПЕРЕД фиксацией проведения (расход с fromWarehouse).
		const existing = await prisma[MODEL].findUnique({
			where: w,
			select: { uuid: true, posted: true, number: true, fromWarehouseUuid: true, toWarehouseUuid: true, organizationUuid: true, date: true },
		});
		if (!existing)
			return res.status(404).json({ success: false, message: "Не найдено" });
		// Блокировка закрытого периода: нельзя трогать закрытый документ и переносить в закрытый период.
		await assertPeriodOpen(existing.organizationUuid, existing.date);
		await assertPeriodOpen(data.organizationUuid ?? existing.organizationUuid, data.date ?? existing.date);
		// Номер документа: гарантируем при записи (автоген если пусто) + уникальность.
		{
			const _num = await ensureDocumentNumber({ docType: "inventory_transfer", modelName: MODEL, manual: data.number, existingNumber: existing.number, organizationUuid: data.organizationUuid ?? existing.organizationUuid, date: data.date ?? existing.date, excludeUuid: existing.uuid });
			if (_num) data.number = _num; // всегда фиксируем итоговый номер (в т.ч. при очистке поля)
		}
		// Stage D: оба склада принадлежат организации документа (мерж с текущими).
		await assertOrgFieldMembership({
			organizationUuid: data.organizationUuid !== undefined ? data.organizationUuid : existing.organizationUuid,
			fromWarehouseUuid: data.fromWarehouseUuid !== undefined ? data.fromWarehouseUuid : existing.fromWarehouseUuid,
			toWarehouseUuid: data.toWarehouseUuid !== undefined ? data.toWarehouseUuid : existing.toWarehouseUuid,
		}, prisma);
		const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
		if (willBePosted) {
			const fromWarehouseUuid =
				data.fromWarehouseUuid !== undefined
					? data.fromWarehouseUuid
					: existing.fromWarehouseUuid;
			await assertStockForPosting("inventory_transfer", existing.uuid, {
				fromWarehouseUuid,
			});
			// Проверка возможности проведения в бухучёте (счета/субконто).
			await assertPostable("inventory_transfer", existing.uuid, { ...data, posted: true });
		}
		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: {
				fromWarehouse: true,
				toWarehouse: true,
				organization: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		await reconcileDocumentRegister("inventory_transfer", item.uuid);
		// Бухпроводки перемещения (Дт 1330 склад-получатель Кт 1330 склад-источник).
		await reconcileDocumentEntries("inventory_transfer", item.uuid);
		// Ввод задним числом делает COGS последующих документов устаревшим —
		// пересчитываем хвост истории (не трогая закрытый период).
		await recomputeIfRetroactive({ organizationUuid: item.organizationUuid, date: item.date });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondOrgFieldError(error, res)) return;
		if (respondStockError(error, res)) return;
		if (respondPostingError(error, res)) return;
		if (respondPeriodLockError(error, res)) return;
		if (respondDuplicateNumberError(error, res)) return;
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});
const onTransferDeleted = async (doc) => {
	await removeDocumentRegister("inventory_transfer", doc.uuid);
	await removeDocumentEntries("inventory_transfer", doc.uuid);
};
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, numberDocType: "inventory_transfer", onDeleted: onTransferDeleted }),
);
router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL, numberDocType: "inventory_transfer", onDeleted: onTransferDeleted }),
);

export default router;
