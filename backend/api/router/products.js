import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, checkOwnership } from "../../utils/auth.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { reconcileProductPrice } from "../../services/productPricing.js";

const router = express.Router();

const num = (v) => (v != null && v !== "" ? parseFloat(v) : null);
const norm = (s) => String(s ?? "").trim();
const toDay = (v) => {
	const d = v ? new Date(v) : new Date();
	return Number.isNaN(d.getTime()) ? new Date() : d;
};

const MODEL = "product";
const ROUTE = "products";
const TEXT_FIELDS = ["name", "sku", "barcode"];

// ── GET list ────────────────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const rawLimit = req.query.limit;
		const rawCursor = req.query.cursor;
		const search =
			typeof req.query.search === "string" ? req.query.search.trim() : "";
		const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 500;
		const limitNumber = Math.min(Math.max(parsedLimit, 1), 999999);
		const cursorNumber = rawCursor !== undefined ? Number(rawCursor) : null;
		if (rawCursor !== undefined && (isNaN(cursorNumber) || cursorNumber <= 0))
			return res
				.status(400)
				.json({ success: false, message: "Некорректный параметр cursor" });

		const filter =
			req.query.filter && typeof req.query.filter === "object"
				? req.query.filter
				: {};
		const orderBy = [];
		const sortParam =
			typeof req.query.sort === "string" ? req.query.sort : null;
		if (sortParam) {
			try {
				const s = JSON.parse(sortParam);
				if (s && typeof s === "object")
					for (const [f, d] of Object.entries(s)) {
						if (d === "asc" || d === "desc") { const parts = f.split("."); orderBy.push(parts.length === 2 ? { [parts[0]]: { [parts[1]]: d } } : { [f]: d }); }
					}
			} catch {}
		}
		if (orderBy.length === 0) orderBy.push({ id: "asc" });
		else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });

		const searchWords = search ? search.split(/\s+/).filter(Boolean) : [];
		let searchWhere = {};
		if (searchWords.length > 0)
			searchWhere = {
				AND: searchWords.map((w) => {
					const orConditions = TEXT_FIELDS.map((f) => ({
						[f]: { contains: w, mode: "insensitive" },
					}));
					// Поиск также по дополнительным штрих-кодам товара (таблица).
					orConditions.push({
						barcodes: { some: { barcode: { contains: w, mode: "insensitive" } } },
					});
					const num = Number(w);
					if (Number.isInteger(num) && num > 0) {
						orConditions.push({ id: { equals: num } });
					}
					return { OR: orConditions };
				}),
			};

		const ALLOWED = ["contains", "equals", "gte", "lte", "gt", "lt"];
		const filterWhere = {};
		for (const [field, conds] of Object.entries(filter)) {
			if (
				["searchBy", "dateRange"].includes(field) ||
				!conds ||
				typeof conds !== "object"
			)
				continue;
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
			include: { brand: true, unitOfMeasure: true },
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

// ── GET export-full: вся номенклатура со штрих-кодами и ценами (для выгрузки) ──
// Объявлен ДО `/:id`. Штрих-коды и цены группируются по товару на клиенте.
router.get(`/${ROUTE}/export-full`, async (req, res) => {
	try {
		const items = await prisma[MODEL].findMany({
			where: { ...tenantFilter(req) },
			orderBy: { name: "asc" },
			take: 100000,
			include: {
				brand: { select: { name: true } },
				unitOfMeasure: { select: { name: true } },
				barcodes: { select: { barcode: true }, orderBy: { id: "asc" } },
				productPrices: {
					select: { price: true, date: true, priceType: { select: { name: true } } },
					orderBy: { date: "desc" },
				},
			},
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE}/export-full error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: { brand: true, unitOfMeasure: true },
		});
		if (!item || !checkOwnership(item, req))
			return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { name, sku, barcode, brandUuid, unitOfMeasureUuid, isService, price } = req.body;
		if (!name?.trim())
			return res
				.status(400)
				.json({ success: false, message: "Наименование обязательно" });
		const item = await prisma[MODEL].create({
			data: {
				name: name.trim(),
				sku: sku?.trim() || null,
				barcode: barcode?.trim() || null,
				isService: isService === true,
				price: price != null && price !== "" ? parseFloat(price) : null,
				brandUuid: brandUuid || null,
				unitOfMeasureUuid: unitOfMeasureUuid || null,
				organizationUuid: req.user?.organizationUuid ?? null,
			},
			include: { brand: true, unitOfMeasure: true },
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ─────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		const strFields = ["name", "sku", "barcode", "brandUuid", "unitOfMeasureUuid"];
		for (const f of strFields) {
			if (req.body[f] !== undefined)
				data[f] = req.body[f]?.trim?.() ?? req.body[f] ?? null;
		}
		if (req.body.isService !== undefined) data.isService = req.body.isService === true;
		if (req.body.price !== undefined) data.price = req.body.price != null && req.body.price !== "" ? parseFloat(req.body.price) : null;
		const existing = await prisma[MODEL].findUnique({ where: w, select: { organizationUuid: true } });
		if (!existing || !checkOwnership(existing, req))
			return res.status(404).json({ success: false, message: "Не найдено" });
		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: { brand: true, unitOfMeasure: true },
		});
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST import: загрузка номенклатуры из файла (товар + штрих-коды + цены) ──
// body: { rows: [{ sku, name, brandName, unitName, isService, barcodes:[..],
//                   prices:[{ typeName, value }] }], date? }
router.post(`/${ROUTE}/import`, async (req, res) => {
	try {
		const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
		if (rows.length === 0)
			return res.status(400).json({ success: false, message: "rows обязателен" });
		const orgUuid = req.user?.organizationUuid ?? null;
		const date = toDay(req.body?.date);

		// Карты справочников по имени (lowercase) → uuid.
		const [brands, units, priceTypes] = await Promise.all([
			prisma.brand.findMany({ select: { uuid: true, name: true } }),
			prisma.unitOfMeasure.findMany({ select: { uuid: true, name: true } }),
			prisma.priceType.findMany({ select: { uuid: true, name: true } }),
		]);
		const mapBy = (arr) => new Map(arr.filter((x) => x.name).map((x) => [x.name.trim().toLowerCase(), x.uuid]));
		const brandMap = mapBy(brands), unitMap = mapBy(units), typeMap = mapBy(priceTypes);

		const summary = { created: 0, updated: 0, barcodesAdded: 0, pricesAdded: 0, skipped: 0, errors: [] };
		const affected = new Set();

		await prisma.$transaction(async (tx) => {
			for (const [idx, r] of rows.entries()) {
				try {
					const sku = norm(r.sku);
					const name = norm(r.name);
					const barcodes = Array.isArray(r.barcodes) ? r.barcodes.map(norm).filter(Boolean) : [];
					const brandUuid = r.brandName ? brandMap.get(norm(r.brandName).toLowerCase()) ?? null : null;
					const unitOfMeasureUuid = r.unitName ? unitMap.get(norm(r.unitName).toLowerCase()) ?? null : null;
					const isService = r.isService === true || r.isService === 1 || /^(да|yes|true|1|услуга)$/i.test(norm(r.isService));

					// Поиск существующего товара: по артикулу, затем по штрих-коду.
					let product = null;
					if (sku) product = await tx.product.findFirst({ where: { sku, ...(orgUuid ? { organizationUuid: orgUuid } : {}) } });
					if (!product && barcodes.length) product = await tx.product.findFirst({ where: { barcode: barcodes[0], ...(orgUuid ? { organizationUuid: orgUuid } : {}) } });

					if (product) {
						const data = {};
						if (name) data.name = name;
						if (sku) data.sku = sku;
						if (barcodes.length) data.barcode = barcodes[0];
						if (r.brandName !== undefined) data.brandUuid = brandUuid;
						if (r.unitName !== undefined) data.unitOfMeasureUuid = unitOfMeasureUuid;
						if (r.isService !== undefined) data.isService = isService;
						product = await tx.product.update({ where: { uuid: product.uuid }, data });
						summary.updated++;
					} else {
						if (!name) { summary.skipped++; summary.errors.push({ idx, message: "Пустое наименование" }); continue; }
						product = await tx.product.create({
							data: {
								name, sku: sku || null, barcode: barcodes[0] || null,
								isService, brandUuid, unitOfMeasureUuid, organizationUuid: orgUuid,
							},
						});
						summary.created++;
					}

					// Штрих-коды: гарантируем наличие записи на каждый ШК (без дублей).
					for (const bc of barcodes) {
						const exists = await tx.productBarcode.findFirst({ where: { productUuid: product.uuid, barcode: bc } });
						if (!exists) { await tx.productBarcode.create({ data: { productUuid: product.uuid, barcode: bc } }); summary.barcodesAdded++; }
					}

					// Цены: на каждый тип цены с непустым значением создаём запись (идемпотентно).
					const prices = Array.isArray(r.prices) ? r.prices : [];
					for (const p of prices) {
						const val = num(p.value);
						if (val == null) continue;
						const priceTypeUuid = p.typeName ? typeMap.get(norm(p.typeName).toLowerCase()) ?? null : null;
						const start = new Date(date); start.setHours(0, 0, 0, 0);
						const end = new Date(start); end.setDate(end.getDate() + 1);
						const dup = await tx.productPrice.findFirst({
							where: { productUuid: product.uuid, priceTypeUuid: priceTypeUuid ?? null, price: val, date: { gte: start, lt: end } },
						});
						if (!dup) { await tx.productPrice.create({ data: { productUuid: product.uuid, priceTypeUuid: priceTypeUuid ?? null, date, price: val } }); summary.pricesAdded++; }
					}
					affected.add(product.uuid);
				} catch (err) {
					summary.errors.push({ idx, message: String(err?.message || err) });
				}
			}
		}, { timeout: 120000 });

		if (affected.size) await reconcileProductPrice([...affected]);
		return res.status(200).json({ success: true, summary });
	} catch (error) {
		console.error(`POST /${ROUTE}/import error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
