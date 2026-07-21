// ─────────────────────────────────────────────────────────────────────────────
// Серийные номера (T6.1). Учёт по сериям — opt-in на товаре
// (Product.trackSerialNumbers).
//
// Жизненный цикл серии:
//   приёмка (purchase/goods_receipt) → создаётся строка status=in_stock,
//     привязанная к документу приёмки (receiptDoc*) и складу;
//   выбытие (sale/write_off)         → существующая in_stock-серия помечается
//     issued/written_off, привязывается к документу выбытия (issueDoc*).
//
// Серии вводит/выбирает пользователь на строке документа; здесь — чистая
// нормализация ввода + идемпотентные операции над БД. Инвариант проведения:
// число серий строки == её количеству (assertSerialCount).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

export const SERIAL_STATUS = { IN_STOCK: "in_stock", ISSUED: "issued", WRITTEN_OFF: "written_off" };

// Документы-приёмники и документы-выбытия для серий (те же, что двигают склад «+»/«−»).
export const SERIAL_RECEIPT_DOCS = new Set(["purchase", "goods_receipt", "import_declaration"]);
export const SERIAL_ISSUE_DOCS = new Set(["sale", "write_off"]);
// Перемещение (T6.1 Stage 3): серия НЕ выбывает — меняется её склад (warehouseUuid)
// с источника на получатель, статус остаётся in_stock. Связь перемещения с сериями
// пишем в issueDoc* (issueDocType="inventory_transfer") — отдельных колонок не
// заводим; статус in_stock отличает «перемещённую» серию от реально выбывшей.
export const SERIAL_TRANSFER_DOCS = new Set(["inventory_transfer"]);

/**
 * Нормализовать ввод серий: строка (по одной на строку/через запятую/пробел) или
 * массив → массив уникальных непустых серий, порядок сохраняется. Чистая функция.
 */
export function normalizeSerials(raw) {
	let parts;
	if (Array.isArray(raw)) parts = raw;
	else if (typeof raw === "string") parts = raw.split(/[\n,;]+/);
	else return [];
	const seen = new Set();
	const out = [];
	for (const p of parts) {
		const s = String(p ?? "").trim();
		if (!s || seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

/**
 * Проверка инварианта проведения: для каждой строки товара с учётом по сериям
 * число привязанных серий должно совпадать с количеством. Чистая функция.
 *
 * @param {Array<{productName?:string, quantity:number, serialCount:number, tracked:boolean}>} lines
 * @returns {{ok:boolean, errors:string[]}}
 */
export function assertSerialCount(lines) {
	const errors = [];
	for (const l of lines) {
		if (!l.tracked) continue;
		const qty = Math.round((Number(l.quantity) || 0) * 10000) / 10000;
		const cnt = Number(l.serialCount) || 0;
		// Серии — штучный учёт: количество должно быть целым и равным числу серий.
		if (!Number.isInteger(qty) || qty !== cnt) {
			errors.push(`«${l.productName ?? "товар"}»: количество ${qty}, серий ${cnt} — должны совпадать (целое число)`);
		}
	}
	return { ok: errors.length === 0, errors };
}

/** Множество uuid товаров с учётом по сериям среди переданных. */
export async function serialTrackedProducts(productUuids, client = prisma, docDate = null) {
	const ids = [...new Set(productUuids.filter(Boolean))];
	if (!ids.length) return new Set();
	const rows = await client.product.findMany({
		where: { uuid: { in: ids }, trackSerialNumbers: true },
		select: { uuid: true, serialTrackingSince: true },
	});
	// Учёт НЕ применяется задним числом: документ старше момента включения флага
	// контролю не подлежит (в нём серий нет — иначе он перестал бы сохраняться).
	// docDate=null → контролируем (не смогли определить дату — берём строгий путь).
	const d = docDate ? new Date(docDate) : null;
	return new Set(
		rows
			.filter((r) => !d || !r.serialTrackingSince || d >= r.serialTrackingSince)
			.map((r) => r.uuid),
	);
}

/**
 * Идемпотентно установить серии, ПРИНЯТЫЕ документом приёмки по товару.
 * Полный пересбор: серии, отсутствующие в новом списке, удаляются; новые
 * создаются как in_stock. Серии, уже выбывшие (issued) по другому документу,
 * не трогаем — вернём как конфликт.
 *
 * @returns {Promise<{created:number, removed:number, conflicts:string[]}>}
 */
export async function setReceiptSerials(
	{ docType, docUuid, productUuid, warehouseUuid = null, organizationUuid = null, serials },
	client = prisma,
) {
	const list = normalizeSerials(serials);
	const conflicts = [];

	// Серия не должна принадлежать другому товару/уже быть выбывшей у чужого документа.
	if (list.length) {
		const clash = await client.serialNumber.findMany({
			where: {
				organizationUuid,
				productUuid,
				serialNumber: { in: list },
				deletedAt: null,
				NOT: { receiptDocUuid: docUuid },
			},
			select: { serialNumber: true },
		});
		for (const c of clash) conflicts.push(c.serialNumber);
	}
	const allowed = list.filter((s) => !conflicts.includes(s));

	const existing = await client.serialNumber.findMany({
		where: { productUuid, receiptDocType: docType, receiptDocUuid: docUuid, deletedAt: null },
	});
	const existingByNum = new Map(existing.map((e) => [e.serialNumber, e]));
	const wanted = new Set(allowed);

	// Удаляем те, что убрали из списка (только если ещё не выбыли).
	let removed = 0;
	for (const e of existing) {
		if (!wanted.has(e.serialNumber)) {
			if (e.status === SERIAL_STATUS.IN_STOCK) {
				await client.serialNumber.delete({ where: { uuid: e.uuid } });
				removed++;
			}
		}
	}
	// Создаём новые.
	let created = 0;
	for (const s of allowed) {
		if (existingByNum.has(s)) continue;
		await client.serialNumber.create({
			data: {
				serialNumber: s, status: SERIAL_STATUS.IN_STOCK, productUuid,
				warehouseUuid, organizationUuid, receiptDocType: docType, receiptDocUuid: docUuid,
			},
		});
		created++;
	}
	return { created, removed, conflicts };
}

/** Число серий, принятых документом по товару (для проверки инварианта). */
export async function countReceiptSerials(docType, docUuid, client = prisma) {
	const rows = await client.serialNumber.groupBy({
		by: ["productUuid"],
		where: { receiptDocType: docType, receiptDocUuid: docUuid, deletedAt: null },
		_count: { _all: true },
	});
	return new Map(rows.map((r) => [r.productUuid, r._count._all]));
}

/**
 * Пометить серии выбывшими по документу выбытия. serialUuids — выбранные
 * пользователем in_stock-серии. Возвращает число помеченных.
 */
export async function issueSerials({ docType, docUuid, serialUuids, status = SERIAL_STATUS.ISSUED }, client = prisma) {
	const ids = [...new Set((serialUuids ?? []).filter(Boolean))];
	if (!ids.length) return 0;
	const res = await client.serialNumber.updateMany({
		where: { uuid: { in: ids }, status: SERIAL_STATUS.IN_STOCK, deletedAt: null },
		data: { status, issueDocType: docType, issueDocUuid: docUuid },
	});
	return res.count;
}

/**
 * Перемещение серий между складами (T6.1 Stage 3). Идемпотентный пересбор:
 * сначала все ранее перемещённые ЭТИМ документом серии возвращаем на источник,
 * затем выбранные in_stock-серии переносим на получатель. Серия остаётся in_stock
 * (не выбывает) — меняется только склад; связь пишем в issueDoc*.
 *
 * @returns {Promise<number>} число перемещённых серий
 */
export async function transferSerials({ docUuid, serialUuids, fromWarehouseUuid, toWarehouseUuid }, client = prisma) {
	// 1. Откат прежнего выбора этого перемещения на источник (полный пересбор).
	await client.serialNumber.updateMany({
		where: { issueDocType: "inventory_transfer", issueDocUuid: docUuid, status: SERIAL_STATUS.IN_STOCK, deletedAt: null },
		data: { warehouseUuid: fromWarehouseUuid ?? null, issueDocType: null, issueDocUuid: null },
	});
	// 2. Перенос выбранных серий на получатель. Двигаем только in_stock и реально
	// лежащие на складе-источнике — чужие/уже перемещённые не трогаем.
	const ids = [...new Set((serialUuids ?? []).filter(Boolean))];
	if (!ids.length) return 0;
	const res = await client.serialNumber.updateMany({
		where: {
			uuid: { in: ids }, status: SERIAL_STATUS.IN_STOCK, deletedAt: null,
			...(fromWarehouseUuid ? { warehouseUuid: fromWarehouseUuid } : {}),
		},
		data: { warehouseUuid: toWarehouseUuid ?? null, issueDocType: "inventory_transfer", issueDocUuid: docUuid },
	});
	return res.count;
}

/** Откат перемещения документа: серии возвращаются на склад-источник (при удалении). */
export async function releaseTransferSerials(docUuid, fromWarehouseUuid, client = prisma) {
	const res = await client.serialNumber.updateMany({
		where: { issueDocType: "inventory_transfer", issueDocUuid: docUuid, status: SERIAL_STATUS.IN_STOCK, deletedAt: null },
		data: { warehouseUuid: fromWarehouseUuid ?? null, issueDocType: null, issueDocUuid: null },
	});
	return res.count;
}

/** Откат выбытия документа: серии возвращаются в in_stock (при отмене/удалении). */
export async function releaseIssuedSerials(docType, docUuid, client = prisma) {
	const res = await client.serialNumber.updateMany({
		where: { issueDocType: docType, issueDocUuid: docUuid, deletedAt: null },
		data: { status: SERIAL_STATUS.IN_STOCK, issueDocType: null, issueDocUuid: null },
	});
	return res.count;
}

/** Удаление приёмки документа: принятые им серии удаляются (только in_stock). */
export async function removeReceiptSerials(docType, docUuid, client = prisma) {
	const res = await client.serialNumber.deleteMany({
		where: { receiptDocType: docType, receiptDocUuid: docUuid, status: SERIAL_STATUS.IN_STOCK, deletedAt: null },
	});
	return res.count;
}

/** Ошибка инварианта серий (число серий != количеству) — роут вернёт 422. */
export class SerialCountError extends Error {
	constructor(errors) {
		super(errors.join("; "));
		this.name = "SerialCountError";
		this.errors = errors;
	}
}

/**
 * Проверка инварианта серий при ПРОВЕДЕНИИ документа. Для каждого товара строки
 * с trackSerialNumbers число привязанных серий (приёмки/выбытия) должно совпадать
 * с суммарным количеством по товару. Бросает SerialCountError при расхождении.
 *
 * @param {object} p
 * @param {string} p.docType @param {string} p.docUuid
 * @param {string} p.itemModel  — prisma-модель строк (writeOffItem, saleItem, …)
 * @param {string} p.parentField — FK-поле строки на документ (writeOffUuid, …)
 */
export async function assertDocumentSerials({ docType, docUuid, itemModel, parentField, docDate = null }, client = prisma) {
	// Перемещение считаем как выбытие (число перенесённых серий = количеству),
	// связь — в issueDoc* (см. transferSerials).
	const mode = SERIAL_ISSUE_DOCS.has(docType) || SERIAL_TRANSFER_DOCS.has(docType)
		? "issue"
		: SERIAL_RECEIPT_DOCS.has(docType) ? "receipt" : null;
	if (!mode) return; // документ не относится к серийному учёту

	// Дата документа нужна, чтобы НЕ применять серийный учёт задним числом
	// (см. serialTrackedProducts). Вызывающий может передать сохраняемую дату;
	// иначе берём текущую из БД (parentField "purchaseUuid" → модель "purchase").
	let date = docDate;
	if (!date) {
		const parentModel = String(parentField).replace(/Uuid$/, "");
		const doc = client[parentModel]
			? await client[parentModel].findUnique({ where: { uuid: docUuid }, select: { date: true } })
			: null;
		date = doc?.date ?? null;
	}

	const items = await client[itemModel].findMany({
		where: { [parentField]: docUuid, ...(itemModel === "saleItem" ? { deletedAt: null } : {}) },
		select: { productUuid: true, quantity: true },
	});
	const productUuids = items.map((i) => i.productUuid).filter(Boolean);
	const tracked = await serialTrackedProducts(productUuids, client, date);
	if (!tracked.size) return;

	// Суммарное количество по товару (несколько строк одного товара складываются).
	const qtyByProduct = new Map();
	for (const it of items) {
		if (!tracked.has(it.productUuid)) continue;
		qtyByProduct.set(it.productUuid, (qtyByProduct.get(it.productUuid) ?? 0) + (Number(it.quantity) || 0));
	}

	// Число привязанных серий по товару.
	const serialWhere = mode === "receipt"
		? { receiptDocType: docType, receiptDocUuid: docUuid, deletedAt: null }
		: { issueDocType: docType, issueDocUuid: docUuid, deletedAt: null };
	const grouped = await client.serialNumber.groupBy({
		by: ["productUuid"],
		where: { ...serialWhere, productUuid: { in: [...qtyByProduct.keys()] } },
		_count: { _all: true },
	});
	const serialByProduct = new Map(grouped.map((g) => [g.productUuid, g._count._all]));

	// Имена товаров для сообщения.
	const names = new Map(
		(await client.product.findMany({ where: { uuid: { in: [...qtyByProduct.keys()] } }, select: { uuid: true, name: true } }))
			.map((p) => [p.uuid, p.name]),
	);

	const lines = [...qtyByProduct.entries()].map(([uuid, quantity]) => ({
		productName: names.get(uuid) ?? uuid,
		quantity,
		serialCount: serialByProduct.get(uuid) ?? 0,
		tracked: true,
	}));
	const { ok, errors } = assertSerialCount(lines);
	if (!ok) throw new SerialCountError(errors);
}

/** Express-хелпер: SerialCountError → 422. Возвращает true, если ответ отправлен. */
export function respondSerialError(err, res) {
	if (err instanceof SerialCountError) {
		res.status(422).json({ success: false, message: `Серийные номера: ${err.message}`, serialErrors: err.errors });
		return true;
	}
	return false;
}

export default {
	SERIAL_STATUS, SERIAL_RECEIPT_DOCS, SERIAL_ISSUE_DOCS, SERIAL_TRANSFER_DOCS,
	normalizeSerials, assertSerialCount, serialTrackedProducts,
	setReceiptSerials, countReceiptSerials, issueSerials, releaseIssuedSerials, removeReceiptSerials,
	transferSerials, releaseTransferSerials,
	assertDocumentSerials, respondSerialError, SerialCountError,
};
