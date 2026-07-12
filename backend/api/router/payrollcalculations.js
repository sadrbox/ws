import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { reconcileDocumentEntries, removeDocumentEntries, assertPostable, validatePosting, respondPostingError } from "../../services/accountingPosting.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { ensureDocumentNumber } from "../../services/documentNumberAssign.js";
import { idSearchCondition } from "../../utils/searchId.js";
const DOC_TYPE = "payroll_calculation";

const router = express.Router();
const MODEL = "payrollCalculation";
const ROUTE = "payroll-calculations";
const TEXT_FIELDS = ["comment", "period"];
const INCLUDE = {
	employee: true,
	organization: true,
	position: true,
	author: { select: { uuid: true, username: true, email: true } },
};

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
			include: INCLUDE,
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
			period,
			employeeUuid,
			organizationUuid,
			positionUuid,
			baseSalary,
			opv,
			ipn,
			socialContrib,
			socialTax,
			vosms,
			oosms,
			netSalary,
			totalExpense,
			posted,
		} = req.body;
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
			positionUuid: positionUuid || null,
			baseSalary: baseSalary != null ? parseFloat(baseSalary) : 0,
			opv: opv != null ? parseFloat(opv) : 0,
			ipn: ipn != null ? parseFloat(ipn) : 0,
			socialContrib: socialContrib != null ? parseFloat(socialContrib) : 0,
			socialTax: socialTax != null ? parseFloat(socialTax) : 0,
			vosms: vosms != null ? parseFloat(vosms) : 0,
			oosms: oosms != null ? parseFloat(oosms) : 0,
			netSalary: netSalary != null ? parseFloat(netSalary) : 0,
			totalExpense: totalExpense != null ? parseFloat(totalExpense) : 0,
			posted: willPost,
			authorUuid: req.user.uuid,
		};
		if (willPost) await validatePosting(DOC_TYPE, docData, []);
		const item = await prisma[MODEL].create({ data: docData, include: INCLUDE });
		if (item.posted) await reconcileDocumentEntries(DOC_TYPE, item.uuid);
		return res.status(201).json({ success: true, item });
	} catch (error) {
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
			"positionUuid",
		];
		for (const f of strFields) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.date !== undefined)
			data.date = req.body.date ? new Date(req.body.date) : null;
		const numFields = [
			"baseSalary",
			"opv",
			"ipn",
			"socialContrib",
			"socialTax",
			"vosms",
			"oosms",
			"netSalary",
			"totalExpense",
		];
		for (const f of numFields) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f] != null ? parseFloat(req.body[f]) : 0;
		}
		if (req.body.posted !== undefined) data.posted = !!req.body.posted;
		const existing = await prisma[MODEL].findUnique({ where: w, select: { uuid: true, posted: true, organizationUuid: true, date: true, number: true } });
		if (!existing) return res.status(404).json({ success: false, message: "Не найдено" });
		// Блокировка закрытого периода: нельзя трогать закрытый документ и переносить в закрытый период.
		await assertPeriodOpen(existing.organizationUuid, existing.date);
		await assertPeriodOpen(data.organizationUuid ?? existing.organizationUuid, data.date ?? existing.date);
		// Номер: ручной ввод принимаем, иначе сохраняем существующий (без переприсвоения).
		data.number = await ensureDocumentNumber({ docType: DOC_TYPE, modelName: MODEL, manual: req.body.number, existingNumber: existing.number, organizationUuid: data.organizationUuid ?? existing.organizationUuid, date: data.date ?? existing.date, excludeUuid: existing.uuid });
		const willBePosted = data.posted !== undefined ? data.posted : existing.posted;
		if (willBePosted) await assertPostable(DOC_TYPE, existing.uuid, { ...data, posted: true });
		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: INCLUDE,
		});
		await reconcileDocumentEntries(DOC_TYPE, item.uuid);
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (respondPostingError(error, res)) return;
		if (respondPeriodLockError(error, res)) return;
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL, onDeleted: (doc) => removeDocumentEntries(DOC_TYPE, doc.uuid) }),
);

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL, onDeleted: (doc) => removeDocumentEntries(DOC_TYPE, doc.uuid) }),
);

export default router;
