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
import { clampLimit, sendError } from "../../utils/listQuery.js";
import { tenantFilter, checkOwnership, orgIsAccessible, resolveWritableOrg, respondOrgAccessError, OrgAccessError } from "../../utils/auth.js";
import { assertOrgFieldMembership, respondOrgFieldError } from "../../utils/orgFieldValidation.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { reconcileDocumentEntries, removeDocumentEntries, assertPostable, validatePosting, respondPostingError } from "../../services/accountingPosting.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { assertCashForPosting, respondCashError } from "../../services/cashBalance.js";
import { respondDuplicateNumberError } from "../../utils/uniqueNumber.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";
import { assertBasisExists, respondBasisError } from "../../services/basisValidation.js";
import { idSearchCondition } from "../../utils/searchId.js";
import { lockCash, POSTING_TX_OPTIONS } from "../../services/documentLock.js";

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
			const limitNumber = clampLimit(rawLimit);
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
			// Ошибка ввода (кривая дата, поле фильтра) — 400, остальное — 500 с записью в журнал.
			return sendError(res, error, { message: "Ошибка сервера", label: `GET /${route}` });
		}
	});

	router.get(`/${route}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			// findFirst c direction — чтобы маршрут отдавал только свой тип ордера.
			const item = await prisma[MODEL].findFirst({ where: { ...w, direction }, include: INCLUDE });
			if (!item || !checkOwnership(item, req, "organizationUuid", { allowShared: false }))
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
			// Организация ордера — доступная пользователю (Б8 аудита 26.09).
			const docOrg = resolveWritableOrg(req, organizationUuid);
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
				organizationUuid: docOrg,
				counterpartyUuid: counterpartyUuid || null,
				contractUuid: contractUuid || null,
				cashboxUuid: cashboxUuid || null,
				employeeUuid: employeeUuid || null,
				posted: willPost,
				authorUuid: req.user.uuid,
			};
			// Запрещаем ссылку «в никуда»: основание (если указано) должно существовать.
			if (docData.basisDocumentUuid) await assertBasisExists(docData.basisDocumentType, docData.basisDocumentUuid);
			await assertOrgFieldMembership(docData, prisma);
			// Блокировка закрытого периода: нельзя создавать кассовый ордер в закрытом месяце.
			await assertPeriodOpen(docData.organizationUuid, docData.date);
			if (willPost) await validatePosting(docType, docData, []);
			// Номер документа: автоматически при записи (ручной/импорт или автоген) + уникальность.
			docData.number = await ensureDocumentNumber({ docType, modelName: MODEL, manual: req.body.number, organizationUuid: docData.organizationUuid, date: docData.date, uniqueWhere: { direction } });
			// Проверка кассы, запись ордера и его проводки — ОДНОЙ транзакцией под блокировкой кассы
			// организации (КР-13 аудита 27.09). Раньше остаток проверялся вне транзакции и без
			// блокировки: касса 1000, два РКО по 600 одновременно — оба 201, сальдо −200. Теперь
			// второй ждёт первого и проверяет остаток уже с его проводками; сбой проводок
			// откатывает и сам ордер (P3: шапка без проводок больше не остаётся).
			const saved = await prisma.$transaction(async (tx) => {
				if (willPost) {
					await lockCash(tx, docData.organizationUuid);
					await assertCashForPosting(docType, null, docData, tx);
				}
				const row = await tx[MODEL].create({ data: docData, select: { uuid: true, posted: true } });
				if (row.posted) await reconcileDocumentEntries(docType, row.uuid, tx);
				return row;
			}, POSTING_TX_OPTIONS);
			// Связи — после фиксации (внутри транзакции у неё одно соединение).
			const item = await prisma[MODEL].findUnique({ where: { uuid: saved.uuid }, include: INCLUDE });
			return res.status(201).json({ success: true, item });
		} catch (error) {
			if (respondOrgAccessError(error, res)) return;
			if (respondBasisError(error, res)) return;
			if (respondOrgFieldError(error, res)) return;
			if (respondPeriodLockError(error, res)) return;
			if (respondDuplicateNumberError(error, res)) return;
			if (respondCashError(error, res)) return;
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
			const existing = await prisma[MODEL].findFirst({ where: { ...w, direction }, select: { uuid: true, organizationUuid: true, posted: true, number: true, contractUuid: true, cashboxUuid: true, date: true, basisDocumentType: true, amount: true } });
			if (!existing || !checkOwnership(existing, req, "organizationUuid", { allowShared: false }))
				return res.status(404).json({ success: false, message: "Не найдено" });
			// Перенос в другую организацию — только в доступную (Б8 аудита 26.09).
			if ("organizationUuid" in data && data.organizationUuid !== existing.organizationUuid) {
				if (!data.organizationUuid && !req.user?.isSuperAdmin) throw new OrgAccessError(400, "Не выбрана организация документа");
				if (data.organizationUuid && !orgIsAccessible(req, data.organizationUuid)) throw new OrgAccessError(403, "Организация недоступна");
			}
			// Запрещаем ссылку «в никуда»: проверяем только при ЗАДАНИИ нового основания.
			if (data.basisDocumentUuid) await assertBasisExists(data.basisDocumentType ?? existing.basisDocumentType, data.basisDocumentUuid);
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
			// Касса не уходит в минус — на ЛЮБОЕ изменение (аудит 26.09, У8): распроведение,
			// уменьшение или перенос ПКО, из которого уже выдано, тоже оставляют выданные деньги
			// без источника. Собственные проводки документа сервис исключает сам. Проверка, запись
			// и проводки — одной транзакцией под блокировкой кассы (КР-13 аудита 27.09); перенос в
			// другую организацию — под блокировками обеих, и прежняя касса проверяется на уход ордера.
			const next = {
				organizationUuid: data.organizationUuid ?? existing.organizationUuid,
				date: data.date ?? existing.date,
				amount: data.amount ?? existing.amount,
				posted: willBePosted,
			};
			const saved = await prisma.$transaction(async (tx) => {
				await lockCash(tx, [existing.organizationUuid, next.organizationUuid]);
				if (existing.organizationUuid && existing.organizationUuid !== next.organizationUuid) {
					await assertCashForPosting(docType, existing.uuid, { ...next, organizationUuid: existing.organizationUuid, posted: false }, tx);
				}
				await assertCashForPosting(docType, existing.uuid, next, tx);
				const row = await tx[MODEL].update({ where: { uuid: existing.uuid }, data, select: { uuid: true } });
				await reconcileDocumentEntries(docType, row.uuid, tx);
				return row;
			}, POSTING_TX_OPTIONS);
			const item = await prisma[MODEL].findUnique({ where: { uuid: saved.uuid }, include: INCLUDE });
			return res.status(200).json({ success: true, item });
		} catch (error) {
			if (respondOrgAccessError(error, res)) return;
			if (respondBasisError(error, res)) return;
			if (respondOrgFieldError(error, res)) return;
			if (respondPeriodLockError(error, res)) return;
			if (respondCashError(error, res)) return;
			if (respondPostingError(error, res)) return;
			if (respondDuplicateNumberError(error, res)) return;
			if (error.code === "P2025") return res.status(404).json({ success: false, message: "Не найдено" });
			console.error(`PUT /${route}/:id error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	/*
	 * УДАЛЕНИЕ — ТОЛЬКО СВОЕГО НАПРАВЛЕНИЯ (У8 аудита 26.09). ПКО и РКО лежат в одной таблице,
	 * а общий обработчик ищет запись только по id/uuid: через `/cash-receipt-orders` удалялся
	 * РКО, и его проводки (снимаются по docType маршрута) оставались сиротами. Сверяем
	 * направление и владельца ДО общего обработчика; ордер без организации — не «общий».
	 */
	const sameDirectionOwned = (row, req) => !!row && row.direction === direction && checkOwnership(row, req, "organizationUuid", { allowShared: false });
	// Удалить проведённый ПКО, из которого уже выдано, нельзя — касса уйдёт в минус (У8): 409.
	// РКО удалением кассу только пополняет — проверка не нужна. Проверка, снятие проводок и само
	// удаление — ОДНОЙ транзакцией (КР-13 аудита 27.09, хук inTransaction общего обработчика) под
	// блокировкой кассы организации: раньше проверка шла до обработчика, а удаление и снятие
	// проводок — после, и РКО, проведённый в этот промежуток, видел ещё не снятые проводки ПКО —
	// касса уходила в минус. В пакете каждый ордер проверяется с учётом уже удалённых.
	const removeInTransaction = async (tx, row) => {
		if (direction === "receipt" && row?.posted && !row.deletedAt) {
			await lockCash(tx, row.organizationUuid);
			await assertCashForPosting(docType, row.uuid, { organizationUuid: row.organizationUuid, date: row.date, amount: row.amount, posted: false }, tx);
		}
		await removeDocumentEntries(docType, row.uuid, tx);
	};
	const respondRemoveError = (err, res) => respondCashError(err, res) || respondPostingError(err, res);
	const DELETE_SELECT = { uuid: true, direction: true, organizationUuid: true };
	router.delete(`/${route}/:id`, async (req, res, next) => {
		try {
			const n = Number(req.params.id);
			const where = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(req.params.id) };
			const row = await prisma[MODEL].findUnique({ where, select: DELETE_SELECT });
			if (!sameDirectionOwned(row, req)) return res.status(404).json({ success: false, message: "Не найдено" });
			return next();
		} catch (error) {
			console.error(`DELETE /${route}/:id error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	}, (req, res) =>
		handleDelete({ req, res, prisma, modelName: MODEL, numberDocType: docType, inTransaction: removeInTransaction, respondError: respondRemoveError }),
	);
	router.post(`/${route}/batch-delete`, async (req, res, next) => {
		try {
			const uuids = Array.isArray(req.body?.uuids) ? req.body.uuids.filter((u) => typeof u === "string") : null;
			if (!uuids) return next();
			const rows = await prisma[MODEL].findMany({ where: { uuid: { in: uuids } }, select: DELETE_SELECT });
			if (rows.some((r) => !sameDirectionOwned(r, req))) {
				return res.status(404).json({ success: false, message: "Часть записей не найдена — удаление не выполнено" });
			}
			return next();
		} catch (error) {
			console.error(`POST /${route}/batch-delete error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	}, (req, res) =>
		handleBatchDelete({ req, res, prisma, modelName: MODEL, numberDocType: docType, inTransaction: removeInTransaction, respondError: respondRemoveError }),
	);

	return router;
}
