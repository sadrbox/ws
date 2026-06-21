import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, checkOwnership, checkFkOwnership } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { syncItemsFromParent } from "./_documentItemsFactory.js";
import { reconcileDocumentRegister, removeDocumentRegister, assertStockForPosting, respondStockError } from "../../services/productRegister.js";
import { reconcileDocumentEntries, removeDocumentEntries, assertPostable, respondPostingError } from "../../services/accountingPosting.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { assertBasisExists, respondBasisError } from "../../services/basisValidation.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";

const router = express.Router();

const MODEL = "sale";
const ROUTE = "sales";
const TEXT_FIELDS = ["comment"];

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
						if (d !== "asc" && d !== "desc") continue;
						if (f.includes(".")) {
							const parts = f.split(".");
							let nested = { [parts[parts.length - 1]]: d };
							for (let i = parts.length - 2; i >= 0; i--) {
								nested = { [parts[i]]: nested };
							}
							orderBy.push(nested);
						} else {
							orderBy.push({ [f]: d });
						}
					}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ id: "desc" });
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
		const opts = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: {
				organization: true,
				counterparty: true,
				contract: true,
				warehouse: true,
				manager: true,
				priceType: true,
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
				organization: true,
				counterparty: true,
				contract: true,
				warehouse: true,
				manager: true,
				priceType: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		if (!item || !checkOwnership(item, req))
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
			amount,
			amountWithoutVat,
			vatAmount,
			discountAmount,
			posted,
			organizationUuid,
			counterpartyUuid,
			contractUuid,
			warehouseUuid,
			managerUuid,
			priceTypeUuid,
			basisDocumentType,
			basisDocumentUuid,
			basisDocumentLabel,
		} = req.body;
		const fkError = await checkFkOwnership(req, prisma, [
			{ model: "warehouse", uuid: warehouseUuid },
		]);
		if (fkError) return res.status(403).json({ success: false, message: fkError });
		// Stage D: склад/договор принадлежат организации документа.
		await assertOrgFieldMembership({ organizationUuid, warehouseUuid, contractUuid }, prisma);
		// Блокировка закрытого периода: нельзя создавать документ в закрытом месяце.
		await assertPeriodOpen(organizationUuid, date);
		// Номер документа: автоматически при записи (ручной/импорт или автоген) + уникальность.
		// Запрещаем ссылку «в никуда»: основание (если указано) должно существовать.
		if (basisDocumentUuid) await assertBasisExists(basisDocumentType, basisDocumentUuid);
		const docNumber = await ensureDocumentNumber({ docType: "sale", modelName: MODEL, manual: req.body.number, organizationUuid, date });
		const item = await prisma[MODEL].create({
			data: {
				number: docNumber,
				date: date ? new Date(date) : new Date(),
				comment: comment?.trim() ?? null,
				amount: amount != null ? parseFloat(amount) : null,
				amountWithoutVat:
					amountWithoutVat != null ? parseFloat(amountWithoutVat) : null,
				vatAmount: vatAmount != null ? parseFloat(vatAmount) : null,
				discountAmount:
					discountAmount != null ? parseFloat(discountAmount) : null,
				posted: posted === true,
				organizationUuid: organizationUuid || null,
				counterpartyUuid: counterpartyUuid || null,
				contractUuid: contractUuid || null,
				warehouseUuid: warehouseUuid || null,
				managerUuid: managerUuid || null,
				priceTypeUuid: priceTypeUuid || null,
				basisDocumentType: basisDocumentType || null,
				basisDocumentUuid: basisDocumentUuid || null,
				basisDocumentLabel: basisDocumentLabel || null,
				authorUuid: req.user.uuid,
			},
			include: {
				organization: true,
				counterparty: true,
				contract: true,
				warehouse: true,
				manager: true,
				priceType: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (respondBasisError(error, res)) return;
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
		const strFields = [
			"number",
			"comment",
			"organizationUuid",
			"counterpartyUuid",
			"contractUuid",
			"warehouseUuid",
			"managerUuid",
			"priceTypeUuid",
		];
		for (const f of strFields) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.posted !== undefined) data.posted = req.body.posted === true;
		if (req.body.date !== undefined)
			data.date = req.body.date ? new Date(req.body.date) : null;
		if (req.body.amount !== undefined)
			data.amount =
				req.body.amount != null ? parseFloat(req.body.amount) : null;
		if (req.body.amountWithoutVat !== undefined)
			data.amountWithoutVat =
				req.body.amountWithoutVat != null
					? parseFloat(req.body.amountWithoutVat)
					: null;
		if (req.body.vatAmount !== undefined)
			data.vatAmount =
				req.body.vatAmount != null ? parseFloat(req.body.vatAmount) : null;
		if (req.body.discountAmount !== undefined)
			data.discountAmount =
				req.body.discountAmount != null
					? parseFloat(req.body.discountAmount)
					: null;

		for (const f of ["basisDocumentType", "basisDocumentUuid", "basisDocumentLabel"]) {
			if (req.body[f] !== undefined) data[f] = req.body[f] || null;
		}
		if (data.warehouseUuid) {
			const fkError = await checkFkOwnership(req, prisma, [{ model: "warehouse", uuid: data.warehouseUuid }]);
			if (fkError) return res.status(403).json({ success: false, message: fkError });
		}
		// Запрещаем ссылку «в никуда»: проверяем только при ЗАДАНИИ нового основания.
		if (data.basisDocumentUuid) await assertBasisExists(data.basisDocumentType, data.basisDocumentUuid);
		const existing = await prisma[MODEL].findUnique({
			where: w,
			select: { uuid: true, organizationUuid: true, posted: true, number: true, warehouseUuid: true, contractUuid: true, date: true },
		});
		if (!existing || !checkOwnership(existing, req))
			return res.status(404).json({ success: false, message: "Не найдено" });
		// Блокировка закрытого периода: нельзя трогать закрытый документ и нельзя
		// переносить документ в закрытый период.
		await assertPeriodOpen(existing.organizationUuid, existing.date);
		await assertPeriodOpen(data.organizationUuid ?? existing.organizationUuid, data.date ?? existing.date);
		// Номер документа: гарантируем при записи (автоген если пусто) + уникальность.
		{
			const _num = await ensureDocumentNumber({ docType: "sale", modelName: MODEL, manual: data.number, existingNumber: existing.number, organizationUuid: data.organizationUuid ?? existing.organizationUuid, date: data.date ?? existing.date, excludeUuid: existing.uuid });
			if (_num) data.number = _num; // всегда фиксируем итоговый номер (в т.ч. при очистке поля)
		}
		// Stage D: склад/договор принадлежат организации документа (мерж с текущими).
		await assertOrgFieldMembership({
			organizationUuid: data.organizationUuid !== undefined ? data.organizationUuid : existing.organizationUuid,
			warehouseUuid: data.warehouseUuid !== undefined ? data.warehouseUuid : existing.warehouseUuid,
			contractUuid: data.contractUuid !== undefined ? data.contractUuid : existing.contractUuid,
		}, prisma);
		// Контроль остатка ПЕРЕД фиксацией проведения (см. productRegister.js).
		const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
		if (willBePosted) {
			const warehouseUuid =
				data.warehouseUuid !== undefined ? data.warehouseUuid : existing.warehouseUuid;
			await assertStockForPosting("sale", existing.uuid, { warehouseUuid });
			// Бух. проверки проведения (организация, дата, счета, субконто, Дт=Кт).
			await assertPostable("sale", existing.uuid, { ...data, posted: true });
		}
		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: {
				organization: true,
				counterparty: true,
				contract: true,
				warehouse: true,
				manager: true,
				priceType: true,
				author: { select: { uuid: true, username: true, email: true } },
			},
		});
		await syncItemsFromParent("saleItem", "saleUuid", item.uuid, item);
		// Проведение/распроведение или смена даты/склада/организации — пересобираем
		// движения регистра товаров (записываются только для проведённых документов).
		await reconcileDocumentRegister("sale", item.uuid);
		// Пересобираем бухгалтерские проводки документа.
		await reconcileDocumentEntries("sale", item.uuid);
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondBasisError(error, res)) return;
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

const onSaleDeleted = async (doc) => {
	await removeDocumentRegister("sale", doc.uuid);
	await removeDocumentEntries("sale", doc.uuid);
};

router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, numberDocType: "sale", onDeleted: onSaleDeleted }),
);

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL, numberDocType: "sale", onDeleted: onSaleDeleted }),
);

export default router;
