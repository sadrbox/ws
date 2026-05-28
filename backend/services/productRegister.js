// ─────────────────────────────────────────────────────────────────────────────
// Регистр накопления «Товары» — сервис проведения.
//
// Движения товаров записываются в таблицу product_register ТОЛЬКО для
// проведённых документов (posted=true). Подход — полный пересбор по документу
// (reconcile): при любом изменении документа или его строк удаляем прежние
// движения этого документа и создаём заново из текущих строк, если документ
// проведён. Это делает операцию идемпотентной и устойчивой к гонкам.
//
// Источники движений:
//   purchase           → приход (+) на warehouseUuid
//   sale               → расход (−) с warehouseUuid
//   inventory_transfer → расход (−) с fromWarehouseUuid + приход (+) на toWarehouseUuid
//   sale_return        → приход (+) на warehouseUuid
//   purchase_return    → расход (−) с warehouseUuid
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

// Конфигурация документов-регистраторов.
const DOC_CONFIG = {
	purchase: {
		parentModel: "purchase",
		itemModel: "purchaseItem",
		parentField: "purchaseUuid",
		movements: [{ type: "in", warehouseField: "warehouseUuid" }],
	},
	sale: {
		parentModel: "sale",
		itemModel: "saleItem",
		parentField: "saleUuid",
		movements: [{ type: "out", warehouseField: "warehouseUuid" }],
	},
	inventory_transfer: {
		parentModel: "inventoryTransfer",
		itemModel: "inventoryTransferItem",
		parentField: "inventoryTransferUuid",
		movements: [
			{ type: "out", warehouseField: "fromWarehouseUuid" },
			{ type: "in", warehouseField: "toWarehouseUuid" },
		],
	},
	sale_return: {
		parentModel: "saleReturn",
		itemModel: "saleReturnItem",
		parentField: "saleReturnUuid",
		movements: [{ type: "in", warehouseField: "warehouseUuid" }],
	},
	purchase_return: {
		parentModel: "purchaseReturn",
		itemModel: "purchaseReturnItem",
		parentField: "purchaseReturnUuid",
		movements: [{ type: "out", warehouseField: "warehouseUuid" }],
	},
};

/** Список поддерживаемых типов документов-регистраторов. */
export const REGISTER_DOC_TYPES = Object.keys(DOC_CONFIG);

/** Маппинг prisma-модели документа → documentType (для фабрики позиций). */
export function documentTypeForParentModel(parentModel) {
	for (const [type, cfg] of Object.entries(DOC_CONFIG)) {
		if (cfg.parentModel === parentModel) return type;
	}
	return null;
}

/**
 * Полный пересбор движений регистра для одного документа.
 *
 * Удаляет существующие движения документа и, если документ проведён
 * (posted=true) и не удалён (deletedAt=null), создаёт новые из его строк.
 * Безопасно вызывать при каждом сохранении документа/строк.
 *
 * @param {string} documentType — purchase | sale | inventory_transfer | sale_return | purchase_return
 * @param {string} documentUuid — uuid документа
 * @param {object} [client]     — prisma client или transaction (по умолчанию prisma)
 */
export async function reconcileDocumentRegister(
	documentType,
	documentUuid,
	client = prisma,
) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	try {
		// 1. Удаляем прежние движения документа.
		await client.productRegister.deleteMany({
			where: { documentType, documentUuid },
		});

		// 2. Загружаем документ — движения только для проведённого и не удалённого.
		const doc = await client[cfg.parentModel].findUnique({
			where: { uuid: documentUuid },
		});
		if (!doc || doc.posted !== true || doc.deletedAt) return;

		// 3. Загружаем строки документа.
		const items = await client[cfg.itemModel].findMany({
			where: { [cfg.parentField]: documentUuid },
		});
		if (!items.length) return;

		// 4. Формируем движения (приход/расход) по каждой строке-товару.
		const records = [];
		for (const it of items) {
			if (!it.productUuid) continue; // движения только по товарам (не услугам)
			const qty = Number(it.quantity) || 0;
			const amt = Number(it.amount) || 0;
			if (qty === 0 && amt === 0) continue;
			for (const mv of cfg.movements) {
				records.push({
					date: doc.date ?? new Date(),
					movementType: mv.type,
					quantity: qty,
					amount: amt,
					productUuid: it.productUuid,
					warehouseUuid: doc[mv.warehouseField] ?? null,
					organizationUuid: doc.organizationUuid ?? null,
					unitOfMeasureUuid: it.unitOfMeasureUuid ?? null,
					documentType,
					documentUuid,
					documentId: doc.id ?? null,
					documentItemUuid: it.uuid ?? null,
				});
			}
		}
		if (records.length) {
			await client.productRegister.createMany({ data: records });
		}
	} catch (err) {
		console.error(
			`reconcileDocumentRegister(${documentType}, ${documentUuid}) error:`,
			err,
		);
	}
}

/**
 * Пересбор движений по prisma-модели документа (для фабрики позиций, которая
 * знает только PARENT_MODEL).
 */
export async function reconcileByParentModel(
	parentModel,
	documentUuid,
	client = prisma,
) {
	const type = documentTypeForParentModel(parentModel);
	if (!type) return;
	await reconcileDocumentRegister(type, documentUuid, client);
}

/** Удалить все движения документа (при удалении документа-регистратора). */
export async function removeDocumentRegister(
	documentType,
	documentUuid,
	client = prisma,
) {
	if (!DOC_CONFIG[documentType] || !documentUuid) return;
	try {
		await client.productRegister.deleteMany({
			where: { documentType, documentUuid },
		});
	} catch (err) {
		console.error(
			`removeDocumentRegister(${documentType}, ${documentUuid}) error:`,
			err,
		);
	}
}

export default {
	REGISTER_DOC_TYPES,
	documentTypeForParentModel,
	reconcileDocumentRegister,
	reconcileByParentModel,
	removeDocumentRegister,
};
