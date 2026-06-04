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
import { reservedQuantity } from "./reservationRegister.js";

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

		// Услуги не двигают склад: набор uuid товаров-услуг (по флагу isService).
		const productUuids = [...new Set(items.map((it) => it.productUuid).filter(Boolean))];
		const serviceSet = new Set(
			productUuids.length
				? (await client.product.findMany({ where: { uuid: { in: productUuids }, isService: true }, select: { uuid: true } })).map((p) => p.uuid)
				: [],
		);

		// Плательщик НДС? Тогда себестоимость в регистре — БЕЗ НДС (НДС к зачёту).
		// Иначе — полная сумма (НДС в стоимости товара).
		const useVat = doc.organizationUuid
			? await client.organizationAccountingSetting
					.findFirst({
						where: { organizationUuid: doc.organizationUuid, deletedAt: null },
						orderBy: { startDate: "desc" },
						select: { useVat: true },
					})
					.then((s) => s?.useVat === true)
					.catch(() => false)
			: false;

		// 4. Формируем движения (приход/расход) по каждой строке-товару.
		const records = [];
		for (const it of items) {
			if (!it.productUuid) continue; // движения только по товарам (не услугам)
			if (serviceSet.has(it.productUuid)) continue; // услуга — склад не двигаем
			const qty = Number(it.quantity) || 0;
			const amt = Number(it.amount) || 0;
			// Стоимость товара для регистра: для плательщика НДС — БЕЗ НДС (входящий
			// НДС к зачёту, а не в себестоимость; согласовано со счётом 1330).
			// Иначе — полная сумма. Фолбэк на полную сумму, если нет налоговых полей.
			const net = Number(it.amountWithoutVat);
			const value = useVat && Number.isFinite(net) && net > 0 ? net : amt;
			if (qty === 0 && value === 0) continue;
			for (const mv of cfg.movements) {
				records.push({
					date: doc.date ?? new Date(),
					movementType: mv.type,
					quantity: qty,
					amount: value,
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

// ─────────────────────────────────────────────────────────────────────────────
// Контроль остатков перед проведением расходных документов.
//
// Расход не может превышать доступный остаток (Σприход − Σрасход) по паре
// товар+склад. Доступный остаток считается из product_register БЕЗ движений
// самого проверяемого документа (иначе повторное проведение/правка вычитали бы
// свой же расход). Проверяются только расходные движения (type==="out");
// приходные документы (purchase, sale_return) ограничений не имеют.
// ─────────────────────────────────────────────────────────────────────────────

/** Ошибка нехватки остатка. shortages — массив дефицитов по товар+склад. */
export class StockShortageError extends Error {
	constructor(shortages) {
		super(formatShortageMessage(shortages));
		this.name = "StockShortageError";
		this.shortages = Array.isArray(shortages) ? shortages : [];
	}
}

/** Человекочитаемое RU-сообщение о нехватке остатка. */
export function formatShortageMessage(shortages) {
	if (!shortages?.length) return "Недостаточно остатка для проведения";
	const lines = shortages.map(
		(s) =>
			`• ${s.productName || s.productUuid}` +
			`${s.warehouseName ? ` (${s.warehouseName})` : ""}: ` +
			`нужно ${s.requested}, доступно ${s.available} (не хватает ${s.deficit})`,
	);
	return `Недостаточно остатка для проведения:\n${lines.join("\n")}`;
}

/** Текущий остаток по товар+склад из регистра, исключая движения excludeDocumentUuid. */
async function balanceFor(productUuid, warehouseUuid, excludeDocumentUuid, client) {
	const rows = await client.productRegister.findMany({
		where: {
			productUuid,
			warehouseUuid,
			...(excludeDocumentUuid
				? { NOT: { documentUuid: excludeDocumentUuid } }
				: {}),
		},
		select: { movementType: true, quantity: true },
	});
	let bal = 0;
	for (const r of rows)
		bal += (r.movementType === "out" ? -1 : 1) * (Number(r.quantity) || 0);
	return Math.round(bal * 10000) / 10000;
}

/** Суммирует требуемый расход по паре товар+склад из строк документа. */
function aggregateRequested(items, outMovements, doc) {
	const map = new Map();
	for (const it of items) {
		if (!it.productUuid) continue; // движения только по товарам (не услугам)
		const qty = Number(it.quantity) || 0;
		if (qty <= 0) continue;
		for (const mv of outMovements) {
			const wh = doc?.[mv.warehouseField] ?? null;
			const key = `${it.productUuid}|${wh ?? ""}`;
			const acc = map.get(key) ?? {
				productUuid: it.productUuid,
				warehouseUuid: wh,
				requested: 0,
			};
			acc.requested += qty;
			map.set(key, acc);
		}
	}
	return map;
}

/**
 * Считает дефициты остатка для расходного документа.
 *
 * @param {object} args
 * @param {string} args.documentType — тип документа-регистратора
 * @param {string} [args.documentUuid] — uuid документа (исключается из остатка)
 * @param {object} [args.doc] — объект со складскими полями (warehouseUuid / fromWarehouseUuid)
 * @param {Array}  args.items — строки документа [{ productUuid, quantity }]
 * @returns {Promise<Array>} массив дефицитов (пустой — если всё в порядке)
 */
export async function computeShortages(
	{ documentType, documentUuid, doc, items },
	client = prisma,
) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg) return [];
	const outMovements = cfg.movements.filter((m) => m.type === "out");
	if (!outMovements.length) return []; // приходный документ — без проверки

	const requestedMap = aggregateRequested(items ?? [], outMovements, doc ?? {});
	if (!requestedMap.size) return [];

	// Жёсткий резерв: из доступного вычитаются активные резервы. Резерв-основание
	// самой реализации исключается — он закрывается этой же реализацией.
	const excludeReservationUuid =
		doc?.basisDocumentType === "reservation" ? doc?.basisDocumentUuid ?? null : null;

	const shortages = [];
	for (const acc of requestedMap.values()) {
		const stock = await balanceFor(
			acc.productUuid,
			acc.warehouseUuid,
			documentUuid,
			client,
		);
		const reserved = await reservedQuantity(
			acc.productUuid,
			acc.warehouseUuid,
			excludeReservationUuid,
			client,
		);
		const available = Math.round((stock - reserved) * 10000) / 10000;
		const requested = Math.round(acc.requested * 10000) / 10000;
		if (requested > available + 1e-9) {
			const [product, warehouse] = await Promise.all([
				client.product.findUnique({
					where: { uuid: acc.productUuid },
					select: { name: true, sku: true },
				}),
				acc.warehouseUuid
					? client.warehouse.findUnique({
							where: { uuid: acc.warehouseUuid },
							select: { name: true },
						})
					: null,
			]);
			shortages.push({
				productUuid: acc.productUuid,
				productName: product?.name ?? "",
				sku: product?.sku ?? "",
				warehouseUuid: acc.warehouseUuid,
				warehouseName: warehouse?.name ?? "",
				requested,
				available,
				deficit: Math.round((requested - available) * 10000) / 10000,
			});
		}
	}
	return shortages;
}

/**
 * Бэкенд-гард: бросает StockShortageError, если проведённый расходный документ
 * уводит остаток в минус. Грузит документ и его строки из БД (финальное
 * состояние). Безопасно вызывать только перед/вместе с reconcile.
 */
export async function assertStockAvailable(
	documentType,
	documentUuid,
	client = prisma,
) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	if (!cfg.movements.some((m) => m.type === "out")) return; // приходный — пропуск

	const doc = await client[cfg.parentModel].findUnique({
		where: { uuid: documentUuid },
	});
	if (!doc || doc.posted !== true || doc.deletedAt) return; // контроль только при проведении

	const items = await client[cfg.itemModel].findMany({
		where: { [cfg.parentField]: documentUuid },
	});
	const shortages = await computeShortages(
		{ documentType, documentUuid, doc, items },
		client,
	);
	if (shortages.length) throw new StockShortageError(shortages);
}

/**
 * Бэкенд-гард для парент-роутера ПЕРЕД записью проведения. В отличие от
 * assertStockAvailable не читает posted из БД (вызывающий уже решил, что
 * документ будет проведён) и принимает «прогнозируемый» документ с актуальными
 * складскими полями из payload. Строки берутся из БД (на момент PUT они ещё не
 * перезаписаны). Бросает StockShortageError при дефиците — до самого update,
 * поэтому проведение не фиксируется в БД.
 */
export async function assertStockForPosting(
	documentType,
	documentUuid,
	prospectiveDoc,
	client = prisma,
) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	if (!cfg.movements.some((m) => m.type === "out")) return; // приходный — пропуск

	const allItems = await client[cfg.itemModel].findMany({
		where: { [cfg.parentField]: documentUuid },
	});
	// Услуги не списываются со склада — исключаем из проверки остатка.
	const productUuids = [...new Set(allItems.map((it) => it.productUuid).filter(Boolean))];
	const serviceSet = new Set(
		productUuids.length
			? (await client.product.findMany({ where: { uuid: { in: productUuids }, isService: true }, select: { uuid: true } })).map((p) => p.uuid)
			: [],
	);
	const items = allItems.filter((it) => !serviceSet.has(it.productUuid));
	const shortages = await computeShortages(
		{ documentType, documentUuid, doc: prospectiveDoc, items },
		client,
	);
	if (shortages.length) throw new StockShortageError(shortages);
}

/** Маппинг StockShortageError → HTTP 409. Возвращает true, если ответ отправлен. */
export function respondStockError(err, res) {
	if (err instanceof StockShortageError) {
		res
			.status(409)
			.json({ success: false, message: err.message, shortages: err.shortages });
		return true;
	}
	return false;
}

export default {
	REGISTER_DOC_TYPES,
	documentTypeForParentModel,
	reconcileDocumentRegister,
	reconcileByParentModel,
	removeDocumentRegister,
	StockShortageError,
	formatShortageMessage,
	computeShortages,
	assertStockAvailable,
	assertStockForPosting,
	respondStockError,
};
