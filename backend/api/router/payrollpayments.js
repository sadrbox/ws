import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { clampLimit, sendError } from "../../utils/listQuery.js";
import { tenantFilter, checkOwnership, orgIsAccessible, resolveWritableOrg, respondOrgAccessError, OrgAccessError, requireOwnedRecord, requireOwnedBatch, checkFkOwnership } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { reconcileDocumentEntries, removeDocumentEntries, assertPostable, validatePosting, respondPostingError } from "../../services/accountingPosting.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { assertCashForPosting, respondCashError } from "../../services/cashBalance.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";
import { idSearchCondition } from "../../utils/searchId.js";
import { lockCash, POSTING_TX_OPTIONS } from "../../services/documentLock.js";
const DOC_TYPE = "payroll_payment";

// Выплата через кассу — наличными; способ не задан — тоже касса (как в cashBalance.cashSign).
const paidFromCash = (method) => !method || method === "cash";

const router = express.Router();
const MODEL = "payrollPayment";
const ROUTE = "payroll-payments";
const TEXT_FIELDS = ["comment", "period"];
const INCLUDE = {
	employee: true,
	organization: true,
	author: { select: { uuid: true, username: true, email: true } },
};

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
		const opts = {
			take: limitNumber,
			where: baseWhere,
			orderBy,
			include: INCLUDE,
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
			include: INCLUDE,
		});
		// Чужой документ — «не найден» (Б5 аудита 26.09): зарплата другой организации читалась по id.
		if (!item || !checkOwnership(item, req, "organizationUuid", { allowShared: false }))
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
			period,
			employeeUuid,
			paymentMethod,
			amount,
			posted,
		} = req.body;
		// Организация — доступная пользователю, сотрудник — её (Б8 аудита 26.09).
		const organizationUuid = resolveWritableOrg(req, req.body.organizationUuid);
		const fkError = await checkFkOwnership(req, prisma, [{ model: "employee", uuid: employeeUuid }]);
		if (fkError) throw new OrgAccessError(403, "Сотрудник из недоступной организации");
		// Блокировка закрытого периода: нельзя создавать документ в закрытом месяце.
		await assertPeriodOpen(organizationUuid, date);
		const docNumber = await ensureDocumentNumber({ docType: DOC_TYPE, modelName: MODEL, manual: req.body.number, organizationUuid, date });
		const willPost = posted === undefined ? true : !!posted;
		const docData = {
			number: docNumber,
			date: date ? new Date(date) : new Date(),
			comment: comment?.trim() ?? null,
			period: period?.trim() ?? null,
			employeeUuid: employeeUuid || null,
			organizationUuid: organizationUuid || null,
			paymentMethod: paymentMethod?.trim() ?? "bank_transfer",
			amount: amount != null ? parseFloat(amount) : 0,
			posted: willPost,
			authorUuid: req.user.uuid,
		};
		if (willPost) await validatePosting(DOC_TYPE, docData, []);
		// Выплата наличными (paymentMethod=cash) — из кассы, и касса не может уйти в минус
		// (аудит 26.09, У8); через банк касса не затрагивается — сервис пропустит. Проверка кассы,
		// запись и проводки — одной транзакцией под блокировкой кассы организации (КР-13 аудита
		// 27.09): две выплаты или выплата и РКО одновременно больше не уводят кассу в минус.
		const saved = await prisma.$transaction(async (tx) => {
			if (willPost && paidFromCash(docData.paymentMethod)) {
				await lockCash(tx, docData.organizationUuid);
				await assertCashForPosting(DOC_TYPE, null, docData, tx);
			}
			const row = await tx[MODEL].create({ data: docData, select: { uuid: true, posted: true } });
			if (row.posted) await reconcileDocumentEntries(DOC_TYPE, row.uuid, tx);
			return row;
		}, POSTING_TX_OPTIONS);
		// Связи — после фиксации (внутри транзакции у неё одно соединение).
		const item = await prisma[MODEL].findUnique({ where: { uuid: saved.uuid }, include: INCLUDE });
		return res.status(201).json({ success: true, item });
	} catch (error) {
		if (respondOrgAccessError(error, res)) return;
		if (respondCashError(error, res)) return;
		if (respondPostingError(error, res)) return;
		if (respondPeriodLockError(error, res)) return;
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
			"comment",
			"period",
			"employeeUuid",
			"organizationUuid",
			"paymentMethod",
		];
		for (const f of strFields) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.date !== undefined)
			data.date = req.body.date ? new Date(req.body.date) : null;
		if (req.body.amount !== undefined)
			data.amount = req.body.amount != null ? parseFloat(req.body.amount) : 0;
		if (req.body.posted !== undefined) data.posted = !!req.body.posted;
		const existing = await prisma[MODEL].findUnique({ where: w, select: { uuid: true, posted: true, organizationUuid: true, date: true, number: true, amount: true, paymentMethod: true } });
		// Б5 аудита 26.09: чужой документ по id правился и проводился.
		if (!existing || !checkOwnership(existing, req, "organizationUuid", { allowShared: false })) return res.status(404).json({ success: false, message: "Не найдено" });
		if ("organizationUuid" in data && data.organizationUuid !== existing.organizationUuid) {
			if (!data.organizationUuid && !req.user?.isSuperAdmin) throw new OrgAccessError(400, "Не выбрана организация документа");
			if (data.organizationUuid && !orgIsAccessible(req, data.organizationUuid)) throw new OrgAccessError(403, "Организация недоступна");
		}
		if (data.employeeUuid && await checkFkOwnership(req, prisma, [{ model: "employee", uuid: data.employeeUuid }])) {
			throw new OrgAccessError(403, "Сотрудник из недоступной организации");
		}
		// Блокировка закрытого периода: нельзя трогать закрытый документ и переносить в закрытый период.
		await assertPeriodOpen(existing.organizationUuid, existing.date);
		await assertPeriodOpen(data.organizationUuid ?? existing.organizationUuid, data.date ?? existing.date);
		// Номер: ручной ввод принимаем, иначе сохраняем существующий (без переприсвоения).
		data.number = await ensureDocumentNumber({ docType: DOC_TYPE, modelName: MODEL, manual: req.body.number, existingNumber: existing.number, organizationUuid: data.organizationUuid ?? existing.organizationUuid, date: data.date ?? existing.date, excludeUuid: existing.uuid });
		const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
		if (willBePosted) await assertPostable(DOC_TYPE, existing.uuid, { ...data, posted: true });
		// Выплата наличными — из кассы: на любое изменение касса не должна уйти в минус
		// (аудит 26.09, У8); собственные проводки документа сервис исключает сам. Проверка,
		// запись и проводки — одной транзакцией под блокировкой кассы (КР-13 аудита 27.09).
		const next = {
			organizationUuid: data.organizationUuid ?? existing.organizationUuid,
			date: data.date ?? existing.date,
			amount: data.amount ?? existing.amount,
			paymentMethod: data.paymentMethod ?? existing.paymentMethod,
			posted: willBePosted,
		};
		const saved = await prisma.$transaction(async (tx) => {
			if (paidFromCash(existing.paymentMethod) || paidFromCash(next.paymentMethod)) {
				await lockCash(tx, [existing.organizationUuid, next.organizationUuid]);
				await assertCashForPosting(DOC_TYPE, existing.uuid, next, tx);
			}
			const row = await tx[MODEL].update({ where: { uuid: existing.uuid }, data, select: { uuid: true } });
			await reconcileDocumentEntries(DOC_TYPE, row.uuid, tx);
			return row;
		}, POSTING_TX_OPTIONS);
		const item = await prisma[MODEL].findUnique({ where: { uuid: saved.uuid }, include: INCLUDE });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondOrgAccessError(error, res)) return;
		if (respondCashError(error, res)) return;
		if (respondPostingError(error, res)) return;
		if (respondPeriodLockError(error, res)) return;
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, requireOwnedRecord(MODEL), (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, onDeleted: (doc) => removeDocumentEntries(DOC_TYPE, doc.uuid) }),
);

router.post(`/${ROUTE}/batch-delete`, requireOwnedBatch(MODEL), (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL, onDeleted: (doc) => removeDocumentEntries(DOC_TYPE, doc.uuid) }),
);

export default router;
