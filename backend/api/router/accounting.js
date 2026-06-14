// ─────────────────────────────────────────────────────────────────────────────
// API бухгалтерских отчётов: проводки документа, журнал проводок, ОСВ,
// карточка счёта, аналитика по субконто. Все эндпоинты под префиксом /accounting
// (права — модель AccountingEntry; см. ROUTE_TO_MODEL в utils/auth.js).
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { getDocumentEntries, filterPostedEntries } from "../../services/accountingPosting.js";
import { getClosedBoundary } from "../../services/periodLock.js";

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

// ─── GET /accounting/settlements ─────────────────────────────────────────────
// Взаиморасчёты по контрагентам (дебиторка 1210 / кредиторка 3310): входящее
// сальдо, обороты Дт/Кт за период, исходящее сальдо + старение долга (aging).
// Params: dateFrom, dateTo, organizationUuid, accountCode (1210|3310, по умолч.
// 1210), counterpartyUuid (опц.).
router.get("/accounting/settlements", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, counterpartyUuid } = req.query;
		const acc = req.query.accountCode === "3310" ? "3310" : "1210";
		const accMap = await loadAccountMap(req, organizationUuid);
		const isActive = (accMap.get(acc)?.accountType ?? (acc[0] === "1" ? "active" : "passive")) === "active";

		const where = entryWhere(req, { dateTo, organizationUuid });
		where.OR = [{ debitAccountCode: acc }, { creditAccountCode: acc }];
		if (counterpartyUuid) where.analytics = { some: { subkontoType: "Counterparty", objectUuid: counterpartyUuid } };

		const entries = await filterPostedEntries(await prisma.accountingEntry.findMany({
			where, include: { analytics: true }, orderBy: [{ date: "asc" }, { id: "asc" }],
		}));

		const from = dateFrom ? new Date(dateFrom) : null;
		const to = dateTo ? new Date(dateTo + "T23:59:59.999Z") : new Date();
		const dayMs = 86400000;

		// group[cpUuid] = { name, opening, turnDebit, turnCredit, b0_30, b31_60, b61_90, b90 }
		const group = new Map();
		const ensure = (uuid, name) => {
			const k = uuid ?? "__none__";
			if (!group.has(k)) group.set(k, { counterpartyUuid: uuid ?? null, counterpartyName: name || "— без контрагента —", opening: 0, turnDebit: 0, turnCredit: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0 });
			return group.get(k);
		};

		for (const e of entries) {
			const amt = Number(e.amount) || 0;
			const onDebit = e.debitAccountCode === acc;
			const side = onDebit ? "debit" : "credit";
			// Контрагент берём из аналитики той стороны, где наш счёт.
			const cpAn = (e.analytics || []).find((a) => a.side === side && a.subkontoType === "Counterparty")
				|| (e.analytics || []).find((a) => a.subkontoType === "Counterparty");
			const g = ensure(cpAn?.objectUuid, cpAn?.objectName);
			// Дт/Кт оборот самого счёта.
			const accDebit = onDebit ? amt : 0;
			const accCredit = onDebit ? 0 : amt;
			// Вклад в сальдо: активный = Дт−Кт, пассивный = Кт−Дт.
			const contrib = isActive ? accDebit - accCredit : accCredit - accDebit;

			const inPeriod = !from || e.date >= from;
			if (inPeriod) {
				g.turnDebit += accDebit;
				g.turnCredit += accCredit;
			} else {
				g.opening += contrib;
			}
			// Старение исходящего сальдо по возрасту проводки (приближённо, без
			// FIFO-сопоставления оплат): сумма по бакетам = исходящее сальдо.
			const age = Math.floor((to - e.date) / dayMs);
			if (age <= 30) g.b0_30 += contrib;
			else if (age <= 60) g.b31_60 += contrib;
			else if (age <= 90) g.b61_90 += contrib;
			else g.b90 += contrib;
		}

		const rows = [];
		for (const g of group.values()) {
			const opening = r2(g.opening);
			const turnDebit = r2(g.turnDebit);
			const turnCredit = r2(g.turnCredit);
			const closing = r2(opening + (isActive ? turnDebit - turnCredit : turnCredit - turnDebit));
			if (!opening && !turnDebit && !turnCredit && !closing) continue;
			rows.push({
				counterpartyUuid: g.counterpartyUuid,
				counterpartyName: g.counterpartyName,
				opening, turnDebit, turnCredit, closing,
				aging: { d0_30: r2(g.b0_30), d31_60: r2(g.b31_60), d61_90: r2(g.b61_90), d90: r2(g.b90) },
			});
		}
		rows.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));

		const totals = rows.reduce((t, r) => ({
			opening: r2(t.opening + r.opening), turnDebit: r2(t.turnDebit + r.turnDebit),
			turnCredit: r2(t.turnCredit + r.turnCredit), closing: r2(t.closing + r.closing),
			d0_30: r2(t.d0_30 + r.aging.d0_30), d31_60: r2(t.d31_60 + r.aging.d31_60),
			d61_90: r2(t.d61_90 + r.aging.d61_90), d90: r2(t.d90 + r.aging.d90),
		}), { opening: 0, turnDebit: 0, turnCredit: 0, closing: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 });

		return res.json({ success: true, accountCode: acc, accountName: accMap.get(acc)?.name ?? "", items: rows, totals });
	} catch (err) {
		console.error("GET /accounting/settlements error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/closed-period ───────────────────────────────────────────
// Граница запрета изменений для организации = конец последнего закрытого месяца
// (max periodEnd среди проведённых month_close). null — закрытий нет. Для фронта
// (баннер «период закрыт до DD.MM») и проактивных проверок.
router.get("/accounting/closed-period", async (req, res) => {
	try {
		const organizationUuid = typeof req.query.organizationUuid === "string" ? req.query.organizationUuid : null;
		if (!organizationUuid) return res.json({ success: true, boundary: null });
		const boundary = await getClosedBoundary(organizationUuid);
		return res.json({ success: true, boundary: boundary ? boundary.toISOString() : null });
	} catch (err) {
		console.error("GET /accounting/closed-period error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
