import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { clampLimit, sendError } from "../../utils/listQuery.js";
import { buildNestedItemsConditions } from "../../utils/nestedSearch.js";
import { buildOrderBy } from "../../utils/sortOrder.js";
import { tenantFilter, checkOwnership, checkFkOwnership, orgIsAccessible, resolveWritableOrg, respondOrgAccessError, OrgAccessError } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { removeDocumentRegister, assertStockForPosting, respondStockError } from "../../services/productRegister.js";
import { removeDocumentEntries, assertPostable, respondPostingError } from "../../services/accountingPosting.js";
import { assertDocumentSerials, respondSerialError, releaseIssuedSerials } from "../../services/serialNumbers.js";
import { assertDocumentBatches, respondBatchError } from "../../services/batches.js";
import { commitDocumentHeader, recomputeAfterDelete } from "../../services/documentCommit.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { assertBasisExists, respondBasisError } from "../../services/basisValidation.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";
import { idSearchCondition } from "../../utils/searchId.js";

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
		const limitNumber = clampLimit(rawLimit);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};
		// Сортировка валидируется по схеме (скаляры + пути "связь.поле"); неизвестные
		// и виртуальные колонки игнорируются, а не улетают в Prisma (иначе — 500).
		const orderBy = buildOrderBy(MODEL, req.query.sort, { fallback: { id: "desc" } });

		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhere = {};
		if (searchWords.length > 0)
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
		// Ошибка ввода (кривая дата, поле фильтра) — 400, остальное — 500 с записью в журнал.
		return sendError(res, error, { message: "Ошибка сервера", label: `GET /${ROUTE}` });
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
		// T7.11: подпись связанного (корректировочного) документа СНТ/ЭАВР для формы.
		if (item.awpRelatedUuid || item.sntRelatedUuid) {
			const uuids = [item.awpRelatedUuid, item.sntRelatedUuid].filter(Boolean);
			const rel = await prisma[MODEL].findMany({ where: { uuid: { in: uuids } }, select: { uuid: true, number: true } });
			const labelOf = (u) => { const r = rel.find((x) => x.uuid === u); return r ? (r.number ? `№ ${r.number}` : "б/н") : ""; };
			if (item.awpRelatedUuid) item.awpRelatedName = labelOf(item.awpRelatedUuid);
			if (item.sntRelatedUuid) item.sntRelatedName = labelOf(item.sntRelatedUuid);
		}
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
			counterpartyUuid,
			contractUuid,
			warehouseUuid,
			managerUuid,
			priceTypeUuid,
			basisDocumentType,
			basisDocumentUuid,
			basisDocumentLabel,
			awpRelatedUuid,
			sntRelatedUuid,
		} = req.body;
		// Организация реализации — доступная пользователю (Б8 аудита 26.09): раньше документ
		// создавался и проводился в чужой организации.
		const organizationUuid = resolveWritableOrg(req, req.body.organizationUuid);
		const fkError = await checkFkOwnership(req, prisma, [
			{ model: "warehouse", uuid: warehouseUuid },
		]);
		if (fkError) return res.status(403).json({ success: false, message: fkError });
		// Stage D: склад/договор принадлежат организации документа.
		await assertOrgFieldMembership({ organizationUuid, warehouseUuid, contractUuid }, prisma);
		// Блокировка закрытого периода: нельзя создавать документ в закрытом месяце.
		await assertPeriodOpen(organizationUuid, date);
		// Запрещаем ссылку «в никуда»: основание (если указано) должно существовать, быть
		// той же организации и — если реализация сразу проводится — проведённым (У9).
		if (basisDocumentUuid) await assertBasisExists(basisDocumentType, basisDocumentUuid, prisma, { organizationUuid, posting: posted === true });
		// Номер документа: автоматически при записи (ручной/импорт или автоген) + уникальность.
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
				awpRelatedUuid: awpRelatedUuid || null,
				sntRelatedUuid: sntRelatedUuid || null,
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
		if (respondOrgAccessError(error, res)) return;
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

		for (const f of ["basisDocumentType", "basisDocumentUuid", "basisDocumentLabel", "awpRelatedUuid", "sntRelatedUuid"]) {
			if (req.body[f] !== undefined) data[f] = req.body[f] || null;
		}
		if (data.warehouseUuid) {
			const fkError = await checkFkOwnership(req, prisma, [{ model: "warehouse", uuid: data.warehouseUuid }]);
			if (fkError) return res.status(403).json({ success: false, message: fkError });
		}
		const existing = await prisma[MODEL].findUnique({
			where: w,
			select: { uuid: true, organizationUuid: true, posted: true, number: true, warehouseUuid: true, contractUuid: true, date: true, basisDocumentType: true, basisDocumentUuid: true },
		});
		if (!existing || !checkOwnership(existing, req))
			return res.status(404).json({ success: false, message: "Не найдено" });
		// Перенос в другую организацию — только в доступную (Б8 аудита 26.09).
		if ("organizationUuid" in data && data.organizationUuid !== existing.organizationUuid) {
			if (!data.organizationUuid && !req.user?.isSuperAdmin) throw new OrgAccessError(400, "Не выбрана организация документа");
			if (data.organizationUuid && !orgIsAccessible(req, data.organizationUuid)) throw new OrgAccessError(403, "Организация недоступна");
		}
		// Основание: существует, той же организации и — при проведении — проведено (У9).
		// Проверяем новое основание и прежнее, если документ проводится.
		{
			const finalOrg = data.organizationUuid !== undefined ? data.organizationUuid : existing.organizationUuid;
			const posting = (data.posted !== undefined ? data.posted : existing.posted) === true;
			const basisType = data.basisDocumentType !== undefined ? data.basisDocumentType : existing.basisDocumentType;
			const basisUuid = data.basisDocumentUuid !== undefined ? data.basisDocumentUuid : existing.basisDocumentUuid;
			if (basisUuid && (data.basisDocumentUuid || posting)) {
				await assertBasisExists(basisType, basisUuid, prisma, { organizationUuid: finalOrg, posting });
			}
		}
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
			// Серийные номера: число серий строки должно совпадать с количеством.
			await assertDocumentSerials({ docType: "sale", docUuid: existing.uuid, itemModel: "saleItem", parentField: "saleUuid" });
			await assertDocumentBatches({ docType: "sale", docUuid: existing.uuid, itemModel: "saleItem", parentField: "saleUuid" });
			const warehouseUuid =
				data.warehouseUuid !== undefined ? data.warehouseUuid : existing.warehouseUuid;
			// Предпроверка остатка до записи (окончательная — в транзакции commitDocumentHeader).
			await assertStockForPosting("sale", existing.uuid, { warehouseUuid, date: data.date ?? undefined });
			// Бух. проверки проведения (организация, дата, счета, субконто, Дт=Кт).
			await assertPostable("sale", existing.uuid, { ...data, posted: true });
		}
		// Шапка, строки, контроль остатка, регистр и проводки — одной транзакцией под
		// блокировкой документа (У2/У4 аудита 26.09); связи дочитываются после фиксации.
		const item = await commitDocumentHeader({
			documentType: "sale", model: MODEL, uuid: existing.uuid, data, existing,
			itemModel: "saleItem", parentField: "saleUuid",
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
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondOrgAccessError(error, res)) return;
		if (respondBasisError(error, res)) return;
		if (respondOrgFieldError(error, res)) return;
		if (respondStockError(error, res)) return;
		if (respondPostingError(error, res)) return;
		if (respondSerialError(error, res)) return;
		if (respondBatchError(error, res)) return;
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
	await releaseIssuedSerials("sale", doc.uuid);
	// Удаление проведённой реализации задним числом меняет себестоимость последующих
	// документов — пересчёт хвоста (в фоне).
	await recomputeAfterDelete(doc);
};

router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, numberDocType: "sale", onDeleted: onSaleDeleted }),
);

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL, numberDocType: "sale", onDeleted: onSaleDeleted }),
);

export default router;
