// Цены номенклатуры (вкладка «Цены» в форме товара): дата + тип цены + цена.
// Sub-таблица товара: GET (по productUuid) / POST / PUT / DELETE / batch.
// После изменения цен пересчитываем Product.price (цена типа «по умолчанию»).
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import {
	handleDelete,
	handleBatchDelete,
} from "../../utils/checkReferences.js";
import { tenantFilter } from "../../utils/auth.js";

const router = express.Router();
const MODEL = "productPrice";
const ROUTE = "product-prices";

const num = (v) => (v != null && v !== "" ? parseFloat(v) : null);
const toDate = (v) => (v ? new Date(v) : new Date());
const INCLUDE = {
	priceType: { select: { uuid: true, name: true } },
	product: {
		select: {
			uuid: true,
			name: true,
			sku: true,
			barcode: true,
			brand: { select: { name: true } },
		},
	},
};

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { productUuid, priceTypeUuid, date, brandUuid, limit } = req.query;
		const where = {};

		// Фильтр по productUuid (если указан)
		if (productUuid) {
			where.productUuid = String(productUuid);
		}

		// Фильтр по бренду номенклатуры (через связь product)
		if (brandUuid) {
			where.product = { brandUuid: String(brandUuid) };
		}

		// Фильтр по priceTypeUuid (если указан)
		if (priceTypeUuid) {
			const uuidStr = String(priceTypeUuid).trim();
			if (!uuidStr) {
				return res.status(400).json({
					success: false,
					message: "priceTypeUuid не может быть пустым",
				});
			}
			where.priceTypeUuid = uuidStr;
		}

		// Фильтр по дате (если указана) — ищем по дате без времени
		if (date) {
			try {
				// Parses date string like "2026-06-04" or "2026-06-04T00:00:00Z"
				const d = new Date(date);
				if (isNaN(d.getTime())) {
					return res.status(400).json({
						success: false,
						message: `Неверный формат даты: ${date}. Используйте ISO 8601 формат (2026-06-04 или 2026-06-04T00:00:00Z)`,
					});
				}

				// Extract date parts in UTC to avoid timezone issues
				const year = d.getUTCFullYear();
				const month = String(d.getUTCMonth() + 1).padStart(2, "0");
				const day = String(d.getUTCDate()).padStart(2, "0");
				const dateStr = `${year}-${month}-${day}`;

				// Create start and end of day in UTC
				const start = new Date(`${dateStr}T00:00:00.000Z`);
				const end = new Date(`${dateStr}T00:00:00.000Z`);
				end.setUTCDate(end.getUTCDate() + 1);

				where.date = { gte: start, lt: end };
			} catch (err) {
				return res.status(400).json({
					success: false,
					message: `Ошибка парсинга даты: ${err.message}`,
				});
			}
		}

		// Фильтры необязательны: без них вернём последние цены (по дате убыв.),
		// ограниченные limit — для обработки «Корректировка цен».

		const parsedLimit = limit
			? Math.min(parseInt(limit, 10) || 1000, 5000)
			: 1000;

		const items = await prisma[MODEL].findMany({
			where,
			include: INCLUDE,
			orderBy: [{ date: "desc" }, { id: "desc" }],
			take: parsedLimit,
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера",
			error: error.message,
		});
	}
});

// Полный экспорт всех цен (бэкап) — без фильтров и без ограничения limit.
// Объявлен ДО `/:id`, иначе "export" будет принят за id.
router.get(`/${ROUTE}/export`, async (req, res) => {
	try {
		const items = await prisma[MODEL].findMany({
			include: INCLUDE,
			orderBy: [{ date: "desc" }, { id: "desc" }],
			take: 100000,
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE}/export error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET price-list: текущие цены номенклатуры по ОДНОМУ типу цены ──────────────
// Последняя цена выбранного типа на каждый товар (relation take:1). Питает отчёт
// «Прайс-лист» и префетч цен в терминале. Объявлен ДО `/:id`.
// Params: priceTypeUuid (опц.→дефолтный isDefault), brandUuid, search, onlyPriced.
router.get(`/${ROUTE}/price-list`, async (req, res) => {
	try {
		const reqType = typeof req.query.priceTypeUuid === "string" ? req.query.priceTypeUuid.trim() : "";
		const brandUuid = typeof req.query.brandUuid === "string" ? req.query.brandUuid.trim() : "";
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const onlyPriced = req.query.onlyPriced === "1" || req.query.onlyPriced === "true";

		// Тип цены: из параметра или тип «по умолчанию» (как в productPricing.js).
		let priceType = null;
		if (reqType) {
			priceType = await prisma.priceType.findFirst({ where: { uuid: reqType, deletedAt: null }, select: { uuid: true, name: true } });
		}
		if (!priceType) {
			priceType = await prisma.priceType.findFirst({ where: { isDefault: true, deletedAt: null }, select: { uuid: true, name: true } });
		}
		if (!priceType) {
			return res.status(200).json({ success: true, priceTypeUuid: null, priceTypeName: null, items: [] });
		}

		const where = { ...tenantFilter(req), deletedAt: null };
		if (brandUuid) where.brandUuid = brandUuid;
		if (search) {
			where.OR = [
				{ name: { contains: search, mode: "insensitive" } },
				{ sku: { contains: search, mode: "insensitive" } },
				{ barcode: { contains: search, mode: "insensitive" } },
				{ barcodes: { some: { barcode: { contains: search, mode: "insensitive" } } } },
			];
		}

		const now = new Date();
		const products = await prisma.product.findMany({
			where,
			select: {
				uuid: true,
				name: true,
				sku: true,
				barcode: true,
				brand: { select: { name: true } },
				unitOfMeasure: { select: { name: true } },
				productPrices: {
					where: { priceTypeUuid: priceType.uuid, deletedAt: null, date: { lte: now } },
					orderBy: { date: "desc" },
					take: 1,
					select: { price: true, date: true },
				},
			},
			orderBy: { name: "asc" },
			take: 100000,
		});

		let items = products.map((p) => {
			const pp = p.productPrices[0] ?? null;
			return {
				productUuid: p.uuid,
				name: p.name,
				sku: p.sku ?? null,
				barcode: p.barcode ?? null,
				brandName: p.brand?.name ?? null,
				unitName: p.unitOfMeasure?.name ?? null,
				price: pp?.price != null ? Number(pp.price) : null,
				priceDate: pp?.date ?? null,
			};
		});
		if (onlyPriced) items = items.filter((i) => i.price != null);

		return res.status(200).json({ success: true, priceTypeUuid: priceType.uuid, priceTypeName: priceType.name, items });
	} catch (error) {
		console.error(`GET /${ROUTE}/price-list error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w, include: INCLUDE });
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
		const { productUuid, priceTypeUuid, date, price } = req.body;
		if (!productUuid)
			return res
				.status(400)
				.json({ success: false, message: "productUuid обязателен" });
		const item = await prisma[MODEL].create({
			data: {
				productUuid,
				priceTypeUuid: priceTypeUuid || null,
				date: toDate(date),
				price: num(price),
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
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
		if (req.body.priceTypeUuid !== undefined)
			data.priceTypeUuid = req.body.priceTypeUuid || null;
		if (req.body.date !== undefined) data.date = toDate(req.body.date);
		if (req.body.price !== undefined) data.price = num(req.body.price);
		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({
		req,
		res,
		prisma,
		modelName: MODEL,
	}),
);

// Серверное сопоставление номенклатуры по артикулам / штрих-кодам.
// Используется обработкой «Загрузка цен» вместо выгрузки всего каталога.
router.post(`/${ROUTE}/resolve-products`, async (req, res) => {
	try {
		const skus = Array.isArray(req.body?.skus)
			? req.body.skus.map((s) => String(s).trim()).filter(Boolean)
			: [];
		const barcodes = Array.isArray(req.body?.barcodes)
			? req.body.barcodes.map((b) => String(b).trim()).filter(Boolean)
			: [];
		const names = Array.isArray(req.body?.names)
			? req.body.names.map((n) => String(n).trim()).filter(Boolean)
			: [];
		if (skus.length === 0 && barcodes.length === 0 && names.length === 0) {
			return res.status(200).json({ success: true, items: [] });
		}
		const or = [];
		if (skus.length > 0) or.push({ sku: { in: skus } });
		if (barcodes.length > 0) or.push({ barcode: { in: barcodes } });
		// Дополнительные штрих-коды (таблица productBarcodes)
		if (barcodes.length > 0)
			or.push({ barcodes: { some: { barcode: { in: barcodes } } } });
		// Резервное сопоставление по наименованию (точное совпадение)
		if (names.length > 0) or.push({ name: { in: names } });

		const items = await prisma.product.findMany({
			where: { OR: or, ...tenantFilter(req) },
			select: {
				uuid: true,
				name: true,
				sku: true,
				barcode: true,
				barcodes: { select: { barcode: true } },
				brandUuid: true,
				brand: { select: { name: true } },
				unitOfMeasureUuid: true,
				unitOfMeasure: { select: { name: true } },
				isService: true,
			},
			take: 50000,
		});
		return res.status(200).json({ success: true, items });
	} catch (error) {
		console.error(`POST /${ROUTE}/resolve-products error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res
				.status(400)
				.json({ success: false, message: "operations обязателен" });
		const affected = new Set();
		const summary = {
			created: 0,
			updated: 0,
			deleted: 0,
			skipped: 0,
			errors: [],
		};
		await prisma.$transaction(async (tx) => {
			for (const [idx, op] of operations.entries()) {
				const { action, uuid, data } = op;
				try {
					if (action === "create" && data?.productUuid) {
						// Валидация: товар должен существовать
						const product = await tx.product.findUnique({
							where: { uuid: data.productUuid },
						});
						if (!product) {
							summary.errors.push({
								idx,
								action,
								message: `Product ${data.productUuid} not found`,
							});
							continue;
						}
						// Идемпотентность: пропустить если есть запись с той же датой (по дате без времени), типом цены и значением цены
						const d = toDate(data.date);
						const start = new Date(d);
						start.setHours(0, 0, 0, 0);
						const end = new Date(start);
						end.setDate(end.getDate() + 1);
						const whereCond = {
							productUuid: data.productUuid,
							date: { gte: start, lt: end },
							price: num(data.price),
						};
						if (data.priceTypeUuid)
							whereCond.priceTypeUuid = data.priceTypeUuid;
						else whereCond.priceTypeUuid = null;

						const exists = await tx[MODEL].findFirst({ where: whereCond });
						if (exists) {
							summary.skipped++;
							continue;
						}
						await tx[MODEL].create({
							data: {
								productUuid: data.productUuid,
								priceTypeUuid: data.priceTypeUuid || null,
								date: d,
								price: num(data.price),
							},
						});
						summary.created++;
						affected.add(data.productUuid);
					} else if (action === "update" && uuid && data) {
						const upd = {};
						if (data.priceTypeUuid !== undefined)
							upd.priceTypeUuid = data.priceTypeUuid || null;
						if (data.date !== undefined) upd.date = toDate(data.date);
						if (data.price !== undefined) upd.price = num(data.price);
						if (Object.keys(upd).length) {
							const row = await tx[MODEL].update({
								where: { uuid },
								data: upd,
							});
							summary.updated++;
							affected.add(row.productUuid);
						}
					} else if (action === "delete" && uuid) {
						try {
							const row = await tx[MODEL].delete({ where: { uuid } });
							summary.deleted++;
							affected.add(row.productUuid);
						} catch (e) {
							// ignore not found
						}
					} else {
						summary.errors.push({ idx, action, message: "Invalid operation" });
					}
				} catch (err) {
					console.error("batch operation error", err);
					summary.errors.push({
						idx,
						action,
						message: String(err?.message || err),
					});
				}
			}
		});
		return res.status(200).json({ success: true, summary });
	} catch (error) {
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
