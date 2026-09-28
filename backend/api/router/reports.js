import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { canAccessModel } from "../../utils/auth.js";
import { reportSubject } from "../../utils/routeSubjects.js";
import { resolveCostingMethod } from "../../services/accountingPosting.js";
import { replayProductCosting, sortMovements } from "../../services/costingReplay.js";
import { reportOrgs, reportSingleOrg, orgWhere, respondReportScopeError } from "../../services/reportScope.js";
import { dateRangeWhere, startOfLocalDay, endOfLocalDay, orgTimeZone, respondBadDateError, BadDateError } from "../../services/periodBounds.js";
import { r2 } from "../../services/money.js";
import { withLongStatements } from "../../services/documentLock.js";

const router = express.Router();

/**
 * ОТЧЁТ ТРЕБУЕТ ПРАВА НА СВОЙ ПРЕДМЕТ (П2 разбора `docs/DESIGN_PREINSTALL_AUDIT_2026-09-24.md`).
 *
 * Отчёты фильтровали по организации и больше ничего не спрашивали, а в меню были закрыты
 * правами — то есть запрет существовал ТОЛЬКО в интерфейсе. Прямой запрос к
 * `/api/v1/reports/sales-by-product` отдавал выручку сотруднику, которому продажи не открывали.
 *
 * Предмет каждого отчёта описан в `utils/routeSubjects.js`. Неописанный отчёт (новый, забыли
 * внести) в режиме наблюдения пропускается с записью в журнал — иначе правка гасила бы то, чего
 * не видела; в режиме `deny` закрывается.
 *
 * ⚠ ПРОВЕРИТЬ ПОТОМ: после раздачи профилей (О2) включить `ACCESS_UNKNOWN_ROUTES=deny` и
 * убедиться, что у бухгалтера и руководителя отчёты на месте, а у кладовщика — нет.
 */
const seenUndescribedReports = new Set();
function requireReportAccess(name) {
	return async (req, res, next) => {
		const model = reportSubject(name);
		if (!model) {
			if (process.env.ACCESS_UNKNOWN_ROUTES === "deny") {
				return res.status(403).json({ success: false, code: "REPORT_NOT_DESCRIBED", message: "Отчёт не описан в реестре прав" });
			}
			if (!seenUndescribedReports.has(name)) {
				seenUndescribedReports.add(name);
				console.warn(`[access] отчёт /reports/${name} не описан в REPORT_SUBJECTS — пропущен без проверки прав`);
			}
			return next();
		}
		if (await canAccessModel(req, model)) return next();
		return res.status(403).json({
			success: false,
			code: "FORBIDDEN",
			message: "Нет доступа к данным этого отчёта",
		});
	};
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const INVENTORY_ACCOUNT_CODE = "1330"; // ТМЗ (товары) — типовой счёт учёта РК
const COGS_ACCOUNT_CODE = "7010"; // себестоимость реализованных товаров

// Документы, у которых amount приходного движения — это ФАКТИЧЕСКАЯ стоимость,
// уже посчитанная при проведении (см. services/productRegister.js):
//   purchase           — сумма поступления (без НДС у плательщика);
//   import_declaration — landed cost (таможенная стоимость + пошлины/сборы);
//   goods_receipt      — стоимость оприходования излишков;
//   sale_return        — себестоимость на момент исходной продажи;
//   inventory_transfer — себестоимость на складе-ИСТОЧНИКЕ.
// Приход, не входящий в набор, оценивается по текущей средней склада-получателя.
const COST_BEARING_IN_DOCS = new Set([
	"purchase",
	"import_declaration",
	"goods_receipt",
	"sale_return",
	"inventory_transfer",
]);
// Количества в отчётах — 3 знака (точность количества, не денег; деньги — r2 из money.js).
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const num = (v) => Number(v ?? 0) || 0;

// Тяжёлые выборки отчётов (агрегаты за период, вся история регистра) — со своим пределом
// запроса (КР-15 аудита 27.09): на большой базе 30 с пула мало, и отчёт падал «Ошибкой сервера».
const longQuery = (sql, ...params) => withLongStatements(prisma, (tx) => tx.$queryRawUnsafe(sql, ...params));
const longRegisterRead = (args) => withLongStatements(prisma, (tx) => tx.productRegister.findMany(args));

// Аудит 26.09 (Б6, У5): организация из запроса ПЕРЕСЕКАЕТСЯ с доступными (reportOrgs —
// чужая → 403), а не перезаписывает tenantFilter; сутки периода — местные (periodBounds).
function buildDocWhere(req, { dateFrom, dateTo, organizationUuid } = {}) {
	const orgs = reportOrgs(req, organizationUuid);
	const where = { posted: true, deletedAt: null, ...orgWhere(orgs) };
	const range = dateRangeWhere(dateFrom, dateTo, orgTimeZone(orgs?.[0] ?? null));
	if (range) where.date = range;
	return where;
}

/**
 * То же условие для сырого SQL по таблице документов с псевдонимом `alias`: проведён,
 * не удалён, организации отчёта, местный период, контрагент. null — заведомо пусто.
 */
function docSql(req, alias, { dateFrom, dateTo, organizationUuid, counterpartyUuid } = {}, params) {
	const orgs = reportOrgs(req, organizationUuid);
	if (orgs !== null && orgs.length === 0) return null;
	const conds = [`${alias}."posted" = true`, `${alias}."deletedAt" IS NULL`];
	if (orgs !== null) { params.push(orgs); conds.push(`${alias}."organizationUuid" = ANY($${params.length}::text[])`); }
	const range = dateRangeWhere(dateFrom, dateTo, orgTimeZone(orgs?.[0] ?? null));
	if (range?.gte) { params.push(range.gte.toISOString()); conds.push(`${alias}."date" >= $${params.length}::timestamp`); }
	if (range?.lte) { params.push(range.lte.toISOString()); conds.push(`${alias}."date" <= $${params.length}::timestamp`); }
	if (counterpartyUuid) { params.push(String(counterpartyUuid)); conds.push(`${alias}."counterpartyUuid" = $${params.length}`); }
	return conds.join(" AND ");
}

/** Общий ответ на ошибки параметров отчёта. true — ответ отправлен. */
function respondReportError(err, res) {
	return respondBadDateError(err, res) || respondReportScopeError(err, res);
}

/** Имена товаров и единиц измерения одним запросом на каждый справочник. */
async function productAndUomNames(productUuids, uomUuids) {
	const [products, uoms] = await Promise.all([
		productUuids.length ? prisma.product.findMany({ where: { uuid: { in: productUuids } }, select: { uuid: true, name: true } }) : [],
		uomUuids.length ? prisma.unitOfMeasure.findMany({ where: { uuid: { in: uomUuids } }, select: { uuid: true, name: true } }) : [],
	]);
	return { productName: new Map(products.map((p) => [p.uuid, p.name])), uomName: new Map(uoms.map((u) => [u.uuid, u.name])) };
}

// ─── GET /reports/sales-by-product ───────────────────────────────────────────
// Params: dateFrom, dateTo, organizationUuid, counterpartyUuid
//
// Агрегаты в SQL (аудит 26.09): раньше грузились все продажи периода и ВСЕ их строки
// с товаром и единицей (год — сотни тысяч объектов) плюс IN-список uuid продаж на
// десятки тысяч параметров. Теперь строки суммируются GROUP BY по товару, себестоимость —
// GROUP BY по субконто «Номенклатура» проводок 7010.
router.get("/reports/sales-by-product", requireReportAccess("sales-by-product"), async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, counterpartyUuid } = req.query;
		const filter = { dateFrom, dateTo, organizationUuid, counterpartyUuid };

		// У каждого запроса — свой список параметров: неиспользованный параметр Postgres
		// не может типизировать и отвергает запрос.
		const saleParams = [];
		const saleCond = docSql(req, "s", filter, saleParams); // чужая организация → 403
		const orgName = organizationUuid
			? ((await prisma.organization.findUnique({ where: { uuid: String(organizationUuid) }, select: { name: true } }))?.name ?? "")
			: "";
		if (!saleCond) return res.json({ success: true, items: [], orgName });
		const retParams = [];
		const retCond = docSql(req, "s", filter, retParams);
		const costParams = [];
		const costSaleCond = docSql(req, "s", filter, costParams);
		const costRetCond = docSql(req, "s", filter, costParams);

		const [saleRows, returnRows, costRows] = await Promise.all([
			longQuery(
				`SELECT i."productUuid" AS product_uuid, MIN(i."unitOfMeasureUuid") AS uom_uuid,
				        SUM(i."quantity")::text AS qty, SUM(i."amount")::text AS amount,
				        SUM(i."exciseAmount")::text AS excise, SUM(i."vatAmount")::text AS vat,
				        SUM(i."amountWithoutVat")::text AS no_tax
				   FROM "sale_items" i JOIN "sales" s ON s."uuid" = i."saleUuid"
				  WHERE i."deletedAt" IS NULL AND ${saleCond}
				  GROUP BY i."productUuid"`,
				...saleParams,
			),
			longQuery(
				`SELECT i."productUuid" AS product_uuid, MIN(i."unitOfMeasureUuid") AS uom_uuid,
				        SUM(i."quantity")::text AS qty, SUM(i."amount")::text AS amount,
				        SUM(COALESCE(i."amountWithoutVat", i."amount"))::text AS no_tax,
				        SUM(COALESCE(i."exciseAmount", 0))::text AS excise
				   FROM "sale_return_items" i JOIN "sale_returns" s ON s."uuid" = i."saleReturnUuid"
				  WHERE i."deletedAt" IS NULL AND ${retCond}
				  GROUP BY i."productUuid"`,
				...retParams,
			),
			// ── Себестоимость проданного: из ПРОВОДОК, а не пересчётом ───────────
			// Дт 7010 Кт 1330 при реализации и обратная Дт 1330 Кт 7010 при возврате.
			// Проводки формируются на проведении по фактической политике организации
			// (ФИФО/средняя), поэтому отчёт всегда сходится с ОСВ и карточкой счёта.
			// Номенклатура — с той стороны проводки, где стоит 7010 (она есть на обеих).
			longQuery(
				`SELECT a."objectUuid" AS product_uuid,
				        SUM(CASE WHEN e."debitAccountCode" = '${COGS_ACCOUNT_CODE}' THEN e."amount" ELSE -e."amount" END)::text AS cost
				   FROM "accounting_entries" e
				   JOIN "accounting_entry_analytics" a
				     ON a."accountingEntryUuid" = e."uuid" AND a."subkontoType" = 'Nomenclature' AND a."objectUuid" IS NOT NULL
				    AND a."side" = CASE WHEN e."debitAccountCode" = '${COGS_ACCOUNT_CODE}' THEN 'debit' ELSE 'credit' END
				  WHERE ('${COGS_ACCOUNT_CODE}' IN (e."debitAccountCode", e."creditAccountCode"))
				    AND (
				      (e."documentType" = 'sale' AND EXISTS (SELECT 1 FROM "sales" s WHERE s."uuid" = e."documentUuid" AND ${costSaleCond}))
				      OR (e."documentType" = 'sale_return' AND EXISTS (SELECT 1 FROM "sale_returns" s WHERE s."uuid" = e."documentUuid" AND ${costRetCond}))
				    )
				  GROUP BY a."objectUuid"`,
				...costParams,
			),
		]);

		const productUuids = [...new Set([...saleRows, ...returnRows].map((r) => r.product_uuid).filter(Boolean))];
		const uomUuids = [...new Set([...saleRows, ...returnRows].map((r) => r.uom_uuid).filter(Boolean))];
		const { productName, uomName } = await productAndUomNames(productUuids, uomUuids);
		const costByProduct = new Map(costRows.map((c) => [c.product_uuid, num(c.cost)]));

		const map = new Map();
		const ensure = (r) => {
			const key = r.product_uuid ?? "__no_product__";
			if (!map.has(key)) {
				map.set(key, {
					productUuid: r.product_uuid ?? null,
					productName: (r.product_uuid && productName.get(r.product_uuid)) || "—",
					uom: (r.uom_uuid && uomName.get(r.uom_uuid)) || "",
					qtySale: 0, qtyReturn: 0, amountSale: 0, amountReturn: 0,
					exciseAmountSale: 0, vatAmountSale: 0, amountNoTaxSale: 0,
					amountNoTaxReturn: 0, exciseAmountReturn: 0,
				});
			}
			return map.get(key);
		};
		for (const r of saleRows) {
			const row = ensure(r);
			row.qtySale += num(r.qty);
			row.amountSale += num(r.amount);
			row.exciseAmountSale += num(r.excise);
			row.vatAmountSale += num(r.vat);
			row.amountNoTaxSale += num(r.no_tax);
		}
		for (const r of returnRows) {
			const row = ensure(r);
			row.qtyReturn += num(r.qty);
			row.amountReturn += num(r.amount);
			row.amountNoTaxReturn += num(r.no_tax);
			// Акциз возврата — чтобы вычесть его симметрично акцизу реализации.
			row.exciseAmountReturn += num(r.excise);
		}

		const rows = Array.from(map.values())
			.map((r) => {
				const costNoVat = r2(costByProduct.get(r.productUuid) ?? 0);
				const amountNoTaxReturn = r2(r.amountNoTaxReturn ?? 0);
				const exciseAmountReturn = r2(r.exciseAmountReturn ?? 0);
				// ВЫРУЧКА = amountWithoutVat − акциз.
				//
				// amountWithoutVat — это БАЗА НДС, а она по НК РК ст.381 включает акциз
				// (см. recalcSaleItemAmounts: vatBase = afterDiscount + exciseAmount).
				// Акциз — косвенный налог в пользу государства, выручкой он не является:
				// раньше он попадал в прибыль и завышал её ровно на свою сумму. То же
				// самое приложение считает верно в других местах — «Сумма без налогов»
				// графы 13 ЭСФ = amountWithoutVat − exciseAmount.
				const revenueSale = r2(r.amountNoTaxSale - r2(r.exciseAmountSale));
				const revenueReturn = r2(amountNoTaxReturn - exciseAmountReturn);
				// Прибыль = чистая выручка без налогов − чистая себестоимость.
				const profit = r2(revenueSale - revenueReturn - costNoVat);
				return {
					...r,
					qtySale: Math.round(r.qtySale * 10000) / 10000,
					qtyReturn: Math.round(r.qtyReturn * 10000) / 10000,
					qtyNet: Math.round((r.qtySale - r.qtyReturn) * 10000) / 10000,
					amountSale: r2(r.amountSale),
					amountReturn: r2(r.amountReturn),
					amountNet: r2(r.amountSale - r.amountReturn),
					exciseAmountSale: r2(r.exciseAmountSale),
					vatAmountSale: r2(r.vatAmountSale),
					amountNoTaxSale: r2(r.amountNoTaxSale),
					amountNoTaxReturn,
					exciseAmountReturn,
					// Выручка без косвенных налогов — то, из чего считается прибыль.
					revenueSale,
					costNoVat,
					profit,
				};
			})
			.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

		return res.json({ success: true, items: rows, orgName });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /reports/sales-by-product error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/sales-by-product-xyz ───────────────────────────────────────
// Источник XYZ-анализа: помесячный НЕТТО-спрос (продажи − возвраты) по каждому
// товару за период. Месяцы без продаж считаются нулём — иначе разовая продажа
// выглядела бы «стабильной». Возвращает выровненный по общему списку месяцев
// массив `monthly` + `amountNet` (для ABC), а коэффициент вариации и классы
// X/Y/Z и A/B/C считает фронт (см. XYZReport.tsx).
// Params: dateFrom, dateTo, organizationUuid, counterpartyUuid
function enumerateMonths(fromYm, toYm) {
	const out = [];
	let [y, m] = fromYm.split("-").map(Number);
	const [ty, tm] = toYm.split("-").map(Number);
	while (y < ty || (y === ty && m <= tm)) {
		out.push(`${y}-${String(m).padStart(2, "0")}`);
		m += 1;
		if (m > 12) { m = 1; y += 1; }
	}
	return out;
}
router.get("/reports/sales-by-product-xyz", requireReportAccess("sales-by-product-xyz"), async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, counterpartyUuid } = req.query;
		const filter = { dateFrom, dateTo, organizationUuid, counterpartyUuid };
		const orgs = reportOrgs(req, organizationUuid); // чужая организация → 403
		const tz = orgTimeZone(orgs?.[0] ?? null);

		// Помесячно — агрегатом в SQL, месяц МЕСТНЫЙ (аудит 26.09): раньше грузились все
		// продажи и все их строки, а месяц брался по UTC (продажа 01.06 00:30 по Алматы
		// попадала в май). "date" хранится как UTC без пояса → AT TIME ZONE 'UTC' → пояс.
		const monthly = async (itemTable, docTable, fk) => {
			const params = [];
			const cond = docSql(req, "s", filter, params);
			if (!cond) return [];
			params.push(tz);
			return longQuery(
				`SELECT i."productUuid" AS product_uuid, MIN(i."unitOfMeasureUuid") AS uom_uuid,
				        to_char((s."date" AT TIME ZONE 'UTC') AT TIME ZONE $${params.length}, 'YYYY-MM') AS ym,
				        SUM(i."quantity")::text AS qty, SUM(i."amount")::text AS amount
				   FROM "${itemTable}" i JOIN "${docTable}" s ON s."uuid" = i."${fk}"
				  WHERE i."deletedAt" IS NULL AND ${cond}
				  GROUP BY i."productUuid", ym`,
				...params,
			);
		};
		const [saleRows, returnRows] = await Promise.all([
			monthly("sale_items", "sales", "saleUuid"),
			monthly("sale_return_items", "sale_returns", "saleReturnUuid"),
		]);

		const orgName = organizationUuid
			? ((await prisma.organization.findUnique({ where: { uuid: String(organizationUuid) }, select: { name: true } }))?.name ?? "")
			: "";
		if (!saleRows.length && !returnRows.length) {
			return res.json({ success: true, items: [], months: [], orgName });
		}

		// Полный список месяцев периода: границы — из фильтра, иначе из фактических месяцев.
		const allYm = [...saleRows, ...returnRows].map((r) => r.ym).sort();
		const localYm = (v) => {
			const d = startOfLocalDay(v, tz);
			if (!d) throw new BadDateError("date", v);
			return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
		};
		const fromYm = dateFrom ? localYm(dateFrom) : allYm[0];
		const toYm = dateTo ? localYm(endOfLocalDay(dateTo, tz)) : allYm[allYm.length - 1];
		const months = enumerateMonths(fromYm, toYm);

		const productUuids = [...new Set([...saleRows, ...returnRows].map((r) => r.product_uuid).filter(Boolean))];
		const uomUuids = [...new Set([...saleRows, ...returnRows].map((r) => r.uom_uuid).filter(Boolean))];
		const { productName, uomName } = await productAndUomNames(productUuids, uomUuids);

		const map = new Map();
		const ensure = (r) => {
			const key = r.product_uuid ?? "__no_product__";
			if (!map.has(key)) {
				map.set(key, {
					productUuid: r.product_uuid ?? null,
					productName: (r.product_uuid && productName.get(r.product_uuid)) || "—",
					uom: (r.uom_uuid && uomName.get(r.uom_uuid)) || "",
					amountNet: 0,
					byMonth: new Map(),
				});
			}
			return map.get(key);
		};
		const addQty = (row, ym, qty) => row.byMonth.set(ym, (row.byMonth.get(ym) ?? 0) + qty);
		for (const r of saleRows) {
			const row = ensure(r);
			addQty(row, r.ym, num(r.qty));
			row.amountNet += num(r.amount);
		}
		for (const r of returnRows) {
			const row = ensure(r);
			addQty(row, r.ym, -num(r.qty));
			row.amountNet -= num(r.amount);
		}

		const items = Array.from(map.values())
			.map((r) => ({
				productUuid: r.productUuid,
				productName: r.productName,
				uom: r.uom,
				amountNet: r2(r.amountNet),
				// Нетто-спрос по месяцам, выровненный по общему списку (0 в пустых).
				monthly: months.map((m) => r3(Math.max(0, r.byMonth.get(m) ?? 0))),
			}))
			.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

		return res.json({ success: true, items, months, orgName });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /reports/sales-by-product-xyz error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/material-statement ─────────────────────────────────────────
// Материальная ведомость. Источник — регистр накопления product_register
// (только проведённые документы). Себестоимость выбытия считается ЕДИНЫМ движком
// replayProductCosting по МЕТОДУ ОРГАНИЗАЦИИ (AVERAGE|FIFO), покомпонентно по
// складу — тем же, что и проводки. Поэтому прибыль сходится с sales-by-product и
// главной книгой при обоих методах.
//
//   Приход       = Σ стоимости приходов (по COST_BEARING_IN_DOCS / средней)
//   Себест. расхода = списание по методу (ФИФО-слои либо скользящая средняя)
//   Сумма продажи = Σ amount движений реализаций (выручка)
//   Прибыль      = Сумма продажи − Себестоимость проданного
//
// Params: dateFrom, dateTo, organizationUuid, warehouseUuid
router.get("/reports/material-statement", requireReportAccess("material-statement"), async (req, res) => {
	try {
		const { dateFrom, dateTo, warehouseUuid } = req.query;

		// Отчёт — по ОДНОЙ организации (аудит 26.09, Б6): без параметра раньше суммировались
		// все организации, а выручка считалась вовсе без фильтра организации. Себестоимость
		// считается по учётной политике организации — смешивать их бессмысленно.
		const organizationUuid = reportSingleOrg(req, req.query.organizationUuid);
		const tz = orgTimeZone(organizationUuid);
		const from = dateFrom ? startOfLocalDay(dateFrom, tz) : null;
		if (dateFrom && !from) throw new BadDateError("dateFrom", dateFrom);
		const to = dateTo ? endOfLocalDay(dateTo, tz) : null;
		if (dateTo && !to) throw new BadDateError("dateTo", dateTo);

		// Фильтр регистра: организация + склад. Дата — до конца dateTo включительно
		// (движения после периода не загружаем; начальный остаток формируется движениями
		// ДО dateFrom).
		// Проверить потом: остаток на начало брать из product_cost_snapshot/агрегата, а
		// построчно читать только движения периода (backend_performance п. 7).
		const where = { organizationUuid };
		if (warehouseUuid) where.warehouseUuid = warehouseUuid;
		if (to) where.date = { lte: to };

		// Порядок ОБЯЗАН совпадать с себестоимостью в проводках — единый порядок регистра
		// (sortMovements: при равной дате приход раньше расхода, затем тип и id документа).
		const movements = sortMovements(await longRegisterRead({
			where,
			include: {
				product: { select: { uuid: true, name: true, sku: true } },
				unitOfMeasure: { select: { name: true } },
			},
			orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
		}));

		// Метод — тот, что действовал на конец периода (учётная политика по дате).
		const method = await resolveCostingMethod(organizationUuid, to);

		// ── Выручка периода по товарам — ИЗ СТРОК ДОКУМЕНТОВ ────────────────────
		// Из регистра её взять нельзя: у расхода реализации amount — это
		// СЕБЕСТОИМОСТЬ (инвариант productRegister). Раньше отчёт брал её оттуда и
		// показывал прибыль 0 у всех позиций, а COGS — под подписью «сумма реализации».
		//
		// Выручка = amountWithoutVat − акциз: amountWithoutVat это база НДС, а она
		// включает акциз (НК РК ст.381), который выручкой не является.
		const revenueByProduct = new Map();
		const saleRows = await prisma.saleItem.findMany({
			where: {
				deletedAt: null,
				sale: {
					posted: true,
					deletedAt: null,
					organizationUuid,
					...(warehouseUuid ? { warehouseUuid } : {}),
					...(from || to
						? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
						: {}),
				},
			},
			select: { productUuid: true, quantity: true, amountWithoutVat: true, exciseAmount: true },
		});
		for (const it of saleRows) {
			if (!it.productUuid) continue;
			const net = Number(it.amountWithoutVat ?? 0) - Number(it.exciseAmount ?? 0);
			const acc = revenueByProduct.get(it.productUuid) ?? { revenue: 0, qty: 0 };
			acc.revenue += net;
			acc.qty += Number(it.quantity ?? 0);
			revenueByProduct.set(it.productUuid, acc);
		}

		// Группируем движения по товару (порядок внутри группы сохраняется).
		const byProduct = new Map();
		for (const mv of movements) {
			const key = mv.productUuid ?? "__no_product__";
			if (!byProduct.has(key)) byProduct.set(key, []);
			byProduct.get(key).push(mv);
		}

		const items = [];
		for (const mvs of byProduct.values()) {
			const c = replayProductCosting(mvs, { method, from, costBearingInDocs: COST_BEARING_IN_DOCS });
			const rev = revenueByProduct.get(mvs[0]?.productUuid) ?? { revenue: 0, qty: 0 };
			const hasActivity =
				c.openQty || c.openAmount || c.closeQty || c.closeAmount ||
				c.inQty || c.outQty || rev.revenue;
			if (!hasActivity) continue;

			const product = mvs.find((m) => m.product)?.product ?? null;
			const uom = mvs.find((m) => m.unitOfMeasure?.name)?.unitOfMeasure?.name ?? "";
			items.push({
				productUuid: product?.uuid ?? null,
				productName: product?.name ?? "—",
				sku: product?.sku ?? "",
				accountCode: INVENTORY_ACCOUNT_CODE,
				uom,
				unitCost: c.unitCost,
				openQty: c.openQty,
				openAmount: c.openAmount,
				inQty: c.inQty,
				inAmount: c.inAmount,
				outQty: c.outQty,
				cogsOut: c.cogsOut,
				// Цена реализации — по количеству ПРОДАННОМУ (из строк), а не по
				// расходу регистра: в расход входят ещё перемещения и списания.
				salePrice: r2(rev.qty > 0 ? rev.revenue / rev.qty : 0),
				saleAmount: r2(rev.revenue),
				profit: r2(rev.revenue - c.salesCogs),
				closeQty: c.closeQty,
				closeAmount: c.closeAmount,
			});
		}

		items.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

		return res.json({ success: true, items });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /reports/material-statement error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/inventory-batches ──────────────────────────────────────────
// Остатки по ПАРТИЯМ (ФИФО-слои) на дату. По каждому товару (на складе) —
// непогашенные слои прихода: дата прихода, остаток кол-ва, цена прихода
// (себестоимость единицы), сумма. Слои потребляются строго oldest→newest —
// в точности как fifoCost (services/accountingPosting.js), поэтому разбивка
// согласована с ФИФО-себестоимостью списания.
// Params: organizationUuid, warehouseUuid, productUuid, dateTo.
router.get("/reports/inventory-batches", requireReportAccess("inventory-batches"), async (req, res) => {
	try {
		const { organizationUuid, warehouseUuid, productUuid, dateTo } = req.query;
		const orgs = reportOrgs(req, organizationUuid); // чужая организация → 403 (Б6)
		const where = { ...orgWhere(orgs) };
		if (warehouseUuid) where.warehouseUuid = warehouseUuid;
		if (productUuid) where.productUuid = productUuid;
		const range = dateRangeWhere(null, dateTo, orgTimeZone(orgs?.[0] ?? null));
		if (range) where.date = range;

		const movements = sortMovements(await longRegisterRead({
			where,
			include: {
				product: { select: { uuid: true, name: true, sku: true } },
				unitOfMeasure: { select: { name: true } },
				warehouse: { select: { name: true } },
			},
			orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
		}));

		// Партии физически привязаны к складу → группируем по товар+склад.
		const byKey = new Map();
		for (const mv of movements) {
			const key = `${mv.productUuid ?? ""}|${mv.warehouseUuid ?? ""}`;
			if (!byKey.has(key)) byKey.set(key, []);
			byKey.get(key).push(mv);
		}

		const items = [];
		for (const mvs of byKey.values()) {
			const layers = []; // FIFO-очередь { date, qty, unitCost }
			let product = null, uom = "", warehouseName = "";
			for (const mv of mvs) {
				if (!product && mv.product) product = mv.product;
				if (!uom && mv.unitOfMeasure?.name) uom = mv.unitOfMeasure.name;
				if (!warehouseName && mv.warehouse?.name) warehouseName = mv.warehouse.name;
				const q = Number(mv.quantity) || 0;
				if (q <= 0) continue;
				if (mv.movementType === "in") {
					const amt = Number(mv.amount) || 0;
					layers.push({ date: mv.date, qty: q, unitCost: q > 0 ? amt / q : 0 });
				} else {
					// Расход: списываем из самых старых слоёв (FIFO).
					let need = q;
					for (const L of layers) {
						if (need <= 0) break;
						if (L.qty <= 0) continue;
						const take = Math.min(need, L.qty);
						L.qty -= take;
						need -= take;
					}
					// need>0 (расход сверх остатка) игнорируем — отрицательный остаток не формируем.
				}
			}
			const open = layers.filter((L) => L.qty > 1e-9);
			if (!open.length) continue;
			let totalQty = 0, totalAmount = 0;
			const batches = open.map((L) => {
				const amount = L.qty * L.unitCost;
				totalQty += L.qty;
				totalAmount += amount;
				return { date: L.date, qty: r3(L.qty), unitCost: r2(L.unitCost), amount: r2(amount) };
			});
			items.push({
				productUuid: product?.uuid ?? null,
				productName: product?.name ?? "—",
				sku: product?.sku ?? "",
				warehouseName,
				uom,
				batches,
				totalQty: r3(totalQty),
				totalAmount: r2(totalAmount),
			});
		}

		items.sort((a, b) => a.productName.localeCompare(b.productName, "ru") || a.warehouseName.localeCompare(b.warehouseName, "ru"));
		return res.json({ success: true, items });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /reports/inventory-batches error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/product-movements ──────────────────────────────────────────
// Детализация приход/расход по конкретному товару (только проведённые).
// Params: productUuid, dateFrom, dateTo, organizationUuid
router.get("/reports/product-movements", requireReportAccess("product-movements"), async (req, res) => {
	try {
		const { productUuid, dateFrom, dateTo, organizationUuid } = req.query;
		if (!productUuid) return res.status(400).json({ success: false, message: "productUuid обязателен" });

		const docWhere = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });
		const tz = orgTimeZone(organizationUuid || null);

		// Строки ТОЛЬКО этого товара с условием на документ через связь — раньше грузились
		// все закупки и продажи периода ради одного товара (backend_performance п. 22).
		const docSelect = { uuid: true, id: true, number: true, date: true, counterparty: { select: { name: true } } };
		const [purchaseItems, saleItems] = await Promise.all([
			prisma.purchaseItem.findMany({
				where: { productUuid, deletedAt: null, purchase: docWhere },
				include: { purchase: { select: docSelect } },
			}),
			prisma.saleItem.findMany({
				where: { productUuid, deletedAt: null, sale: docWhere },
				include: { sale: { select: docSelect } },
			}),
		]);
		const localDate = (d) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) : "");

		// Fetch product name
		const product = await prisma.product.findUnique({
			where: { uuid: productUuid },
			select: { name: true },
		});

		const rows = [];

		for (const item of purchaseItems) {
			const doc = item.purchase;
			if (!doc) continue;
			rows.push({
				date: localDate(doc.date),
				direction: "in",
				docType: "purchase",
				docId: doc.id,
				docNumber: doc.number ?? null,
				docUuid: doc.uuid,
				counterpartyName: doc.counterparty?.name ?? "",
				quantity: Number(item.quantity),
				price: Number(item.price),
				amount: Number(item.amount),
			});
		}

		for (const item of saleItems) {
			const doc = item.sale;
			if (!doc) continue;
			rows.push({
				date: localDate(doc.date),
				direction: "out",
				docType: "sale",
				docId: doc.id,
				docNumber: doc.number ?? null,
				docUuid: doc.uuid,
				counterpartyName: doc.counterparty?.name ?? "",
				quantity: Number(item.quantity),
				price: Number(item.price),
				amount: Number(item.amount),
			});
		}

		rows.sort((a, b) => a.date.localeCompare(b.date) || a.docId - b.docId);

		return res.json({
			success: true,
			items: rows,
			productName: product?.name ?? productUuid,
		});
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /reports/product-movements error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/sales-by-manager ───────────────────────────────────────────
// Продажи по менеджерам (аналитика учёта «Manager»). Только проведённые
// документы. Реализация — оборот продаж, возврат от покупателя — уменьшает.
// Params: dateFrom, dateTo, organizationUuid.
router.get("/reports/sales-by-manager", requireReportAccess("sales-by-manager"), async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		const where = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });

		const [sales, returns] = await Promise.all([
			prisma.sale.groupBy({ by: ["managerUuid"], where, _sum: { amount: true, amountWithoutVat: true }, _count: { _all: true } }),
			prisma.saleReturn.groupBy({ by: ["managerUuid"], where, _sum: { amount: true, amountWithoutVat: true }, _count: { _all: true } }),
		]);

		// Имена менеджеров.
		const uuids = [...new Set([...sales, ...returns].map((r) => r.managerUuid).filter(Boolean))];
		const emps = uuids.length
			? await prisma.employee.findMany({
					where: { uuid: { in: uuids } },
					select: { uuid: true, fullName: true, firstName: true, lastName: true, middleName: true },
				})
			: [];
		const nameOf = new Map(
			emps.map((e) => [e.uuid, e.fullName || [e.lastName, e.firstName, e.middleName].filter(Boolean).join(" ") || e.uuid]),
		);

		const map = new Map();
		const ensure = (u) => {
			const k = u || "__none__";
			if (!map.has(k)) {
				map.set(k, {
					managerUuid: u || null,
					managerName: u ? nameOf.get(u) || u : "— без менеджера —",
					salesCount: 0, salesAmount: 0, returnsCount: 0, returnsAmount: 0,
					salesNet: 0, returnsNet: 0, cogs: 0,
				});
			}
			return map.get(k);
		};
		const net = (g) => r2(Number(g._sum.amountWithoutVat) || Number(g._sum.amount) || 0);
		for (const s of sales) { const r = ensure(s.managerUuid); r.salesCount = s._count._all; r.salesAmount = r2(s._sum.amount); r.salesNet = net(s); }
		for (const rr of returns) { const r = ensure(rr.managerUuid); r.returnsCount = rr._count._all; r.returnsAmount = r2(rr._sum.amount); r.returnsNet = net(rr); }

		// Себестоимость (COGS) по менеджеру: проводки 7010 реализаций/возвратов
		// привязаны к документу → менеджер документа (на 7010 субконто менеджера нет).
		const eWhere = { documentType: { in: ["sale", "sale_return"] }, OR: [{ debitAccountCode: "7010" }, { creditAccountCode: "7010" }] };
		if (where.organizationUuid) eWhere.organizationUuid = where.organizationUuid; // те же организации, что у документов
		if (where.date) eWhere.date = where.date;
		const cogsEntries = await prisma.accountingEntry.findMany({ where: eWhere, select: { amount: true, debitAccountCode: true, documentType: true, documentUuid: true } });
		const sUuids = [...new Set(cogsEntries.filter((e) => e.documentType === "sale").map((e) => e.documentUuid))];
		const rUuids = [...new Set(cogsEntries.filter((e) => e.documentType === "sale_return").map((e) => e.documentUuid))];
		const [sDocs, rDocs] = await Promise.all([
			sUuids.length ? prisma.sale.findMany({ where: { uuid: { in: sUuids } }, select: { uuid: true, managerUuid: true } }) : [],
			rUuids.length ? prisma.saleReturn.findMany({ where: { uuid: { in: rUuids } }, select: { uuid: true, managerUuid: true } }) : [],
		]);
		const mgrOf = new Map();
		for (const d of sDocs) mgrOf.set("sale:" + d.uuid, d.managerUuid);
		for (const d of rDocs) mgrOf.set("sale_return:" + d.uuid, d.managerUuid);
		for (const e of cogsEntries) {
			const g = ensure(mgrOf.get(e.documentType + ":" + e.documentUuid));
			const amt = Number(e.amount) || 0;
			if (e.documentType === "sale" && e.debitAccountCode === "7010") g.cogs += amt;
			else if (e.documentType === "sale_return" && e.creditAccountCode === "7010") g.cogs -= amt;
		}

		const rows = [...map.values()].map((r) => {
			const netRevenue = r2(r.salesNet - r.returnsNet);
			const cogs = r2(r.cogs);
			return { ...r, cogs, netAmount: r2(r.salesAmount - r.returnsAmount), netRevenue, grossProfit: r2(netRevenue - cogs) };
		});
		rows.sort((a, b) => b.grossProfit - a.grossProfit);

		const totals = rows.reduce(
			(t, r) => ({
				salesCount: t.salesCount + r.salesCount,
				salesAmount: r2(t.salesAmount + r.salesAmount),
				returnsCount: t.returnsCount + r.returnsCount,
				returnsAmount: r2(t.returnsAmount + r.returnsAmount),
				netAmount: r2(t.netAmount + r.netAmount),
				netRevenue: r2(t.netRevenue + r.netRevenue),
				cogs: r2(t.cogs + r.cogs),
				grossProfit: r2(t.grossProfit + r.grossProfit),
			}),
			{ salesCount: 0, salesAmount: 0, returnsCount: 0, returnsAmount: 0, netAmount: 0, netRevenue: 0, cogs: 0, grossProfit: 0 },
		);

		return res.json({ success: true, items: rows, totals });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /reports/sales-by-manager error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/user-performance ───────────────────────────────────────────
// Показатели эффективности пользователей (E9, collaboration): сколько документов
// каждый провёл/создал за период + состояние его задач. Источник документов —
// союз таблиц с единой формой (authorUuid + date + organizationUuid); задачи — из
// Todo (executor). Мультитенант-изоляция та же, что везде (доступные организации).
//
// Имена таблиц — жёсткий константный список (инъекции нет); фильтры параметризованы.
const PERF_DOC_TABLES = [
	"sales", "purchases", "sale_returns", "purchase_returns",
	"outgoing_invoices", "incoming_invoices", "payment_invoices",
	"purchase_requisitions", "purchase_orders", "sales_orders",
	"commercial_offers", "reservations", "inventory_transfers",
	"write_offs", "goods_receipts", "stock_counts", "import_declarations",
	"cash_orders", "bank_statements", "month_closes",
	"payroll_calculations", "payroll_payments",
];

router.get("/reports/user-performance", requireReportAccess("user-performance"), async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		// Изоляция: явная орг из фильтра ∩ доступные пользователю (чужая → 403); без
		// параметра — как tenantFilter (у суперадмина — с учётом режима поддержки).
		const orgs = reportOrgs(req, organizationUuid);
		// Сутки — местные (аудит 26.09, У5).
		const range = dateRangeWhere(dateFrom, dateTo, orgTimeZone(orgs?.[0] ?? null));
		const from = range?.gte ?? null;
		const to = range?.lte ?? null;

		// ── Документы по автору (союз таблиц) ──────────────────────────────────
		// $1 dateFrom, $2 dateTo, $3 orgs[] — переиспользуются во всех подзапросах.
		const subquery = (t) =>
			`SELECT "authorUuid" AS uid FROM "${t}" WHERE "deletedAt" IS NULL
			   AND ($1::timestamp IS NULL OR "date" >= $1)
			   AND ($2::timestamp IS NULL OR "date" <= $2)
			   AND ($3::text[] IS NULL OR "organizationUuid" = ANY($3))`;
		const docSql =
			`SELECT uid, COUNT(*)::int AS docs FROM (
				${PERF_DOC_TABLES.map(subquery).join("\n\t\t\t\tUNION ALL\n\t\t\t\t")}
			) u WHERE uid IS NOT NULL GROUP BY uid`;
		const docRows = await longQuery(docSql, from ? from.toISOString() : null, to ? to.toISOString() : null, orgs);

		// ── Задачи по исполнителю ──────────────────────────────────────────────
		const taskWhere = { deletedAt: null };
		if (orgs !== null) taskWhere.organizationUuid = { in: orgs };
		if (from || to) taskWhere.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
		const tasks = await prisma.todo.findMany({
			where: taskWhere,
			select: {
				executorUuid: true, status: true, deadline: true, kind: true, result: true, createdAt: true,
				acceptedAt: true, reminderCount: true, returnedCount: true, clientRating: true,
			},
		});
		// Закрытость — по справочнику статусов (isFinal), как на доске: раньше здесь были зашиты
		// "done"/"cancelled", и свой финальный статус считался бы вечно активной задачей (E17 СК0.1).
		const statusRows = await prisma.todoStatus.findMany({ where: { deletedAt: null }, select: { code: true, isFinal: true } });
		const finalCodes = new Set(statusRows.filter((s) => s.isFinal).map((s) => s.code));
		if (!finalCodes.size) { finalCodes.add("done"); finalCodes.add("cancelled"); }
		const CANCEL = new Set(["cancelled", "canceled", "cancel"]);

		// ── Свод по пользователю ───────────────────────────────────────────────
		const byUser = new Map();
		const ensure = (uid) => {
			if (!uid) return null;
			if (!byUser.has(uid)) byUser.set(uid, {
				userUuid: uid, docs: 0, tasksTotal: 0, tasksDone: 0, tasksOverdue: 0, tasksActive: 0,
				// E17: качество работы с задачами.
				doneWithResult: 0, reminders: 0, returned: 0, requests: 0, reactionMinutesSum: 0, reactionCount: 0, ratingSum: 0, ratingCount: 0,
			});
			return byUser.get(uid);
		};
		for (const r of docRows) { const u = ensure(r.uid); if (u) u.docs = r.docs; }
		const now = Date.now();
		for (const t of tasks) {
			const u = ensure(t.executorUuid);
			if (!u) continue;
			u.tasksTotal++;
			const closed = finalCodes.has(t.status);
			if (closed && !CANCEL.has(t.status)) {
				u.tasksDone++;
				if (t.result && t.result.trim()) u.doneWithResult++;
			}
			if (!closed) {
				u.tasksActive++;
				if (t.deadline && new Date(t.deadline).getTime() < now) u.tasksOverdue++;
			}
			u.reminders += t.reminderCount || 0;
			u.returned += t.returnedCount || 0;
			if (t.kind === "client_request") {
				u.requests++;
				if (t.acceptedAt) {
					u.reactionMinutesSum += Math.max(0, (new Date(t.acceptedAt).getTime() - new Date(t.createdAt).getTime()) / 60_000);
					u.reactionCount++;
				}
			}
			if (Number.isInteger(t.clientRating)) { u.ratingSum += t.clientRating; u.ratingCount++; }
		}
		for (const u of byUser.values()) {
			u.reactionMinutesAvg = u.reactionCount ? Math.round(u.reactionMinutesSum / u.reactionCount) : null;
			u.resultShare = u.tasksDone ? Math.round((u.doneWithResult / u.tasksDone) * 100) : null;
			u.ratingAvg = u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 10) / 10 : null;
			delete u.reactionMinutesSum; delete u.reactionCount; delete u.ratingSum; delete u.ratingCount;
		}

		// Имена пользователей.
		const uids = [...byUser.keys()];
		const users = uids.length
			? await prisma.user.findMany({ where: { uuid: { in: uids } }, select: { uuid: true, username: true, employee: { select: { fullName: true } } } })
			: [];
		const nameOf = new Map(users.map((u) => [u.uuid, u.employee?.fullName || u.username || u.uuid]));

		const items = [...byUser.values()]
			.map((u) => ({ ...u, userName: nameOf.get(u.userUuid) ?? u.userUuid }))
			.sort((a, b) => b.docs - a.docs || b.tasksDone - a.tasksDone);

		return res.json({ success: true, items });
	} catch (err) {
		if (respondReportError(err, res)) return;
		console.error("GET /reports/user-performance error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
