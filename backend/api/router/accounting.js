// ─────────────────────────────────────────────────────────────────────────────
// API бухгалтерских отчётов: проводки документа, журнал проводок, ОСВ,
// карточка счёта, аналитика по субконто. Все эндпоинты под префиксом /accounting
// (права — модель AccountingEntry; см. ROUTE_TO_MODEL в utils/auth.js).
//
// Аудит 26.09:
//   • организация из `?organizationUuid=` больше НЕ перезаписывает tenantFilter — она
//     пересекается с доступными пользователю (services/reportScope.js), чужая → 403 (Б6);
//   • сутки периода — местные, в поясе организации (services/periodBounds.js), а не UTC (У5);
//   • ОСВ, начальное сальдо карточки, субконто и взаиморасчёты считаются агрегатами в SQL,
//     а не выгрузкой всей истории проводок в память; проведённость документа — EXISTS в
//     запросе (postedEntrySql). Удаления «осиротевших» проводок на GET больше нет.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, isAdminOfOrg, orgIsAccessible } from "../../utils/auth.js";
import { getDocumentEntries, filterPostedEntries, postedEntrySql, documentNumbers } from "../../services/accountingPosting.js";
import { getClosedBoundary } from "../../services/periodLock.js";
import { recomputeCosting, recomputeLockName, markRecomputeNeeded } from "../../services/recomputeCosting.js";
import { withClusterLock } from "../../services/clusterLock.js";
import { reportOrgs, orgWhere, respondReportScopeError } from "../../services/reportScope.js";
import { dateRangeWhere, startOfLocalDay, endOfLocalDay, orgTimeZone, respondBadDateError, BadDateError } from "../../services/periodBounds.js";
import { r2 } from "../../services/money.js";
import { withLongStatements } from "../../services/documentLock.js";

const router = express.Router();

// Пояс организации отчёта (сейчас общий для установки — см. periodBounds).
const tzOf = (orgs) => orgTimeZone(orgs?.[0] ?? null);

// Агрегаты по всей истории проводок (ОСВ, сальдо карточки, субконто, взаиморасчёты) и выборки
// журнала — со своим пределом запроса (КР-15 аудита 27.09): 30 с пула на большой базе мало.
const longQuery = (sql, ...params) => withLongStatements(prisma, (tx) => tx.$queryRawUnsafe(sql, ...params));

/** Начало/конец периода отчёта (местные сутки). Мусор → BadDateError (400). */
function periodOf(orgs, dateFrom, dateTo) {
	const tz = tzOf(orgs);
	const from = dateFrom ? startOfLocalDay(dateFrom, tz) : null;
	if (dateFrom && !from) throw new BadDateError("dateFrom", dateFrom);
	const to = dateTo ? endOfLocalDay(dateTo, tz) : null;
	if (dateTo && !to) throw new BadDateError("dateTo", dateTo);
	return { from, to };
}

// Where по проводкам: организации отчёта + период (местные сутки).
function entryWhere(req, { dateFrom, dateTo, organizationUuid } = {}) {
	const orgs = reportOrgs(req, organizationUuid);
	const where = { ...orgWhere(orgs) };
	const range = dateRangeWhere(dateFrom, dateTo, tzOf(orgs));
	if (range) where.date = range;
	return where;
}

/**
 * Общая часть SQL-условия по проводкам «e»: организации, верхняя граница даты,
 * проведённость документа. Параметры дописываются в params. orgs = [] → null (пусто).
 */
function sqlScope(orgs, { to = null } = {}, params) {
	if (orgs !== null && orgs.length === 0) return null;
	const conds = [];
	if (orgs !== null) {
		params.push(orgs);
		conds.push(`e."organizationUuid" = ANY($${params.length}::text[])`);
	}
	if (to) {
		params.push(to.toISOString());
		conds.push(`e."date" <= $${params.length}::timestamp`);
	}
	conds.push(postedEntrySql("e"));
	return conds;
}
const num = (v) => Number(v ?? 0) || 0;
/** Параметр-момент для SQL: ISO в UTC, `::timestamp` отбрасывает зону — как хранит Prisma. */
const tsParam = (params, d) => { params.push(d.toISOString()); return `$${params.length}::timestamp`; };

// Карта код→{name, accountType} для счетов в области видимости.
async function loadAccountMap(req, _organizationUuid) {
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

/** Дата проводки для строки отчёта — местная, как её видит бухгалтер. */
function localDay(d, tz) {
	if (!d) return "";
	return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}

/** Общий ответ на ошибки отчётов: 400 (дата), 403/400 (организация). true — ответ отправлен. */
function respondReportError(err, res) {
	return respondBadDateError(err, res) || respondReportScopeError(err, res);
}

// ─── GET /accounting/document-entries ────────────────────────────────────────
// Проводки конкретного документа (для Drawer в форме документа).
// Params: documentType, documentUuid
router.get("/accounting/document-entries", async (req, res) => {
	try {
		const { documentType, documentUuid } = req.query;
		if (!documentType || !documentUuid)
			return res.status(400).json({ success: false, message: "documentType и documentUuid обязательны" });
		// Только проводки проведённого документа (непроведённый/удалённый — пусто) и только
		// доступных пользователю организаций: чужой документ по uuid ничего не отдаёт. Доступных —
		// а не одной активной (P3 аудита 27.09): документ другой своей организации, открытый из
		// сводного списка или по ссылке, показывал пустые проводки.
		const all = await filterPostedEntries(await getDocumentEntries(documentType, documentUuid));
		const entries = all.filter((e) => orgIsAccessible(req, e.organizationUuid));
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
		if (respondReportError(err, res)) return;
		console.error("GET /accounting/document-entries error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/journal ─────────────────────────────────────────────────
// Журнал проводок. Params: dateFrom, dateTo, organizationUuid, accountCode,
// counterpartyUuid, productUuid, warehouseUuid, documentType, documentUuid, limit.
// Журнал — постраничный просмотр периода, выгрузка не больше JOURNAL_MAX строк.
const JOURNAL_MAX = 20000;
router.get("/accounting/journal", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, accountCode, counterpartyUuid, productUuid, warehouseUuid, documentType, documentUuid } = req.query;
		const rawLimit = req.query.limit;
		const parsed = rawLimit !== undefined ? Number(rawLimit) : 2000;
		const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 2000, 1), JOURNAL_MAX);

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

		// Проводки непроведённых документов отбрасываются ДО обрезки (КР-22 аудита 27.09): раньше
		// выбирались первые `limit` строк, из них выкидывались «сироты», и `truncated` считался по
		// остатку — журнал молча терял хвост. Теперь добираем страницами, пока не наберём `limit`
		// проведённых строк или не кончится выборка; обрезано — если за ними есть ещё.
		const posted = await withLongStatements(prisma, async (tx) => {
			const out = [];
			let cursor = null;
			let more = true;
			while (out.length <= limit && more) {
				const batch = await tx.accountingEntry.findMany({
					where,
					include: { analytics: true },
					orderBy: [{ date: "asc" }, { id: "asc" }],
					take: limit + 1,
					...(cursor !== null ? { cursor: { id: cursor }, skip: 1 } : {}),
				});
				more = batch.length === limit + 1;
				if (batch.length) cursor = batch[batch.length - 1].id;
				out.push(...(await filterPostedEntries(batch, tx)));
			}
			return out;
		});
		const truncated = posted.length > limit;
		const entries = posted.slice(0, limit);
		const accMap = await loadAccountMap(req, organizationUuid);
		const tz = orgTimeZone(organizationUuid || null);
		const numbers = await documentNumbers(entries);

		const rows = entries.map((e) => ({
			uuid: e.uuid,
			date: localDay(e.date, tz),
			documentType: e.documentType,
			documentTypeLabel: DOC_TYPE_LABELS[e.documentType] ?? e.documentType,
			documentId: e.documentId,
			documentUuid: e.documentUuid,
			documentNumber: numbers.get(`${e.documentType}:${e.documentUuid}`) ?? null,
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
		return res.json({ success: true, items: rows, count: rows.length, total, truncated });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /accounting/journal error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/balance-sheet ───────────────────────────────────────────
// Оборотно-сальдовая ведомость. Params: dateFrom, dateTo, organizationUuid.
// Сальдо считается через нетто (Дт−Кт): >0 → дебетовое, <0 → кредитовое.
// Один агрегат в SQL: начальное сальдо (до dateFrom) и обороты периода по каждому счёту.
router.get("/accounting/balance-sheet", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		const orgs = reportOrgs(req, organizationUuid);
		const { from, to } = periodOf(orgs, dateFrom, dateTo);
		const params = [];
		const conds = sqlScope(orgs, { to }, params);
		const accMap = await loadAccountMap(req, organizationUuid);
		const agg = new Map();
		if (conds) {
			const before = from ? `e."date" < ${tsParam(params, from)}` : "false";
			const where = conds.join(" AND ");
			const rows = await longQuery(
				`SELECT code, SUM(open_net)::text AS open_net, SUM(turn_debit)::text AS turn_debit, SUM(turn_credit)::text AS turn_credit
				   FROM (
					SELECT e."debitAccountCode" AS code,
					       CASE WHEN ${before} THEN e."amount" ELSE 0 END AS open_net,
					       CASE WHEN ${before} THEN 0 ELSE e."amount" END AS turn_debit,
					       0::numeric AS turn_credit
					  FROM "accounting_entries" e WHERE ${where}
					UNION ALL
					SELECT e."creditAccountCode",
					       CASE WHEN ${before} THEN -e."amount" ELSE 0 END,
					       0::numeric,
					       CASE WHEN ${before} THEN 0 ELSE e."amount" END
					  FROM "accounting_entries" e WHERE ${where}
				   ) x
				  GROUP BY code`,
				...params,
			);
			for (const r of rows) agg.set(r.code, { openNet: num(r.open_net), turnDebit: num(r.turn_debit), turnCredit: num(r.turn_credit) });
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
		if (respondReportError(err, res)) return;
		console.error("GET /accounting/balance-sheet error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/account-card ────────────────────────────────────────────
// Карточка счёта. Params: accountCode (обязателен), dateFrom, dateTo,
// organizationUuid. Возвращает начальное сальдо, обороты по строкам с
// нарастающим остатком, конечное сальдо. Начальное сальдо — агрегатом в SQL;
// построчно читаются только проводки периода.
router.get("/accounting/account-card", async (req, res) => {
	try {
		const { accountCode, dateFrom, dateTo, organizationUuid } = req.query;
		if (!accountCode) return res.status(400).json({ success: false, message: "accountCode обязателен" });
		const orgs = reportOrgs(req, organizationUuid);
		const { from } = periodOf(orgs, dateFrom, dateTo);

		let opening = 0; // нетто Дт−Кт до периода
		if (from) {
			const params = [];
			const conds = sqlScope(orgs, {}, params);
			if (conds) {
				params.push(String(accountCode));
				const acc = `$${params.length}`;
				const [row] = await longQuery(
					`SELECT COALESCE(SUM(CASE WHEN e."debitAccountCode" = ${acc} THEN e."amount" ELSE -e."amount" END), 0)::text AS opening
					   FROM "accounting_entries" e
					  WHERE (e."debitAccountCode" = ${acc} OR e."creditAccountCode" = ${acc})
					    AND e."date" < ${tsParam(params, from)} AND ${conds.join(" AND ")}`,
					...params,
				);
				opening = num(row?.opening);
			}
		}

		const where = entryWhere(req, { dateFrom, dateTo, organizationUuid });
		where.OR = [{ debitAccountCode: accountCode }, { creditAccountCode: accountCode }];
		const entries = await withLongStatements(prisma, async (tx) => filterPostedEntries(await tx.accountingEntry.findMany({
			where,
			include: { analytics: true },
			orderBy: [{ date: "asc" }, { id: "asc" }],
		}), tx));
		const accMap = await loadAccountMap(req, organizationUuid);
		const tz = tzOf(orgs);
		const numbers = await documentNumbers(entries);

		let turnDebit = 0;
		let turnCredit = 0;
		const rows = [];
		// Нарастающий остаток внутри периода (от начального сальдо).
		let running = opening;
		for (const e of entries) {
			const amt = Number(e.amount) || 0;
			const isDebit = e.debitAccountCode === accountCode;
			running += isDebit ? amt : -amt;
			if (isDebit) turnDebit += amt;
			else turnCredit += amt;
			const corr = isDebit ? e.creditAccountCode : e.debitAccountCode;
			rows.push({
				uuid: e.uuid,
				date: localDay(e.date, tz),
				documentType: e.documentType,
				documentTypeLabel: DOC_TYPE_LABELS[e.documentType] ?? e.documentType,
				documentId: e.documentId,
				documentUuid: e.documentUuid,
				documentNumber: numbers.get(`${e.documentType}:${e.documentUuid}`) ?? null,
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
		if (respondReportError(err, res)) return;
		console.error("GET /accounting/account-card error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/subkonto ────────────────────────────────────────────────
// Аналитика по субконто. Params: subkontoType (обязателен), dateFrom, dateTo,
// organizationUuid, accountCode (опц.). Группирует обороты по объекту аналитики —
// агрегатом в SQL.
router.get("/accounting/subkonto", async (req, res) => {
	try {
		const { subkontoType, dateFrom, dateTo, organizationUuid, accountCode } = req.query;
		if (!subkontoType) return res.status(400).json({ success: false, message: "subkontoType обязателен" });
		const orgs = reportOrgs(req, organizationUuid);
		const { from, to } = periodOf(orgs, dateFrom, dateTo);
		const params = [];
		const conds = sqlScope(orgs, { to }, params);
		let items = [];
		if (conds) {
			if (from) conds.push(`e."date" >= ${tsParam(params, from)}`);
			params.push(String(subkontoType));
			const st = `$${params.length}`;
			if (accountCode) {
				params.push(String(accountCode));
				conds.push(`(e."debitAccountCode" = $${params.length} OR e."creditAccountCode" = $${params.length})`);
			}
			const rows = await longQuery(
				`SELECT a."objectUuid" AS object_uuid, MAX(a."objectName") AS object_name,
				        SUM(CASE WHEN a."side" = 'debit' THEN e."amount" ELSE 0 END)::text AS debit,
				        SUM(CASE WHEN a."side" = 'debit' THEN 0 ELSE e."amount" END)::text AS credit
				   FROM "accounting_entry_analytics" a
				   JOIN "accounting_entries" e ON e."uuid" = a."accountingEntryUuid"
				  WHERE a."subkontoType" = ${st} AND ${conds.join(" AND ")}
				  GROUP BY a."objectUuid"`,
				...params,
			);
			items = rows.map((g) => {
				const debit = r2(num(g.debit));
				const credit = r2(num(g.credit));
				return {
					objectUuid: g.object_uuid ?? null,
					objectName: g.object_name || g.object_uuid || "—",
					debit,
					credit,
					balance: r2(debit - credit),
				};
			});
		}
		items.sort((a, b) => String(a.objectName).localeCompare(String(b.objectName), "ru"));
		return res.json({ success: true, subkontoType, items });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /accounting/subkonto error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /accounting/settlements ─────────────────────────────────────────────
// Взаиморасчёты по контрагентам (дебиторка 1210 / кредиторка 3310): входящее
// сальдо, обороты Дт/Кт за период, исходящее сальдо + старение долга (aging).
// Params: dateFrom, dateTo, organizationUuid, accountCode (1210|3310, по умолч.
// 1210), counterpartyUuid (опц.). Всё — одним агрегатом в SQL; контрагент проводки —
// субконто «Контрагент» той стороны, где наш счёт (иначе любое).
router.get("/accounting/settlements", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, counterpartyUuid } = req.query;
		const acc = req.query.accountCode === "3310" ? "3310" : "1210";
		const accMap = await loadAccountMap(req, organizationUuid);
		const isActive = (accMap.get(acc)?.accountType ?? (acc[0] === "1" ? "active" : "passive")) === "active";
		const orgs = reportOrgs(req, organizationUuid);
		const period = periodOf(orgs, dateFrom, dateTo);
		const from = period.from;
		const to = period.to ?? new Date();

		const params = [];
		const conds = sqlScope(orgs, { to: period.to }, params);
		let rows = [];
		if (conds) {
			params.push(acc);
			const accP = `$${params.length}`;
			conds.push(`(e."debitAccountCode" = ${accP} OR e."creditAccountCode" = ${accP})`);
			if (counterpartyUuid) {
				params.push(String(counterpartyUuid));
				conds.push(`EXISTS (SELECT 1 FROM "accounting_entry_analytics" f WHERE f."accountingEntryUuid" = e."uuid" AND f."subkontoType" = 'Counterparty' AND f."objectUuid" = $${params.length})`);
			}
			const before = from ? `t."date" < ${tsParam(params, from)}` : "false";
			const toP = tsParam(params, to);
			const sign = isActive ? 1 : -1; // вклад в сальдо: активный Дт−Кт, пассивный Кт−Дт
			const raw = await longQuery(
				`WITH s AS (
					SELECT e."amount" AS amount, e."date" AS "date", (e."debitAccountCode" = ${accP}) AS on_debit,
					       cp."objectUuid" AS cp_uuid, cp."objectName" AS cp_name
					  FROM "accounting_entries" e
					  LEFT JOIN LATERAL (
						SELECT a."objectUuid", a."objectName" FROM "accounting_entry_analytics" a
						 WHERE a."accountingEntryUuid" = e."uuid" AND a."subkontoType" = 'Counterparty'
						 ORDER BY (a."side" = CASE WHEN e."debitAccountCode" = ${accP} THEN 'debit' ELSE 'credit' END) DESC, a."id"
						 LIMIT 1
					  ) cp ON true
					 WHERE ${conds.join(" AND ")}
				), t AS (
					SELECT s.*, (CASE WHEN on_debit THEN amount ELSE -amount END) * ${sign} AS contrib,
					       FLOOR(EXTRACT(EPOCH FROM (${toP} - s."date")) / 86400) AS age
					  FROM s
				)
				SELECT cp_uuid, MAX(cp_name) AS cp_name,
				       SUM(CASE WHEN ${before} THEN contrib ELSE 0 END)::text AS opening,
				       SUM(CASE WHEN ${before} THEN 0 WHEN on_debit THEN amount ELSE 0 END)::text AS turn_debit,
				       SUM(CASE WHEN ${before} THEN 0 WHEN on_debit THEN 0 ELSE amount END)::text AS turn_credit,
				       SUM(CASE WHEN age <= 30 THEN contrib ELSE 0 END)::text AS b0_30,
				       SUM(CASE WHEN age > 30 AND age <= 60 THEN contrib ELSE 0 END)::text AS b31_60,
				       SUM(CASE WHEN age > 60 AND age <= 90 THEN contrib ELSE 0 END)::text AS b61_90,
				       SUM(CASE WHEN age > 90 THEN contrib ELSE 0 END)::text AS b90
				  FROM t
				 GROUP BY cp_uuid`,
				...params,
			);
			for (const g of raw) {
				const opening = r2(num(g.opening));
				const turnDebit = r2(num(g.turn_debit));
				const turnCredit = r2(num(g.turn_credit));
				const closing = r2(opening + (isActive ? turnDebit - turnCredit : turnCredit - turnDebit));
				if (!opening && !turnDebit && !turnCredit && !closing) continue;
				rows.push({
					counterpartyUuid: g.cp_uuid ?? null,
					counterpartyName: g.cp_name || "— без контрагента —",
					opening, turnDebit, turnCredit, closing,
					aging: { d0_30: r2(num(g.b0_30)), d31_60: r2(num(g.b31_60)), d61_90: r2(num(g.b61_90)), d90: r2(num(g.b90)) },
				});
			}
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
		if (respondReportError(err, res)) return;
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
		reportOrgs(req, organizationUuid); // чужая организация → 403
		const boundary = await getClosedBoundary(organizationUuid);
		return res.json({ success: true, boundary: boundary ? boundary.toISOString() : null });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /accounting/closed-period error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── POST /accounting/recompute-costing ──────────────────────────────────────
// Ретроактивный пересчёт себестоимости/проводок по запросу (после ввода
// документа задним числом). Две фазы (регистр → проводки), идемпотентно.
// Закрытые периоды не затрагиваются: нижняя граница строго ПОСЛЕ границы закрытия.
// Body: { organizationUuid (обяз.), fromDate? }. Доступ: суперадмин или
// админ этой организации. Пересчёт одной организации в кластере идёт в одном месте
// (межпроцессный лок, как у фонового авто-пересчёта): второй запрос — 409.
router.post("/accounting/recompute-costing", async (req, res) => {
	try {
		const organizationUuid = typeof req.body?.organizationUuid === "string" ? req.body.organizationUuid : null;
		if (!organizationUuid) return res.status(400).json({ success: false, message: "organizationUuid обязателен" });

		if (!isAdminOfOrg(req, organizationUuid)) return res.status(403).json({ success: false, message: "Недостаточно прав" });

		const tz = orgTimeZone(organizationUuid);
		const fromDate = typeof req.body?.fromDate === "string" && req.body.fromDate ? startOfLocalDay(req.body.fromDate, tz) : null;
		if (req.body?.fromDate && !fromDate) return res.status(400).json({ success: false, message: "Некорректная дата fromDate" });
		const boundary = await getClosedBoundary(organizationUuid);

		// Нижняя граница диапазона: не трогаем закрытые периоды (≤ boundary).
		let dateFilter = null;
		if (fromDate && (!boundary || fromDate > boundary)) dateFilter = { gte: fromDate };
		else if (boundary) dateFilter = { gt: boundary };

		const result = await withClusterLock(recomputeLockName(organizationUuid), () => recomputeCosting({ organizationUuid, dateFilter }));
		if (result === undefined) {
			return res.status(409).json({ success: false, message: "Пересчёт себестоимости этой организации уже идёт — повторите позже" });
		}
		// Сервер останавливается (КР-16 аудита 27.09): проход прерван между документами — след в
		// базе, чтобы хвост дообработал следующий старт, а пользователю — честный ответ.
		if (result.interrupted) {
			await markRecomputeNeeded(organizationUuid, dateFilter?.gte ?? (dateFilter?.gt ? new Date(dateFilter.gt.getTime() + 1) : new Date(0)));
			return res.status(503).json({ success: false, message: "Пересчёт прерван остановкой сервера — он будет продолжен автоматически после перезапуска" });
		}
		return res.json({ success: true, ...result, boundary: boundary ? boundary.toISOString() : null });
	} catch (err) {
		console.error("POST /accounting/recompute-costing error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
