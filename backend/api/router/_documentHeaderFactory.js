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
import { clampLimit, sendError } from "../../utils/listQuery.js";
import { buildNestedItemsConditions } from "../../utils/nestedSearch.js";
import { tenantFilter, checkOwnership, orgIsAccessible, resolveWritableOrg, respondOrgAccessError, OrgAccessError, requireOwnedRecord, requireOwnedBatch } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import {
	reconcileDocumentEntries,
	removeDocumentEntries,
	assertPostable,
	validatePosting,
	respondPostingError,
	monthCloseOverlapError,
} from "../../services/accountingPosting.js";
import { POSTING_TX_OPTIONS } from "../../services/documentLock.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { assertBasisExists, respondBasisError } from "../../services/basisValidation.js";
import { idSearchCondition } from "../../utils/searchId.js";

const BASIS_FIELDS = ["basisDocumentType", "basisDocumentUuid", "basisDocumentLabel"];

/**
 * Документ и его проводки — ОДНОЙ транзакцией (P3 аудита 27.09): раньше шапка писалась, а
 * сбой проводок давал 500 при уже сохранённой шапке (проведённый документ без проводок или
 * с прежними). write(tx) → uuid записанного документа. Без проведения — просто запись.
 */
async function writeWithEntries(posting, write) {
	if (!posting) return write(prisma);
	return prisma.$transaction(async (tx) => {
		const uuid = await write(tx);
		await reconcileDocumentEntries(posting.docType, uuid, tx);
		return uuid;
	}, POSTING_TX_OPTIONS);
}

export function createDocumentHeaderRouter({
	MODEL,
	ROUTE,
	// Вид документа для нумерации (по умолчанию — тип проведения, если задан).
	numberDocType = null,
	TEXT_FIELDS = ["comment"],
	stringFields = ["organizationUuid", "counterpartyUuid", "contractUuid"],
	numberFields = ["amount"],
	// Доп. поля-даты (DateTime) помимо `date` — например период закрытия месяца.
	dateFields = [],
	include = {
		organization: true,
		counterparty: true,
		contract: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	hasBasis = false,
	posting = null,
	defaultPosted = false,
	// Документ исключён из блокировки закрытых периодов (например month_close —
	// сам управляет границей и должен оставаться редактируемым).
	periodExempt = false,
	// Доп. хуки: afterSave(uuid) — после create/update; afterDelete(doc) — после удаления.
	afterSave = null,
	afterDelete = null,
}) {
	const router = express.Router();

	// Два одновременных проведённых закрытия одного месяца: проверку пересечения проходят оба,
	// второе ловит частичный уникальный индекс month_closes_posted_period_uq (P2002) — это 409
	// «период уже закрыт», а не «Ошибка сервера» (КР-14 аудита 27.09). Других уникальных
	// ограничений, кроме uuid, у закрытия нет.
	const respondPeriodCloseConflict = async (error, doc, res) => {
		if (MODEL !== "monthClose" || error?.code !== "P2002") return false;
		return respondPostingError(await monthCloseOverlapError(doc), res);
	};

	// ── GET list ─────────────────────────────────────────────────────────────
	router.get(`/${ROUTE}`, async (req, res) => {
		try {
			const rawLimit = req.query.limit;
			const rawCursor = req.query.cursor;
			const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
			const limitNumber = clampLimit(rawLimit);
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
			// Ошибка ввода (кривая дата, поле фильтра) — 400, остальное — 500 с записью в журнал.
			return sendError(res, error, { message: "Ошибка сервера", label: `GET /${ROUTE}` });
		}
	});

	// ── GET by id/uuid ─────────────────────────────────────────────────────────
	router.get(`/${ROUTE}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			const item = await prisma[MODEL].findUnique({ where: w, include });
			// Чужой документ — «не найден» (Б5 аудита 26.09: документ искался по числовому id без
			// проверки владельца, и чужие выписки, заказы, закрытия месяца читались перебором).
			if (!item || !checkOwnership(item, req, "organizationUuid", { allowShared: false })) return res.status(404).json({ success: false, message: "Не найдено" });
			return res.status(200).json({ success: true, item });
		} catch (error) {
			console.error(`GET /${ROUTE}/:id error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── POST create ────────────────────────────────────────────────────────────
	router.post(`/${ROUTE}`, async (req, res) => {
		let conflictDoc = null;
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
			for (const f of dateFields) data[f] = b[f] ? new Date(b[f]) : null;
			if (hasBasis) for (const f of BASIS_FIELDS) data[f] = b[f] || null;
			// Организация документа — доступная пользователю (Б8 аудита 26.09): иначе документ,
			// в том числе закрытие месяца, создавался и проводился в чужой организации.
			if (stringFields.includes("organizationUuid")) data.organizationUuid = resolveWritableOrg(req, data.organizationUuid);
			// Запрещаем ссылку «в никуда»: основание (если указано) должно существовать.
			if (hasBasis && data.basisDocumentUuid) await assertBasisExists(data.basisDocumentType, data.basisDocumentUuid);

			// Номер документа: автоматически при записи (ручной/импорт или автоген) + уникальность.
			const ndt = numberDocType || posting?.docType || null;
			if (ndt) data.number = await ensureDocumentNumber({ docType: ndt, modelName: MODEL, manual: b.number, organizationUuid: data.organizationUuid, date: data.date });

			// Stage D: org-зависимые поля должны принадлежать организации документа.
			await assertOrgFieldMembership(data, prisma);
			// Блокировка закрытого периода (кроме документов с periodExempt — month_close).
			if (!periodExempt) await assertPeriodOpen(data.organizationUuid, data.date);
			if (posting && data.posted) await validatePosting(posting.docType, data, []);
			conflictDoc = data;
			const uuid = await writeWithEntries(posting, async (c) => (await c[MODEL].create({ data, select: { uuid: true } })).uuid);
			if (afterSave) await afterSave(uuid);
			// Связи — после фиксации (внутри транзакции у неё одно соединение).
			const item = await prisma[MODEL].findUnique({ where: { uuid }, include });
			return res.status(201).json({ success: true, item });
		} catch (error) {
			if (await respondPeriodCloseConflict(error, conflictDoc, res)) return;
			if (respondOrgAccessError(error, res)) return;
			if (respondBasisError(error, res)) return;
			if (respondOrgFieldError(error, res)) return;
			if (respondPeriodLockError(error, res)) return;
			if (respondDuplicateNumberError(error, res)) return;
			if (posting && respondPostingError(error, res)) return;
			console.error(`POST /${ROUTE} error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── PUT update ─────────────────────────────────────────────────────────────
	router.put(`/${ROUTE}/:id`, async (req, res) => {
		let conflictDoc = null;
		try {
			const p = req.params.id;
			const n = Number(p);
			const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			const b = req.body;
			const data = {};
			for (const f of stringFields) if (b[f] !== undefined) data[f] = b[f]?.trim?.() ?? b[f] ?? null;
			for (const f of numberFields) if (b[f] !== undefined) data[f] = b[f] != null ? parseFloat(b[f]) : null;
			for (const f of dateFields) if (b[f] !== undefined) data[f] = b[f] ? new Date(b[f]) : null;
			if (b.number !== undefined) data.number = b.number?.trim?.() || null;
			if (b.date !== undefined) data.date = b.date ? new Date(b.date) : null;
			if (b.posted !== undefined) data.posted = !!b.posted;
			if (hasBasis) for (const f of BASIS_FIELDS) if (b[f] !== undefined) data[f] = b[f] || null;

			// Существующий документ нужен и для проверки принадлежности полей
			// организации (мерж data поверх текущих значений ловит и смену орг,
			// и смену поля), и для проверки проведения.
			const existing = await prisma[MODEL].findUnique({ where: w });
			// Б5 аудита 26.09: `PUT /month-closes/5 {posted:false}` от пользователя организации A
			// открывал закрытый период организации B. Чужой документ — 404, перенос — только
			// в доступную организацию.
			if (!existing || !checkOwnership(existing, req, "organizationUuid", { allowShared: false })) return res.status(404).json({ success: false, message: "Не найдено" });
			if ("organizationUuid" in data && data.organizationUuid !== existing.organizationUuid) {
				if (!data.organizationUuid && !req.user?.isSuperAdmin) throw new OrgAccessError(400, "Не выбрана организация документа");
				if (data.organizationUuid && !orgIsAccessible(req, data.organizationUuid)) throw new OrgAccessError(403, "Организация недоступна");
			}

			// Запрещаем ссылку «в никуда»: проверяем только при ЗАДАНИИ нового основания
			// (очистку и нетронутое основание пропускаем — чтобы можно было чинить старое).
			if (hasBasis && data.basisDocumentUuid) await assertBasisExists(data.basisDocumentType ?? existing.basisDocumentType, data.basisDocumentUuid);

			// Блокировка закрытого периода: нельзя трогать закрытый документ и переносить
			// его в закрытый период (кроме документов с periodExempt — month_close).
			if (!periodExempt) {
				await assertPeriodOpen(existing.organizationUuid, existing.date);
				await assertPeriodOpen(data.organizationUuid ?? existing.organizationUuid, data.date ?? existing.date);
			}

			// Номер документа: гарантируем при записи (автоген если пусто) + уникальность.
			{
				const ndt = numberDocType || posting?.docType || null;
				if (ndt) {
					const _num = await ensureDocumentNumber({ docType: ndt, modelName: MODEL, manual: data.number, existingNumber: existing.number, organizationUuid: data.organizationUuid ?? existing.organizationUuid, date: data.date ?? existing.date, excludeUuid: existing.uuid });
					if (_num) data.number = _num; // всегда фиксируем итоговый номер (в т.ч. при очистке поля)
				}
			}

			// Stage D: org-зависимые поля принадлежат организации документа.
			await assertOrgFieldMembership({ ...existing, ...data }, prisma);

			if (posting) {
				const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
				if (willBePosted) await assertPostable(posting.docType, existing.uuid, { ...data, posted: true });
			}
			conflictDoc = { ...existing, ...data };
			const uuid = await writeWithEntries(posting, async (c) => (await c[MODEL].update({ where: { uuid: existing.uuid }, data, select: { uuid: true } })).uuid);
			if (afterSave) await afterSave(uuid);
			const item = await prisma[MODEL].findUnique({ where: { uuid }, include });
			return res.status(200).json({ success: true, item });
		} catch (error) {
			if (await respondPeriodCloseConflict(error, conflictDoc, res)) return;
			if (respondOrgAccessError(error, res)) return;
			if (respondBasisError(error, res)) return;
			if (respondOrgFieldError(error, res)) return;
			if (respondPeriodLockError(error, res)) return;
			if (respondDuplicateNumberError(error, res)) return;
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
	// Владелец проверяется строго (документ без организации — не «общий»), затем общий обработчик.
	router.delete(`/${ROUTE}/:id`, requireOwnedRecord(MODEL), (req, res) => handleDelete({ req, res, prisma, modelName: MODEL, onDeleted, numberDocType: numberDocType || posting?.docType || null }));
	router.post(`/${ROUTE}/batch-delete`, requireOwnedBatch(MODEL), (req, res) => handleBatchDelete({ req, res, prisma, modelName: MODEL, onDeleted, numberDocType: numberDocType || posting?.docType || null }));

	return router;
}
