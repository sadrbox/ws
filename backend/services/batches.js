// ─────────────────────────────────────────────────────────────────────────────
// Партии и сроки годности (T6.1 Stage 2). Учёт по партиям — opt-in на товаре
// (Product.trackBatches).
//
// Приёмка задаёт партию (номер + срок годности); движение регистра «in» получает
// batchUuid. Выбытие списывает по FEFO (First-Expired-First-Out: раньше истекает —
// раньше выбывает); движение «out» ссылается на конкретную партию. Остаток партии
// на складе = Σ(in) − Σ(out) по batchUuid в product_register.
//
// Здесь: чистое FEFO-упорядочивание (тестируемо) + операции над БД.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/**
 * FEFO-порядок партий: раньше истекает — раньше выбывает. Партии без срока
 * годности (expiryDate=null) выбывают ПОСЛЕДНИМИ (нельзя ставить их раньше тех,
 * что скоро протухнут). Тай-брейк — номер партии для детерминизма. Чистая функция.
 *
 * @param {Array<{expiryDate?: Date|string|null, batchNumber?: string}>} batches
 * @returns {Array} тот же массив, отсортированный (новый массив)
 */
export function orderBatchesFEFO(batches) {
	const ts = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
	return [...batches].sort((a, b) => {
		const d = ts(a.expiryDate) - ts(b.expiryDate);
		if (d !== 0) return d;
		return String(a.batchNumber ?? "").localeCompare(String(b.batchNumber ?? ""), "ru");
	});
}

/** Найти или создать партию по (организация, товар, номер). */
export async function findOrCreateBatch({ productUuid, batchNumber, expiryDate = null, manufactureDate = null, organizationUuid = null }, client = prisma) {
	const num = String(batchNumber ?? "").trim();
	if (!productUuid || !num) return null;
	const existing = await client.productBatch.findFirst({
		where: { productUuid, batchNumber: num, organizationUuid, deletedAt: null },
	});
	if (existing) {
		// Обновляем срок годности, если он появился/изменился (приёмка уточняет).
		const patch = {};
		if (expiryDate && (!existing.expiryDate || new Date(expiryDate).getTime() !== new Date(existing.expiryDate).getTime())) patch.expiryDate = new Date(expiryDate);
		if (manufactureDate && !existing.manufactureDate) patch.manufactureDate = new Date(manufactureDate);
		if (Object.keys(patch).length) return client.productBatch.update({ where: { uuid: existing.uuid }, data: patch });
		return existing;
	}
	return client.productBatch.create({
		data: {
			batchNumber: num,
			expiryDate: expiryDate ? new Date(expiryDate) : null,
			manufactureDate: manufactureDate ? new Date(manufactureDate) : null,
			productUuid, organizationUuid,
		},
	});
}

/**
 * Остатки по партиям товара на складе (на дату включительно).
 * @returns {Promise<Map<string, number>>} batchUuid → остаток (только > 0)
 */
export async function warehouseBatchBalances({ organizationUuid = null, warehouseUuid, productUuid, dateUpTo = null }, client = prisma) {
	if (!warehouseUuid || !productUuid) return new Map();
	const rows = await client.productRegister.findMany({
		where: {
			productUuid, warehouseUuid,
			batchUuid: { not: null },
			...(organizationUuid ? { organizationUuid } : {}),
			...(dateUpTo ? { date: { lte: dateUpTo } } : {}),
		},
		select: { batchUuid: true, movementType: true, quantity: true },
	});
	const map = new Map();
	for (const r of rows) {
		const sign = r.movementType === "out" ? -1 : 1;
		map.set(r.batchUuid, (map.get(r.batchUuid) ?? 0) + sign * (Number(r.quantity) || 0));
	}
	for (const [k, v] of map) {
		const q = Math.round(v * 10000) / 10000;
		if (q > 0) map.set(k, q); else map.delete(k);
	}
	return map;
}

/**
 * Доступные партии товара на складе в порядке FEFO (для выбора при выбытии).
 * @returns {Promise<Array<{uuid, batchNumber, expiryDate, quantity}>>}
 */
export async function availableBatchesFEFO({ organizationUuid = null, warehouseUuid, productUuid, dateUpTo = null }, client = prisma) {
	const balances = await warehouseBatchBalances({ organizationUuid, warehouseUuid, productUuid, dateUpTo }, client);
	if (!balances.size) return [];
	const batches = await client.productBatch.findMany({
		where: { uuid: { in: [...balances.keys()] }, deletedAt: null },
		select: { uuid: true, batchNumber: true, expiryDate: true },
	});
	const withQty = batches.map((b) => ({ ...b, quantity: balances.get(b.uuid) ?? 0 }));
	return orderBatchesFEFO(withQty);
}

/**
 * Проверка выбытия по партиям: списываемое количество каждой партии не должно
 * превышать доступный остаток. Чистая функция.
 *
 * @param {Array<{batchNumber?:string, requested:number, available:number}>} lines
 * @returns {{ok:boolean, errors:string[]}}
 */
export function assertBatchStock(lines) {
	const errors = [];
	for (const l of lines) {
		const req = Number(l.requested) || 0;
		const avail = Number(l.available) || 0;
		if (req > avail + 1e-9) {
			errors.push(`партия «${l.batchNumber ?? "?"}»: списывается ${req}, доступно ${avail}`);
		}
	}
	return { ok: errors.length === 0, errors };
}

// Документы-приёмки и документы-выбытия для партий (те же, что для серий/склада).
export const BATCH_RECEIPT_DOCS = new Set(["purchase", "goods_receipt", "import_declaration"]);
export const BATCH_ISSUE_DOCS = new Set(["sale", "write_off"]);

/** Товары с учётом по партиям среди переданных. */
export async function batchTrackedProducts(productUuids, client = prisma) {
	const ids = [...new Set(productUuids.filter(Boolean))];
	if (!ids.length) return new Set();
	const rows = await client.product.findMany({ where: { uuid: { in: ids }, trackBatches: true }, select: { uuid: true } });
	return new Set(rows.map((r) => r.uuid));
}

/** Ошибка партионного контроля при проведении — роут вернёт 422. */
export class BatchValidationError extends Error {
	constructor(errors) {
		super(errors.join("; "));
		this.name = "BatchValidationError";
		this.errors = errors;
	}
}

/**
 * Проверка партий при ПРОВЕДЕНИИ. Для строк товаров с trackBatches:
 *   • партия должна быть назначена (batchUuid);
 *   • при ВЫБЫТИИ списываемое по партии ≤ доступного остатка (без движений
 *     самого документа — иначе повторное проведение вычитало бы свой же расход).
 * Бросает BatchValidationError при нарушении.
 */
export async function assertDocumentBatches({ docType, docUuid, itemModel, parentField, warehouseField = "warehouseUuid" }, client = prisma) {
	const mode = BATCH_ISSUE_DOCS.has(docType) ? "issue" : BATCH_RECEIPT_DOCS.has(docType) ? "receipt" : null;
	if (!mode) return;

	const parentModel = docParentModel(docType);
	const doc = (parentModel && (await client[parentModel].findUnique({ where: { uuid: docUuid } })))
		|| { organizationUuid: null, [warehouseField]: null };
	const items = await client[itemModel].findMany({
		where: { [parentField]: docUuid, ...(itemModel === "saleItem" ? { deletedAt: null } : {}) },
		select: { productUuid: true, quantity: true, batchUuid: true },
	});
	const tracked = await batchTrackedProducts(items.map((i) => i.productUuid), client);
	if (!tracked.size) return;

	const names = new Map(
		(await client.product.findMany({ where: { uuid: { in: [...tracked] } }, select: { uuid: true, name: true } }))
			.map((p) => [p.uuid, p.name]),
	);
	const errors = [];

	// Партия назначена у каждой трекаемой строки.
	const trackedLines = items.filter((it) => tracked.has(it.productUuid));
	for (const it of trackedLines) {
		if (!it.batchUuid) errors.push(`«${names.get(it.productUuid) ?? it.productUuid}»: не указана партия`);
	}
	if (errors.length) throw new BatchValidationError(errors);

	if (mode === "issue") {
		// Требуемое количество по партии.
		const reqByBatch = new Map();
		for (const it of trackedLines) reqByBatch.set(it.batchUuid, (reqByBatch.get(it.batchUuid) ?? 0) + (Number(it.quantity) || 0));

		const warehouseUuid = doc?.[warehouseField] ?? null;
		const organizationUuid = doc?.organizationUuid ?? null;
		const batchInfo = new Map(
			(await client.productBatch.findMany({ where: { uuid: { in: [...reqByBatch.keys()] } }, select: { uuid: true, batchNumber: true } }))
				.map((b) => [b.uuid, b.batchNumber]),
		);
		for (const [batchUuid, requested] of reqByBatch) {
			const available = await batchAvailableExcludingDoc({ batchUuid, warehouseUuid, organizationUuid, excludeDocumentUuid: docUuid }, client);
			if (requested > available + 1e-9) {
				errors.push(`партия «${batchInfo.get(batchUuid) ?? "?"}»: списывается ${requested}, доступно ${available}`);
			}
		}
	}
	if (errors.length) throw new BatchValidationError(errors);
}

/** Остаток партии на складе, БЕЗ движений указанного документа. */
async function batchAvailableExcludingDoc({ batchUuid, warehouseUuid, organizationUuid, excludeDocumentUuid }, client = prisma) {
	const rows = await client.productRegister.findMany({
		where: {
			batchUuid, warehouseUuid,
			...(organizationUuid ? { organizationUuid } : {}),
			...(excludeDocumentUuid ? { NOT: { documentUuid: excludeDocumentUuid } } : {}),
		},
		select: { movementType: true, quantity: true },
	});
	let bal = 0;
	for (const r of rows) bal += (r.movementType === "out" ? -1 : 1) * (Number(r.quantity) || 0);
	return Math.round(bal * 10000) / 10000;
}

/** docType → prisma-модель документа (для загрузки склада/организации). */
function docParentModel(docType) {
	return { goods_receipt: "goodsReceipt", write_off: "writeOff", purchase: "purchase", import_declaration: "importDeclaration", sale: "sale" }[docType];
}

/** Express-хелпер: BatchValidationError → 422. */
export function respondBatchError(err, res) {
	if (err instanceof BatchValidationError) {
		res.status(422).json({ success: false, message: `Партии: ${err.message}`, batchErrors: err.errors });
		return true;
	}
	return false;
}

export default {
	orderBatchesFEFO, findOrCreateBatch, warehouseBatchBalances, availableBatchesFEFO, assertBatchStock,
	batchTrackedProducts, assertDocumentBatches, respondBatchError, BatchValidationError,
	BATCH_RECEIPT_DOCS, BATCH_ISSUE_DOCS,
};
