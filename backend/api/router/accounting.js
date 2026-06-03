// ─────────────────────────────────────────────────────────────────────────────
// API бухгалтерских отчётов: проводки документа, журнал проводок, ОСВ,
// карточка счёта, аналитика по субконто. Все эндпоинты под префиксом /accounting
// (права — модель AccountingEntry; см. ROUTE_TO_MODEL в utils/auth.js).
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { getDocumentEntries, filterPostedEntries } from "../../services/accountingPosting.js";

const router = express.Router();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Where по проводкам: tenant + период + организация.
function entryWhere(req, { dateFrom, dateTo, organizationUuid } = {}) {
	const where = { ...tenantFilter(req) };
	if (organizationUuid) where.organizationUuid = organizationUuid;
	if (dateFrom || dateTo) {
		where.date = {};
		if (dateFrom) where.date.gte = new Date(dateFrom);
		if (dateTo) where.date.lte = new Date(dateTo + "T23:59:59.999Z");
	}
	return where;
}

// Карта код→{name, accountType} для счетов в области видимости.
async function loadAccountMap(req, organizationUuid) {
	const where = { deletedAt: null };
	if (!req.user?.isSuperAdmin) {
		where.OR = [{ organizationUuid: null }, tenantFilter(req)];
	}
	const accounts = await prisma.chartOfAccount.findMany({
		where,
		select: { code: true, name: true, accountType: true, organizationUuid: true },
		orderBy: { code: "asc" },
	});
	const map = new Map();
	for (const a of accounts) {
		// Приоритет имени: счёт организации перекрывает типовой.
		if (!map.has(a.code) || a.organizationUuid) map.set(a.code, { name: a.name, accountType: a.accountType });
	}
	return map;
}

const DOC_TYPE_LABELS = {
	purchase: "Поступление товаров и услуг",
	sale: "Реализация товаров и услуг",
	sale_return: "Возврат от покупателя",
	purchase_return: "Возврат поставщику",
	cash_receipt_order: "Приходный кассовый ордер",
	cash_expense_order: "Расходный кассовый ордер",
	payroll_calculation: "Начисление зарплаты",
	payroll_payment: "Выплата зарплаты",
};

function analyticsText(list, side) {
	return (list ?? [])
		.filter((a) => a.side === side)
		.map((a) => a.objectName || a.objectUuid)
		.filter(Boolean)
		.join(", ");
}

// ─── GET /accounting/document-entries ────────────────────────────────────────
// Проводки конкретного документа (для Drawer в форме документа).
// Params: documentType, documentUuid
router.get("/accounting/document-entries", async (req, res) => {
	try {
		const { documentType, documentUuid } = req.query;
		if (!documentType || !documentUuid)
			return res.status(400).json({ success: false, message: "documentType и documentUuid обязательны" });
		// Только проводки проведённого документа (непроведённый/удалённый — пусто).
		const entries = await filterPostedEntries(await getDocumentEntries(documentType, documentUuid));
		const accMap = await loadAccountMap(req, entries[0]?.organizationUuid);
		const rows = entries.map((e) => ({
			uuid: e.uuid,
			date: e.date,
			debitAccountCode: e.debitAccountCode,
			debitAccountName: accMap.get(e.debitAccountCode)?.name ?? "",
			creditAccountCode: e.creditAccountCode,
			creditAccountName: accMap.get(e.creditAccountCode)?.name ?? "",
			amount: r2(e.amount),
			description: e.description ?? "",
			debitAnalytics: analyticsText(e.analytics, "debit"),
			creditAnalytics: analyticsText(e.analytics, "credit"),
		}));
		const total = r2(rows.reduce((s, r) => s + r.amount, 0));
		return res.json({ success: true, items: rows, count: rows.length, total });
	} catch (err) {
		console.error("GET /accounting/document-entries error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/journal ─────────────────────────────────────────────────
// Журнал проводок. Params: dateFrom, dateTo, organizationUuid, accountCode,
// counterpartyUuid, productUuid, warehouseUuid, documentType, documentUuid, limit.
router.get("/accounting/journal", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, accountCode, counterpartyUuid, productUuid, warehouseUuid, documentType, documentUuid } = req.query;
		const rawLimit = req.query.limit;
		const limit = Math.min(Math.max(rawLimit !== undefined ? Number(rawLimit) : 2000, 1), 100000);

		const where = entryWhere(req, { dateFrom, dateTo, organizationUuid });
		if (accountCode) where.OR = [{ debitAccountCode: accountCode }, { creditAccountCode: accountCode }];
		if (documentType) where.documentType = documentType;
		if (documentUuid) where.documentUuid = documentUuid;

		// Фильтры по субконто (аналитике).
		const analyticAnd = [];
		if (counterpartyUuid) analyticAnd.push({ subkontoType: "Counterparty", objectUuid: counterpartyUuid });
		if (productUuid) analyticAnd.push({ subkontoType: "Nomenclature", objectUuid: productUuid });
		if (warehouseUuid) analyticAnd.push({ subkontoType: "Warehouse", objectUuid: warehouseUuid });
		if (analyticAnd.length) where.AND = analyticAnd.map((cond) => ({ analytics: { some: cond } }));

		const entries = await filterPostedEntries(await prisma.accountingEntry.findMany({
			where,
			include: { analytics: true },
			orderBy: [{ date: "asc" }, { id: "asc" }],
			take: limit,
		}));
		const accMap = await loadAccountMap(req, organizationUuid);

		const rows = entries.map((e) => ({
			uuid: e.uuid,
			date: e.date?.toISOString().slice(0, 10) ?? "",
			documentType: e.documentType,
			documentTypeLabel: DOC_TYPE_LABELS[e.documentType] ?? e.documentType,
			documentId: e.documentId,
			documentUuid: e.documentUuid,
			debitAccountCode: e.debitAccountCode,
			debitAccountName: accMap.get(e.debitAccountCode)?.name ?? "",
			creditAccountCode: e.creditAccountCode,
			creditAccountName: accMap.get(e.creditAccountCode)?.name ?? "",
			amount: r2(e.amount),
			description: e.description ?? "",
			debitAnalytics: analyticsText(e.analytics, "debit"),
			creditAnalytics: analyticsText(e.analytics, "credit"),
		}));
		const total = r2(rows.reduce((s, x) => s + x.amount, 0));
		return res.json({ success: true, items: rows, count: rows.length, total });
	} catch (err) {
		console.error("GET /accounting/journal error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/balance-sheet ───────────────────────────────────────────
// Оборотно-сальдовая ведомость. Params: dateFrom, dateTo, organizationUuid.
// Сальдо считается через нетто (Дт−Кт): >0 → дебетовое, <0 → кредитовое.
router.get("/accounting/balance-sheet", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		// Все проводки до конца периода (включительно) — для начального сальдо
		// нужны движения ДО dateFrom.
		const where = entryWhere(req, { dateTo, organizationUuid });
		const entries = await filterPostedEntries(await prisma.accountingEntry.findMany({
			where,
			// documentType/documentUuid нужны фильтру проведённости.
			select: { debitAccountCode: true, creditAccountCode: true, amount: true, date: true, documentType: true, documentUuid: true },
		}));
		const from = dateFrom ? new Date(dateFrom) : null;
		const accMap = await loadAccountMap(req, organizationUuid);

		// agg[code] = { openNet, turnDebit, turnCredit }
		const agg = new Map();
		const ensure = (code) => {
			if (!agg.has(code)) agg.set(code, { openNet: 0, turnDebit: 0, turnCredit: 0 });
			return agg.get(code);
		};
		for (const e of entries) {
			const amt = Number(e.amount) || 0;
			const inPeriod = !from || e.date >= from;
			const d = ensure(e.debitAccountCode);
			const c = ensure(e.creditAccountCode);
			if (inPeriod) {
				d.turnDebit += amt;
				c.turnCredit += amt;
			} else {
				d.openNet += amt; // дебет до периода
				c.openNet -= amt; // кредит до периода
			}
		}

		const rows = [];
		for (const [code, a] of agg.entries()) {
			const openNet = r2(a.openNet);
			const turnDebit = r2(a.turnDebit);
			const turnCredit = r2(a.turnCredit);
			const closeNet = r2(openNet + turnDebit - turnCredit);
			if (!openNet && !turnDebit && !turnCredit && !closeNet) continue;
			rows.push({
				code,
				name: accMap.get(code)?.name ?? "",
				openDebit: openNet > 0 ? openNet : 0,
				openCredit: openNet < 0 ? -openNet : 0,
				turnDebit,
				turnCredit,
				closeDebit: closeNet > 0 ? closeNet : 0,
				closeCredit: closeNet < 0 ? -closeNet : 0,
			});
		}
		rows.sort((a, b) => a.code.localeCompare(b.code));
		const totals = rows.reduce(
			(t, r) => ({
				openDebit: r2(t.openDebit + r.openDebit),
				openCredit: r2(t.openCredit + r.openCredit),
				turnDebit: r2(t.turnDebit + r.turnDebit),
				turnCredit: r2(t.turnCredit + r.turnCredit),
				closeDebit: r2(t.closeDebit + r.closeDebit),
				closeCredit: r2(t.closeCredit + r.closeCredit),
			}),
			{ openDebit: 0, openCredit: 0, turnDebit: 0, turnCredit: 0, closeDebit: 0, closeCredit: 0 },
		);
		return res.json({ success: true, items: rows, totals });
	} catch (err) {
		console.error("GET /accounting/balance-sheet error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/account-card ────────────────────────────────────────────
// Карточка счёта. Params: accountCode (обязателен), dateFrom, dateTo,
// organizationUuid. Возвращает начальное сальдо, обороты по строкам с
// нарастающим остатком, конечное сальдо.
router.get("/accounting/account-card", async (req, res) => {
	try {
		const { accountCode, dateFrom, dateTo, organizationUuid } = req.query;
		if (!accountCode) return res.status(400).json({ success: false, message: "accountCode обязателен" });

		const where = entryWhere(req, { dateTo, organizationUuid });
		where.OR = [{ debitAccountCode: accountCode }, { creditAccountCode: accountCode }];
		const entries = await filterPostedEntries(await prisma.accountingEntry.findMany({
			where,
			include: { analytics: true },
			orderBy: [{ date: "asc" }, { id: "asc" }],
		}));
		const from = dateFrom ? new Date(dateFrom) : null;
		const accMap = await loadAccountMap(req, organizationUuid);

		let opening = 0; // нетто Дт−Кт до периода
		let turnDebit = 0;
		let turnCredit = 0;
		const rows = [];
		// Нарастающий остаток внутри периода (от начального сальдо).
		// Сначала посчитаем opening по движениям до периода.
		for (const e of entries) {
			const amt = Number(e.amount) || 0;
			const isDebit = e.debitAccountCode === accountCode;
			const signed = isDebit ? amt : -amt;
			if (from && e.date < from) {
				opening += signed;
			}
		}
		let running = opening;
		for (const e of entries) {
			if (from && e.date < from) continue;
			const amt = Number(e.amount) || 0;
			const isDebit = e.debitAccountCode === accountCode;
			running += isDebit ? amt : -amt;
			if (isDebit) turnDebit += amt;
			else turnCredit += amt;
			const corr = isDebit ? e.creditAccountCode : e.debitAccountCode;
			rows.push({
				uuid: e.uuid,
				date: e.date?.toISOString().slice(0, 10) ?? "",
				documentType: e.documentType,
				documentTypeLabel: DOC_TYPE_LABELS[e.documentType] ?? e.documentType,
				documentId: e.documentId,
				documentUuid: e.documentUuid,
				corrAccountCode: corr,
				corrAccountName: accMap.get(corr)?.name ?? "",
				debit: isDebit ? r2(amt) : 0,
				credit: isDebit ? 0 : r2(amt),
				balance: r2(running),
				description: e.description ?? "",
				analytics: analyticsText(e.analytics, isDebit ? "debit" : "credit"),
			});
		}
		return res.json({
			success: true,
			accountCode,
			accountName: accMap.get(accountCode)?.name ?? "",
			opening: r2(opening),
			turnDebit: r2(turnDebit),
			turnCredit: r2(turnCredit),
			closing: r2(opening + turnDebit - turnCredit),
			items: rows,
		});
	} catch (err) {
		console.error("GET /accounting/account-card error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/subkonto ────────────────────────────────────────────────
// Аналитика по субконто. Params: subkontoType (обязателен), dateFrom, dateTo,
// organizationUuid, accountCode (опц.). Группирует обороты по объекту аналитики.
router.get("/accounting/subkonto", async (req, res) => {
	try {
		const { subkontoType, dateFrom, dateTo, organizationUuid, accountCode } = req.query;
		if (!subkontoType) return res.status(400).json({ success: false, message: "subkontoType обязателен" });

		const where = entryWhere(req, { dateFrom, dateTo, organizationUuid });
		if (accountCode) where.OR = [{ debitAccountCode: accountCode }, { creditAccountCode: accountCode }];
		where.analytics = { some: { subkontoType } };

		const entries = await filterPostedEntries(await prisma.accountingEntry.findMany({
			where,
			include: { analytics: true },
			orderBy: [{ date: "asc" }, { id: "asc" }],
		}));

		// group[objectUuid] = { objectName, debit, credit }
		const group = new Map();
		for (const e of entries) {
			const amt = Number(e.amount) || 0;
			for (const a of e.analytics) {
				if (a.subkontoType !== subkontoType) continue;
				const key = a.objectUuid ?? "__none__";
				if (!group.has(key)) group.set(key, { objectUuid: a.objectUuid, objectName: a.objectName || a.objectUuid || "—", debit: 0, credit: 0 });
				const g = group.get(key);
				if (a.side === "debit") g.debit += amt;
				else g.credit += amt;
			}
		}
		const rows = Array.from(group.values()).map((g) => ({
			objectUuid: g.objectUuid,
			objectName: g.objectName,
			debit: r2(g.debit),
			credit: r2(g.credit),
			balance: r2(g.debit - g.credit),
		}));
		rows.sort((a, b) => String(a.objectName).localeCompare(String(b.objectName), "ru"));
		return res.json({ success: true, subkontoType, items: rows });
	} catch (err) {
		console.error("GET /accounting/subkonto error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
