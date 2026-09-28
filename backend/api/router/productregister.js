// ─────────────────────────────────────────────────────────────────────────────
// Регистр накопления «Товары» — API (только чтение).
//   GET /product-register           — движения (приход/расход) за период
//   GET /product-register/balances  — остатки (Σприход − Σрасход) по товар+склад
// Записи формируются автоматически при проведении документов
// (см. services/productRegister.js). Ручного создания/изменения нет.
//
// Параметры (query, плоские): dateFrom, dateTo, organizationUuid,
// warehouseUuid, productUuid, documentType, movementType.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { computeShortages, savedDocumentForCheck } from "../../services/productRegister.js";
import { resolveStockControl, documentNumbers } from "../../services/accountingPosting.js";
import { reportOrgs, orgWhere, respondReportScopeError } from "../../services/reportScope.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { dateRangeWhere, orgTimeZone, respondBadDateError } from "../../services/periodBounds.js";
import { r2, r4 } from "../../services/money.js";
import { withLongStatements } from "../../services/documentLock.js";

const router = express.Router();
const MODEL = "productRegister";
const ROUTE = "product-register";

// Список движений — просмотр, не выгрузка: больше MAX_ROWS строк не отдаём и честно
// сообщаем об обрезке (truncated), а отсортированы они по дате — первые, а не случайные.
const MAX_ROWS = 10000;

function buildWhere(req) {
	const q = req.query;
	// Организация из запроса ПЕРЕСЕКАЕТСЯ с доступными (аудит 26.09, Б6): раньше она
	// перезаписывала tenantFilter — остатки чужой организации открывались по uuid.
	const orgs = reportOrgs(req, q.organizationUuid ? String(q.organizationUuid) : null);
	const where = { ...orgWhere(orgs) };
	// Период по дате движения — местные сутки организации, обе даты включительно.
	const range = dateRangeWhere(q.dateFrom ? String(q.dateFrom) : null, q.dateTo ? String(q.dateTo) : null, orgTimeZone(orgs?.[0] ?? null));
	if (range) where.date = range;
	if (q.warehouseUuid) where.warehouseUuid = String(q.warehouseUuid);
	if (q.productUuid) where.productUuid = String(q.productUuid);
	if (q.documentType) where.documentType = String(q.documentType);
	if (q.movementType) where.movementType = String(q.movementType);
	return where;
}

// ── GET список движений ──────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const where = buildWhere(req);
		// Выборка по всей истории регистра — со своим пределом запроса (КР-15 аудита 27.09).
		const items = await withLongStatements(prisma, (tx) => tx[MODEL].findMany({
			where,
			take: MAX_ROWS,
			orderBy: [{ date: "asc" }, { id: "asc" }],
			include: {
				product: { include: { brand: true } },
				warehouse: true,
				unitOfMeasure: true,
				organization: true,
			},
		}));
		// Номер документа движения — чтобы отчёт показывал «№ номер», а не id (И22).
		const numbers = await documentNumbers(items);
		const withNumbers = items.map((m) => ({ ...m, documentNumber: numbers.get(`${m.documentType}:${m.documentUuid}`) ?? null }));
		return res.status(200).json({ success: true, items: withNumbers, total: items.length, truncated: items.length >= MAX_ROWS });
	} catch (error) {
		if (respondBadDateError(error, res) || respondReportScopeError(error, res)) return;
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET остатки (Σприход − Σрасход) по товар+склад ───────────────────────────
// Агрегатом в SQL по ВСЕМ движениям фильтра (аудит 26.09, Н3): раньше в JS читались
// первые 10 000 движений БЕЗ сортировки и суммировались — на больших базах остатки были
// молча неверны. Имена товаров/складов/единиц — отдельными запросами по найденным uuid.
router.get(`/${ROUTE}/balances`, async (req, res) => {
	try {
		const where = buildWhere(req);
		const groups = await withLongStatements(prisma, (tx) => tx[MODEL].groupBy({
			by: ["productUuid", "warehouseUuid", "movementType"],
			where,
			_sum: { quantity: true, amount: true },
			_max: { unitOfMeasureUuid: true },
		}));

		// Сворачиваем по ключу товар+склад (знак — по movementType).
		const map = new Map();
		for (const g of groups) {
			const key = `${g.productUuid ?? ""}|${g.warehouseUuid ?? ""}`;
			let acc = map.get(key);
			if (!acc) {
				acc = { productUuid: g.productUuid ?? null, warehouseUuid: g.warehouseUuid ?? null, uomUuid: null, quantity: 0, amount: 0 };
				map.set(key, acc);
			}
			const sign = g.movementType === "out" ? -1 : 1;
			acc.quantity += sign * (Number(g._sum?.quantity) || 0);
			acc.amount += sign * (Number(g._sum?.amount) || 0);
			acc.uomUuid ??= g._max?.unitOfMeasureUuid ?? null;
		}
		const list = [...map.values()];
		const uniq = (f) => [...new Set(list.map((a) => a[f]).filter(Boolean))];
		const [products, warehouses, uoms] = await Promise.all([
			prisma.product.findMany({ where: { uuid: { in: uniq("productUuid") } }, select: { uuid: true, name: true, sku: true } }),
			prisma.warehouse.findMany({ where: { uuid: { in: uniq("warehouseUuid") } }, select: { uuid: true, name: true } }),
			prisma.unitOfMeasure.findMany({ where: { uuid: { in: uniq("uomUuid") } }, select: { uuid: true, name: true } }),
		]);
		const pMap = new Map(products.map((p) => [p.uuid, p]));
		const wMap = new Map(warehouses.map((w) => [w.uuid, w.name]));
		const uMap = new Map(uoms.map((u) => [u.uuid, u.name]));
		const items = list
			.map((a) => ({
				productUuid: a.productUuid,
				productName: pMap.get(a.productUuid)?.name ?? "",
				sku: pMap.get(a.productUuid)?.sku ?? "",
				warehouseUuid: a.warehouseUuid,
				warehouseName: wMap.get(a.warehouseUuid) ?? "",
				unitName: uMap.get(a.uomUuid) ?? "",
				quantity: r4(a.quantity),
				amount: r2(a.amount),
			}))
			.sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		if (respondBadDateError(error, res) || respondReportScopeError(error, res)) return;
		console.error(`GET /${ROUTE}/balances error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST проверка доступности остатка (pre-check перед проведением) ──────────
// Body: { documentType, documentUuid?, organizationUuid?, date?, warehouseUuid?,
//         fromWarehouseUuid?, toWarehouseUuid?, basisDocumentType?, basisDocumentUuid?,
//         items: [{ productUuid, quantity }] }
// Считает дефициты по ПЕРЕДАННЫМ (ещё не сохранённым) строкам — для UX-проверки
// в форме до сохранения. Источник истины — бэкенд-гард при проведении.
router.post(`/${ROUTE}/check-availability`, async (req, res) => {
	try {
		const {
			documentType,
			documentUuid,
			warehouseUuid,
			fromWarehouseUuid,
			organizationUuid,
			date,
			items,
		} = req.body ?? {};
		if (!documentType || !Array.isArray(items)) {
			return res.status(400).json({
				success: false,
				message: "Требуются documentType и items[]",
			});
		}
		// Остатки — только по складам доступных организаций (Б6): иначе предпроверка
		// показывала бы количество товара на чужом складе по его uuid.
		const orgs = reportOrgs(req, null);
		const whUuids = [warehouseUuid, fromWarehouseUuid, req.body?.toWarehouseUuid].filter((w) => typeof w === "string" && w);
		if (orgs !== null && whUuids.length) {
			const whs = await prisma.warehouse.findMany({ where: { uuid: { in: whUuids } }, select: { organizationUuid: true } });
			if (whs.some((w) => w.organizationUuid && !orgs.includes(w.organizationUuid))) {
				return res.status(404).json({ success: false, message: "Склад не найден" });
			}
		}
		// Предпроверка формы обязана совпадать с бэкенд-гардом: если контроль
		// остатков у организации выключен, предупреждать не о чем.
		const orgUuid = organizationUuid || req.user?.organizationUuid || null;
		if (!(await resolveStockControl(orgUuid, date ?? null))) {
			return res.status(200).json({ success: true, shortages: [] });
		}
		// Дата документа — контроль по хронологии (аудит 26.09, У4): предпроверка формы
		// совпадает с серверным гардом. id документа — из сохранённого: его движения в регистре
		// — «до изменения». Поля выборки — по модели типа, ошибка не глушится (КР-7 аудита 27.09:
		// у перемещения нет основания, выборка падала молча, и проведённое перемещение не
		// исключало свои движения — ложная нехватка при пересохранении).
		let saved = null;
		if (documentUuid && typeof documentUuid === "string") {
			saved = await savedDocumentForCheck(documentType, documentUuid);
			if (saved && saved.organizationUuid && orgUuid && saved.organizationUuid !== orgUuid) saved = null;
			// Склады сохранённого документа ниже подставляются в проверку — только доступного.
			if (saved?.organizationUuid && !orgIsAccessible(req, saved.organizationUuid)) saved = null;
		}
		// Склады и основание — из формы, если она их прислала (в т. ч. очищенные), иначе из
		// сохранённого документа: форма перемещения шлёт только склад-источник, и без склада-
		// получателя его приход уходил бы «на склад без имени».
		const body = req.body ?? {};
		const pick = (f) => (f in body ? body[f] ?? null : saved?.[f] ?? null);
		const shortages = await computeShortages({
			documentType,
			documentUuid: saved ? documentUuid : undefined,
			doc: {
				warehouseUuid: pick("warehouseUuid"),
				fromWarehouseUuid: pick("fromWarehouseUuid"),
				toWarehouseUuid: pick("toWarehouseUuid"),
				date: date ? new Date(date) : new Date(),
				id: saved?.id ?? null,
				basisDocumentType: pick("basisDocumentType"),
				basisDocumentUuid: pick("basisDocumentUuid"),
			},
			items,
		});
		return res
			.status(200)
			.json({ success: true, ok: shortages.length === 0, shortages });
	} catch (error) {
		if (respondReportScopeError(error, res)) return;
		console.error(`POST /${ROUTE}/check-availability error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
