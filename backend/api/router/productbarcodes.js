// Штрих-коды номенклатуры (один товар — много штрих-кодов).
// Sub-таблица товара: GET (по productUuid) / POST / PUT / DELETE / batch.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildOrderBy } from "../../utils/sortOrder.js";
import { handleDelete, handleBatchDelete } from "../../utils/checkReferences.js";
import { findBarcodeOwner } from "../../utils/barcodeUniqueness.js";

const router = express.Router();

const MODEL = "productBarcode";
const ROUTE = "productbarcodes";

// ── GET list (по productUuid) ───────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const { productUuid } = req.query;
		if (!productUuid)
			return res.status(400).json({ success: false, message: "Параметр productUuid обязателен" });

		// Сортировка валидируется по схеме — неизвестные поля не улетают в Prisma.
		const orderBy = buildOrderBy(MODEL, req.query.sort);

		const items = await prisma[MODEL].findMany({
			where: { productUuid: String(productUuid) },
			orderBy,
		});
		// «Основной» штрихкод — это НЕ флаг строки, а скаляр Product.barcode
		// (на нём partial-unique индекс и по нему товар подбирается в документах).
		// Поэтому isPrimary ВЫЧИСЛЯЕМЫЙ: строка основная, если её код совпадает с
		// Product.barcode. Так кнопка «Сделать основным» переиспользуется как есть
		// (PrimaryToolbarButton ждёт row.isPrimary), а второго источника истины нет.
		const product = await prisma.product.findUnique({
			where: { uuid: String(productUuid) },
			select: { barcode: true },
		});
		const main = product?.barcode ?? null;
		const withPrimary = items.map((it) => ({ ...it, isPrimary: !!main && it.barcode === main }));
		// Основной — первым (как основной контакт в контрагенте).
		withPrimary.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
		return res.status(200).json({ success: true, items: withPrimary, total: withPrimary.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ────────────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item) return res.status(404).json({ success: false, message: "Не найдено" });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ─────────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const { productUuid, barcode, comment } = req.body;
		if (!productUuid)
			return res.status(400).json({ success: false, message: "productUuid обязателен" });
		const bc = (barcode ?? "").trim();
		if (!bc)
			return res.status(400).json({ success: false, message: "Штрих-код обязателен и не может быть пустым" });
		const owner = await findBarcodeOwner(bc, productUuid);
		if (owner)
			return res.status(409).json({ success: false, message: `Штрих-код «${bc}» уже используется другим товаром` });
		const item = await prisma[MODEL].create({
			data: {
				productUuid,
				barcode: bc,
				comment: comment?.trim() || null,
			},
		});
		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ──────────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const data = {};
		if (req.body.barcode !== undefined) {
			const bc = (req.body.barcode ?? "").trim();
			if (!bc)
				return res.status(400).json({ success: false, message: "Штрих-код не может быть пустым" });
			data.barcode = bc;
		}
		if (req.body.comment !== undefined) data.comment = req.body.comment?.trim() || null;

		// ── «Сделать основным» / «Убрать основным» ────────────────────────────
		// Основной штрихкод хранится в Product.barcode, поэтому меняем ТОВАР, а не
		// строку. Прежний основной не теряем: если его нет среди строк — заводим,
		// иначе он бы просто исчез из карточки.
		if (req.body.isPrimary !== undefined) {
			const row = await prisma[MODEL].findUnique({ where: w, select: { barcode: true, productUuid: true } });
			if (!row) return res.status(404).json({ success: false, message: "Не найдено" });

			if (req.body.isPrimary === true) {
				const owner = await findBarcodeOwner(row.barcode, row.productUuid);
				if (owner) {
					return res.status(409).json({
						success: false,
						message: `Штрих-код «${row.barcode}» уже используется другим товаром`,
					});
				}
				const product = await prisma.product.findUnique({
					where: { uuid: row.productUuid },
					select: { barcode: true },
				});
				const prevMain = product?.barcode ?? null;
				await prisma.$transaction(async (tx) => {
					if (prevMain && prevMain !== row.barcode) {
						const kept = await tx[MODEL].findFirst({
							where: { productUuid: row.productUuid, barcode: prevMain, deletedAt: null },
							select: { uuid: true },
						});
						if (!kept) {
							await tx[MODEL].create({ data: { productUuid: row.productUuid, barcode: prevMain } });
						}
					}
					await tx.product.update({ where: { uuid: row.productUuid }, data: { barcode: row.barcode } });
				});
			} else if (req.body.isPrimary === false) {
				// Снятие основного: у товара просто не остаётся основного штрихкода,
				// сама строка при этом сохраняется.
				await prisma.product.updateMany({
					where: { uuid: row.productUuid, barcode: row.barcode },
					data: { barcode: null },
				});
			}
			const item = await prisma[MODEL].findUnique({ where: w });
			const product = await prisma.product.findUnique({ where: { uuid: row.productUuid }, select: { barcode: true } });
			return res.status(200).json({
				success: true,
				item: { ...item, isPrimary: !!product?.barcode && item.barcode === product.barcode },
			});
		}

		if (data.barcode) {
			const existing = await prisma[MODEL].findUnique({ where: w, select: { productUuid: true } });
			const owner = await findBarcodeOwner(data.barcode, existing?.productUuid ?? null);
			if (owner)
				return res.status(409).json({ success: false, message: `Штрих-код «${data.barcode}» уже используется другим товаром` });
		}
		const item = await prisma[MODEL].update({ where: w, data });
		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ─────────────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, (req, res) =>
	handleDelete({ req, res, prisma, modelName: MODEL }),
);

// ── POST /batch ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });
		await prisma.$transaction(async (tx) => {
			for (const { action, uuid, data } of operations) {
				if (action === "create" && data?.productUuid) {
					const bc = (data.barcode ?? "").trim();
					if (!bc) {
						const e = new Error("Штрих-код обязателен и не может быть пустым");
						e.code = "BARCODE_INVALID";
						throw e;
					}
					const owner = await findBarcodeOwner(bc, data.productUuid, tx);
					if (owner) {
						const e = new Error(`Штрих-код «${bc}» уже используется другим товаром`);
						e.code = "BARCODE_DUPLICATE";
						throw e;
					}
					await tx[MODEL].create({
						data: {
							productUuid: data.productUuid,
							barcode: bc,
							comment: data.comment?.trim() || null,
						},
					});
				} else if (action === "update" && uuid && data) {
					const updateData = {};
					if (data.barcode !== undefined) {
						const bc = (data.barcode ?? "").trim();
						if (!bc) {
							const e = new Error("Штрих-код не может быть пустым");
							e.code = "BARCODE_INVALID";
							throw e;
						}
						updateData.barcode = bc;
					}
					if (data.comment !== undefined) updateData.comment = data.comment?.trim() || null;
					if (updateData.barcode) {
						const cur = await tx[MODEL].findUnique({ where: { uuid }, select: { productUuid: true } });
						const owner = await findBarcodeOwner(updateData.barcode, cur?.productUuid ?? null, tx);
						if (owner) {
							const e = new Error(`Штрих-код «${updateData.barcode}» уже используется другим товаром`);
							e.code = "BARCODE_DUPLICATE";
							throw e;
						}
					}
					if (Object.keys(updateData).length > 0)
						await tx[MODEL].update({ where: { uuid }, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx[MODEL].delete({ where: { uuid } }); } catch {}
				}
			}
		});
		return res.status(200).json({ success: true });
	} catch (error) {
		if (error?.code === "BARCODE_INVALID")
			return res.status(400).json({ success: false, message: error.message });
		if (error?.code === "BARCODE_DUPLICATE")
			return res.status(409).json({ success: false, message: error.message });
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

router.post(`/${ROUTE}/batch-delete`, (req, res) =>
	handleBatchDelete({ req, res, prisma, modelName: MODEL }),
);

export default router;
