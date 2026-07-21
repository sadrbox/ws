import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { resolveCostingMethod } from "../../services/accountingPosting.js";
import { replayProductCosting } from "../../services/costingReplay.js";

const router = express.Router();

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
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

function buildDocWhere(req, { dateFrom, dateTo, organizationUuid } = {}) {
	const where = { posted: true, ...tenantFilter(req) };
	if (dateFrom || dateTo) {
		where.date = {};
		if (dateFrom) where.date.gte = new Date(dateFrom);
		if (dateTo) where.date.lte = new Date(dateTo + "T23:59:59.999Z");
	}
	if (organizationUuid) where.organizationUuid = organizationUuid;
	return where;
}

// ─── GET /reports/sales-by-product ───────────────────────────────────────────
// Params: dateFrom, dateTo, organizationUuid, counterpartyUuid
router.get("/reports/sales-by-product", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, counterpartyUuid } = req.query;

		const saleWhere = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });
		if (counterpartyUuid) saleWhere.counterpartyUuid = counterpartyUuid;

		const sales = await prisma.sale.findMany({
			where: saleWhere,
			select: { uuid: true, organization: { select: { name: true } } },
		});

		const saleUuids = sales.map((s) => s.uuid);
		const orgName = organizationUuid
			? (sales.find((s) => s.organization)?.organization?.name ?? "")
			: "";

		if (saleUuids.length === 0) return res.json({ success: true, items: [], orgName });

		const items = await prisma.saleItem.findMany({
			where: { saleUuid: { in: saleUuids }, deletedAt: null },
			include: {
				product: { select: { uuid: true, name: true } },
				unitOfMeasure: { select: { name: true } },
			},
			orderBy: { id: "asc" },
		});

		const map = new Map();
		for (const item of items) {
			const key = item.productUuid ?? "__no_product__";
			if (!map.has(key)) {
				map.set(key, {
					productUuid: item.productUuid,
					productName: item.product?.name ?? "—",
					uom: item.unitOfMeasure?.name ?? "",
					qtySale: 0, qtyReturn: 0, amountSale: 0, amountReturn: 0,
					exciseAmountSale: 0, vatAmountSale: 0, amountNoTaxSale: 0,
				});
			}
			const row = map.get(key);
			row.qtySale += Number(item.quantity);
			row.amountSale += Number(item.amount);
			row.exciseAmountSale += Number(item.exciseAmount);
			row.vatAmountSale += Number(item.vatAmount);
			row.amountNoTaxSale += Number(item.amountWithoutVat);
		}

		// ── Возвраты от покупателя за тот же период ──────────────────────────
		const returnWhere = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });
		if (counterpartyUuid) returnWhere.counterpartyUuid = counterpartyUuid;
		const saleReturns = await prisma.saleReturn.findMany({ where: returnWhere, select: { uuid: true } });
		const returnUuids = saleReturns.map((r) => r.uuid);

		if (returnUuids.length > 0) {
			const returnItems = await prisma.saleReturnItem.findMany({
				where: { saleReturnUuid: { in: returnUuids }, deletedAt: null },
				include: { product: { select: { uuid: true, name: true } }, unitOfMeasure: { select: { name: true } } },
			});
			for (const item of returnItems) {
				const key = item.productUuid ?? "__no_product__";
				if (!map.has(key)) {
					map.set(key, {
						productUuid: item.productUuid,
						productName: item.product?.name ?? "—",
						uom: item.unitOfMeasure?.name ?? "",
						qtySale: 0, qtyReturn: 0, amountSale: 0, amountReturn: 0,
						exciseAmountSale: 0, vatAmountSale: 0, amountNoTaxSale: 0,
						amountNoTaxReturn: 0,
					});
				}
				const row = map.get(key);
				row.qtyReturn += Number(item.quantity);
				row.amountReturn += Number(item.amount);
				row.amountNoTaxReturn = (row.amountNoTaxReturn ?? 0) + Number(item.amountWithoutVat ?? item.amount);
				// Акциз возврата — чтобы вычесть его симметрично акцизу реализации.
				row.exciseAmountReturn = (row.exciseAmountReturn ?? 0) + Number(item.exciseAmount ?? 0);
			}
		}

		// ── Себестоимость проданного: из ПРОВОДОК, а не пересчётом ───────────
		// Дт 7010 Кт 1330 при реализации и обратная Дт 1330 Кт 7010 при возврате.
		// Проводки формируются на проведении по фактической политике организации
		// (ФИФО/средняя), поэтому отчёт всегда сходится с ОСВ и карточкой счёта.
		const costByProduct = new Map();
		const docUuids = [...saleUuids, ...returnUuids];
		if (docUuids.length > 0) {
			const entries = await prisma.accountingEntry.findMany({
				where: {
					documentUuid: { in: docUuids },
					OR: [{ debitAccountCode: COGS_ACCOUNT_CODE }, { creditAccountCode: COGS_ACCOUNT_CODE }],
				},
				select: {
					amount: true,
					debitAccountCode: true,
					analytics: { where: { subkontoType: "Nomenclature" }, select: { objectUuid: true } },
				},
			});
			for (const e of entries) {
				const productUuid = e.analytics.find((a) => a.objectUuid)?.objectUuid;
				if (!productUuid) continue;
				// Дт 7010 — себестоимость списана; Кт 7010 — возвращена (сторно).
				const sign = e.debitAccountCode === COGS_ACCOUNT_CODE ? 1 : -1;
				costByProduct.set(productUuid, (costByProduct.get(productUuid) ?? 0) + sign * Number(e.amount));
			}
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
		console.error("GET /reports/sales-by-product error:", err);
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
router.get("/reports/material-statement", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid, warehouseUuid } = req.query;

		// Фильтр регистра: tenant + явная орг/склад. Дата — до конца dateTo
		// включительно (движения после периода не загружаем; начальный остаток
		// формируется движениями ДО dateFrom).
		const where = { ...tenantFilter(req) };
		if (organizationUuid) where.organizationUuid = organizationUuid;
		if (warehouseUuid) where.warehouseUuid = warehouseUuid;
		if (dateTo) where.date = { lte: new Date(dateTo + "T23:59:59.999Z") };

		const movements = await prisma.productRegister.findMany({
			where,
			include: {
				product: { select: { uuid: true, name: true, sku: true } },
				unitOfMeasure: { select: { name: true } },
			},
			// Порядок ОБЯЗАН совпадать с ФИФО проводок: (date, documentId, id).
			orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
		});

		const from = dateFrom ? new Date(dateFrom) : null;
		// Метод — тот, что действовал на конец периода (учётная политика по дате).
		const method = await resolveCostingMethod(organizationUuid || null, dateTo ? new Date(dateTo) : null);

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
					...(organizationUuid ? { organizationUuid } : {}),
					...(warehouseUuid ? { warehouseUuid } : {}),
					...(from || dateTo
						? { date: { ...(from ? { gte: from } : {}), ...(dateTo ? { lte: new Date(dateTo + "T23:59:59.999Z") } : {}) } }
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
router.get("/reports/inventory-batches", async (req, res) => {
	try {
		const { organizationUuid, warehouseUuid, productUuid, dateTo } = req.query;
		const where = { ...tenantFilter(req) };
		if (organizationUuid) where.organizationUuid = organizationUuid;
		if (warehouseUuid) where.warehouseUuid = warehouseUuid;
		if (productUuid) where.productUuid = productUuid;
		if (dateTo) where.date = { lte: new Date(dateTo + "T23:59:59.999Z") };

		const movements = await prisma.productRegister.findMany({
			where,
			include: {
				product: { select: { uuid: true, name: true, sku: true } },
				unitOfMeasure: { select: { name: true } },
				warehouse: { select: { name: true } },
			},
			orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
		});

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
		console.error("GET /reports/inventory-batches error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/product-movements ──────────────────────────────────────────
// Детализация приход/расход по конкретному товару (только проведённые).
// Params: productUuid, dateFrom, dateTo, organizationUuid
router.get("/reports/product-movements", async (req, res) => {
	try {
		const { productUuid, dateFrom, dateTo, organizationUuid } = req.query;
		if (!productUuid) return res.status(400).json({ success: false, message: "productUuid обязателен" });

		const docWhere = buildDocWhere(req, { dateFrom, dateTo, organizationUuid });

		const [purchases, sales] = await Promise.all([
			prisma.purchase.findMany({
				where: docWhere,
				select: { uuid: true, id: true, date: true, counterparty: { select: { name: true } } },
			}),
			prisma.sale.findMany({
				where: docWhere,
				select: { uuid: true, id: true, date: true, counterparty: { select: { name: true } } },
			}),
		]);

		const purchaseMap = new Map(purchases.map((d) => [d.uuid, d]));
		const saleMap = new Map(sales.map((d) => [d.uuid, d]));

		const [purchaseItems, saleItems] = await Promise.all([
			purchases.length > 0
				? prisma.purchaseItem.findMany({
						where: {
							purchaseUuid: { in: purchases.map((p) => p.uuid) },
							productUuid,
							deletedAt: null,
						},
					})
				: [],
			sales.length > 0
				? prisma.saleItem.findMany({
						where: {
							saleUuid: { in: sales.map((s) => s.uuid) },
							productUuid,
							deletedAt: null,
						},
					})
				: [],
		]);

		// Fetch product name
		const product = await prisma.product.findUnique({
			where: { uuid: productUuid },
			select: { name: true },
		});

		const rows = [];

		for (const item of purchaseItems) {
			const doc = purchaseMap.get(item.purchaseUuid);
			if (!doc) continue;
			rows.push({
				date: doc.date?.toISOString().slice(0, 10) ?? "",
				direction: "in",
				docType: "purchase",
				docId: doc.id,
				docUuid: doc.uuid,
				counterpartyName: doc.counterparty?.name ?? "",
				quantity: Number(item.quantity),
				price: Number(item.price),
				amount: Number(item.amount),
			});
		}

		for (const item of saleItems) {
			const doc = saleMap.get(item.saleUuid);
			if (!doc) continue;
			rows.push({
				date: doc.date?.toISOString().slice(0, 10) ?? "",
				direction: "out",
				docType: "sale",
				docId: doc.id,
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
		console.error("GET /reports/product-movements error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ─── GET /reports/sales-by-manager ───────────────────────────────────────────
// Продажи по менеджерам (аналитика учёта «Manager»). Только проведённые
// документы. Реализация — оборот продаж, возврат от покупателя — уменьшает.
// Params: dateFrom, dateTo, organizationUuid.
router.get("/reports/sales-by-manager", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
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
		const eWhere = { ...tenantFilter(req), documentType: { in: ["sale", "sale_return"] }, OR: [{ debitAccountCode: "7010" }, { creditAccountCode: "7010" }] };
		if (organizationUuid) eWhere.organizationUuid = organizationUuid;
		if (dateFrom || dateTo) { eWhere.date = {}; if (dateFrom) eWhere.date.gte = new Date(dateFrom); if (dateTo) eWhere.date.lte = new Date(dateTo + "T23:59:59.999Z"); }
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

/** Массив uuid организаций для raw-SQL изоляции (null = суперадмин, видит всё). */
function allowedOrgArray(req) {
	if (req.user?.isSuperAdmin) return null;
	if (req.user?.organizationUuid) return [req.user.organizationUuid];
	if (req.user?.allowedOrgUuids?.length) return req.user.allowedOrgUuids;
	return []; // ни активной, ни разрешённых — не видит ничего
}

router.get("/reports/user-performance", async (req, res) => {
	try {
		const { dateFrom, dateTo, organizationUuid } = req.query;
		const from = dateFrom ? new Date(dateFrom) : null;
		const to = dateTo ? new Date(dateTo + "T23:59:59.999Z") : null;

		// Изоляция: явная орг из фильтра ∩ доступные пользователю.
		let orgs = allowedOrgArray(req);
		if (organizationUuid) {
			orgs = orgs === null ? [organizationUuid] : orgs.filter((o) => o === organizationUuid);
		}

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
		const docRows = await prisma.$queryRawUnsafe(docSql, from, to, orgs);

		// ── Задачи по исполнителю ──────────────────────────────────────────────
		const taskWhere = { deletedAt: null };
		if (orgs !== null) taskWhere.organizationUuid = { in: orgs };
		if (from || to) taskWhere.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
		const tasks = await prisma.todo.findMany({
			where: taskWhere,
			select: { executorUuid: true, status: true, deadline: true },
		});

		// ── Свод по пользователю ───────────────────────────────────────────────
		const byUser = new Map();
		const ensure = (uid) => {
			if (!uid) return null;
			if (!byUser.has(uid)) byUser.set(uid, { userUuid: uid, docs: 0, tasksTotal: 0, tasksDone: 0, tasksOverdue: 0, tasksActive: 0 });
			return byUser.get(uid);
		};
		for (const r of docRows) { const u = ensure(r.uid); if (u) u.docs = r.docs; }
		const now = Date.now();
		for (const t of tasks) {
			const u = ensure(t.executorUuid);
			if (!u) continue;
			u.tasksTotal++;
			const closed = t.status === "done" || t.status === "cancelled";
			if (t.status === "done") u.tasksDone++;
			if (!closed) {
				u.tasksActive++;
				if (t.deadline && new Date(t.deadline).getTime() < now) u.tasksOverdue++;
			}
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
		console.error("GET /reports/user-performance error:", err);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
