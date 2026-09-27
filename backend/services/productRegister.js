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
import { reservedQuantities } from "./reservationRegister.js";
import { createCostingContext, resolveStockControl, resolveUseVat } from "./accountingPosting.js";
import { allocateImportLandedCost } from "./importLandedCost.js";
import { getClosedBoundary } from "./periodLock.js";
import { inDocumentTransaction, lockStockPairs } from "./documentLock.js";
import { compareMovements } from "./costingReplay.js";
import { r2, r4 } from "./money.js";

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
	import_declaration: {
		parentModel: "importDeclaration",
		itemModel: "importDeclarationItem",
		parentField: "importDeclarationUuid",
		movements: [{ type: "in", warehouseField: "warehouseUuid" }],
	},
	write_off: {
		parentModel: "writeOff",
		itemModel: "writeOffItem",
		parentField: "writeOffUuid",
		movements: [{ type: "out", warehouseField: "warehouseUuid" }],
	},
	goods_receipt: {
		parentModel: "goodsReceipt",
		itemModel: "goodsReceiptItem",
		parentField: "goodsReceiptUuid",
		movements: [{ type: "in", warehouseField: "warehouseUuid" }],
	},
};

/** Список поддерживаемых типов документов-регистраторов. */
export const REGISTER_DOC_TYPES = Object.keys(DOC_CONFIG);

/** Даёт ли документ ПРИХОД на склад (его снятие/удаление может увести остаток в минус). */
export function documentHasInflow(documentType) {
	return !!DOC_CONFIG[documentType]?.movements.some((m) => m.type === "in");
}

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
 * Атомарно (У2 аудита 26.09): удаление прежних движений и запись новых — в одной
 * транзакции под блокировкой документа; передан tx — работаем в нём. Ошибка не
 * глушится: транзакция откатывается (прежние движения остаются), исключение уходит
 * вызывающему, и роутер отвечает ошибкой, а не «успехом» с документом без движений.
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
	await inDocumentTransaction(client, documentType, documentUuid, (tx) => rebuildRegister(documentType, documentUuid, cfg, tx));
}

async function rebuildRegister(documentType, documentUuid, cfg, client) {
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
	// Иначе — полная сумма (НДС в стоимости товара). Признак — НА ДАТУ ДОКУМЕНТА, как
	// в проводках (У8 аудита 26.09): раньше бралась последняя версия настроек, и после
	// смены статуса плательщика стоимость в регистре расходилась со счётом 1330.
	const useVat = await resolveUseVat(doc.organizationUuid ?? null, doc.date ?? null, client);

	// Дата для оценки себестоимости возврата от покупателя: на момент ИСХОДНОЙ
	// продажи (документ-основание), а не возврата. Иначе при исчерпании проданной
	// партии возврат переоценится по чужому (старейшему оставшемуся) слою и
	// исказит стоимость. Фолбэк на дату возврата, если основания-продажи нет.
	let saleReturnCostDate = doc.date ?? new Date();
	if (documentType === "sale_return" && doc.basisDocumentType === "sale" && doc.basisDocumentUuid) {
		const basisSale = await client.sale.findUnique({
			where: { uuid: doc.basisDocumentUuid },
			select: { date: true },
		});
		if (basisSale?.date) saleReturnCostDate = basisSale.date;
	}

	// ГТД по импорту: стоимость прихода = landed cost (таможенная стоимость +
	// капитализированные пошлина/сбор/акциз [+ импортный НДС для неплательщика]).
	const landedMap =
		documentType === "import_declaration"
			? allocateImportLandedCost(doc, items, useVat)
			: null;

	// Контексты себестоимости — ОДИН на документ, чтобы строки последовательно
	// потребляли ФИФО-слои. Иначе две строки одного товара оценивались бы по
	// одним и тем же старейшим партиям (при AVERAGE разницы нет).
	//
	// docCtx — для оценки на дату САМОГО документа (списание, перемещение):
	//   исключает собственные расходы и упорядочивает расходы той же даты по id.
	// pastCtx — для оценки на ПРОШЛУЮ дату (возврат от покупателя оценивается на
	//   дату исходной продажи). docUuid/docId здесь не передаём намеренно: иначе
	//   расходы самой продажи попали бы в «уже потреблённое» и вернулись бы слои,
	//   лежащие ЗА проданными.
	// Граница закрытого периода: если дата документа СТРОГО позже границы, docCtx
	// стартует оценку от снапшота на границе (материализация ФИФО-слоёв), а не от
	// начала истории. pastCtx (возврат покупателя, оценка на прошлую дату) снапшот
	// НЕ использует — его cutoff может быть ≤ границы.
	const docDate = doc.date ? new Date(doc.date) : null;
	const closedBoundary = await getClosedBoundary(doc.organizationUuid ?? null, client);
	const docBoundary = closedBoundary && docDate && docDate > closedBoundary ? closedBoundary : null;
	let docCtx = null;
	let pastCtx = null;
	const useDocCtx = async () =>
		(docCtx ??= await createCostingContext(doc.organizationUuid ?? null, doc.date, { docUuid: documentUuid, docId: doc.id ?? null, docType: documentType, boundary: docBoundary }, client));
	const usePastCtx = async () =>
		(pastCtx ??= await createCostingContext(doc.organizationUuid ?? null, saleReturnCostDate, {}, client));

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
		let value = useVat && Number.isFinite(net) && net > 0 ? net : amt;
		// Возврат от покупателя приходует товар на склад: в регистр (и в ФИФО-слои)
		// он должен входить по СЕБЕСТОИМОСТИ, по которой товар выбыл при продаже
		// (на дату документа-основания), а не по цене строки возврата и не по
		// текущему остатку. Фолбэк на сумму строки, если себестоимость не
		// определена (нет приходов до даты продажи).
		if (documentType === "sale_return" && qty > 0) {
			const ctx = await usePastCtx();
			const unit = await ctx.unitCost(it.productUuid, doc.warehouseUuid ?? null, saleReturnCostDate, qty, { consume: true });
			const costValue = r2((Number(unit) || 0) * qty);
			if (costValue > 0) value = costValue;
		}
		// ГТД: приход по landed cost (с капитализированными таможенными платежами).
		if (landedMap) {
			const landed = landedMap.get(it.uuid);
			if (landed) value = landed.landed;
		}
		// Списание: расход по СЕБЕСТОИМОСТИ (ФИФО/средняя) на дату документа —
		// цена в строке не вводится (себестоимость определяется учётом, не пользователем).
		if (documentType === "write_off" && qty > 0) {
			const ctx = await useDocCtx();
			const unit = await ctx.unitCost(it.productUuid, doc.warehouseUuid ?? null, doc.date ?? new Date(), qty, { consume: true });
			value = r2((Number(unit) || 0) * qty);
		}
		// Перемещение ТМЗ: цена в строках не вводится (amount = 0), поэтому
		// стоимость обоих движений — себестоимость на складе-ИСТОЧНИКЕ. Иначе
		// склад-получатель получает товар по нулевой стоимости: при средней она
		// размылась бы, а при ФИФО остаётся вечным нулевым слоем и списывается
		// в COGS нулём. Слои источника при переносе смешиваются в одну сумму —
		// движение регистра несёт одну стоимость (осознанное упрощение).
		if (documentType === "inventory_transfer" && qty > 0) {
			const ctx = await useDocCtx();
			const unit = await ctx.unitCost(it.productUuid, doc.fromWarehouseUuid ?? null, doc.date ?? new Date(), qty, { consume: true });
			const costValue = r2((Number(unit) || 0) * qty);
			if (costValue > 0) value = costValue;
		}
		// Реализация: в строке хранится ВЫРУЧКА (цена продажи), но движение регистра
		// (расход) должно нести СЕБЕСТОИМОСТЬ выбытия — тогда out.amount = COGS
		// (инвариант регистра: out.amount == кредит 1330 в проводке), а стоимость
		// остатка (warehouseBalances = Σin−Σout) считается верно. Себестоимость —
		// тем же контекстом, что списание/перемещение (последовательное потребление
		// слоёв многострочного документа). Проводка реализации ПРОЕЦИРУЕТ это значение
		// (единый источник COGS — accountingPosting читает out.amount, не пересчитывает).
		// COGS=0 (нет слоёв до даты) → движение с нулевой стоимостью, как у списания.
		if (documentType === "sale" && qty > 0) {
			const ctx = await useDocCtx();
			const unit = await ctx.unitCost(it.productUuid, doc.warehouseUuid ?? null, doc.date ?? new Date(), qty, { consume: true });
			value = r2((Number(unit) || 0) * qty);
		}
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
				// Партия (T6.1 Stage 2): приход задаёт партию, расход её списывает.
				batchUuid: it.batchUuid ?? null,
			});
		}
	}
	if (records.length) {
		await client.productRegister.createMany({ data: records });
	}
	// Итог документа списания = фактическая себестоимость движений: цена в
	// строках не вводится, поэтому recalcParentAmount (Σ qty × price) дал бы 0.
	if (documentType === "write_off") {
		const total = records.reduce((s, r) => s + Number(r.amount || 0), 0);
		await client.writeOff.update({
			where: { uuid: documentUuid },
			data: { amount: r2(total) },
		});
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

/** Удалить все движения документа (при удалении документа-регистратора). Ошибка пробрасывается (У2). */
export async function removeDocumentRegister(
	documentType,
	documentUuid,
	client = prisma,
) {
	if (!DOC_CONFIG[documentType] || !documentUuid) return;
	await inDocumentTransaction(client, documentType, documentUuid, (tx) =>
		tx.productRegister.deleteMany({ where: { documentType, documentUuid } }),
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Контроль остатков при изменении движений документа.
//
// ПО ХРОНОЛОГИИ, А НЕ ПО КОНЕЧНОМУ ОСТАТКУ (У4 аудита 26.09). Раньше доступное считалось
// как Σприход − Σрасход по всей истории, без дат: реализация задним числом проходила, если
// товар пришёл ПОЗЖЕ (себестоимость на её дату — 0, прибыль завышена), а распроведение,
// удаление и уменьшение приходов не проверялись вовсе — остаток уходил в минус.
//
// Теперь сравниваются два сценария — движения документа ДО изменения (как в регистре) и
// ПОСЛЕ (по строкам и шапке) — на всей хронологии товара на складе начиная с самой ранней
// затронутой даты. Отказ, если в какой-то момент остаток (за вычетом активных резервов —
// для расходных документов) становится отрицательным И ниже, чем был бы без изменения.
// Одно правило покрывает и новый расход, и увеличение расхода, и перенос даты назад, и
// снятие/уменьшение прихода; а старый «провал» в истории, к которому изменение не
// причастно, ничего не блокирует. В один момент приход раньше расхода (compareMovements).
// Услуги склад не двигают и не проверяются.
// ─────────────────────────────────────────────────────────────────────────────

const EPS = 1e-9;

/** Ошибка нехватки остатка. shortages — массив дефицитов по товар+склад. */
export class StockShortageError extends Error {
	constructor(shortages) {
		super(formatShortageMessage(shortages));
		this.name = "StockShortageError";
		this.shortages = Array.isArray(shortages) ? shortages : [];
	}
}

const fmtShortDate = (d) => {
	if (!d) return "";
	const dt = new Date(d);
	if (Number.isNaN(dt.getTime())) return "";
	return dt.toLocaleDateString("ru-RU", { timeZone: process.env.ACCOUNTING_TIME_ZONE || "Asia/Almaty" });
};

/** Человекочитаемое RU-сообщение о нехватке остатка. */
export function formatShortageMessage(shortages) {
	if (!shortages?.length) return "Недостаточно остатка для проведения";
	const lines = shortages.map((s) => {
		const who = `• ${s.productName || s.productUuid}${s.warehouseName ? ` (${s.warehouseName})` : ""}: `;
		if (s.kind === "inflow") {
			return `${who}без этого прихода остаток${s.date ? ` на ${fmtShortDate(s.date)}` : ""} станет отрицательным (не хватит ${s.deficit})`;
		}
		return `${who}нужно ${s.requested}, доступно ${s.available} (не хватает ${s.deficit})` +
			(s.date ? ` — на ${fmtShortDate(s.date)}` : "");
	});
	return `Недостаточно остатка для проведения:\n${lines.join("\n")}`;
}

/** Набор uuid товаров-услуг среди переданных. */
async function serviceProductSet(productUuids, client) {
	if (!productUuids.length) return new Set();
	const rows = await client.product.findMany({ where: { uuid: { in: productUuids }, isService: true }, select: { uuid: true } });
	return new Set(rows.map((p) => p.uuid));
}

/**
 * Движения (только количества), которые документ дал бы в регистр в состоянии
 * doc/items. Непроведённый или удалённый документ движений не даёт.
 */
export async function prospectiveMovements(documentType, doc, items, client = prisma) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !doc || doc.posted !== true || doc.deletedAt) return [];
	const list = (items ?? []).filter((it) => it?.productUuid && !it.deletedAt);
	const services = await serviceProductSet([...new Set(list.map((it) => it.productUuid))], client);
	const date = doc.date ? new Date(doc.date) : new Date();
	const out = [];
	for (const it of list) {
		if (services.has(it.productUuid)) continue;
		const qty = Number(it.quantity) || 0;
		if (qty <= 0) continue;
		for (const mv of cfg.movements) {
			out.push({
				productUuid: it.productUuid,
				warehouseUuid: doc[mv.warehouseField] ?? null,
				movementType: mv.type,
				quantity: qty,
				date,
				documentType,
				documentId: doc.id ?? null,
				id: Number.MAX_SAFE_INTEGER,
			});
		}
	}
	return out;
}

const pairKey = (p) => `${p.productUuid}|${p.warehouseUuid ?? ""}`;
const signed = (m) => (m.movementType === "out" ? -1 : 1) * (Number(m.quantity) || 0);

/**
 * Дефициты остатка от изменения движений документа (см. шапку раздела).
 *
 * @param {object} args
 * @param {string} args.documentType
 * @param {string} [args.documentUuid] — документ, чьи движения в регистре — «до изменения»
 * @param {object|null} args.doc — состояние ПОСЛЕ изменения (posted=false / null — движений нет)
 * @param {Array} [args.items] — строки ПОСЛЕ изменения
 * @returns {Promise<Array>} дефициты { productUuid, productName, sku, warehouseUuid,
 *   warehouseName, requested, available, deficit, date, kind: "out"|"inflow" }
 */
export async function computeStockChangeShortages({ documentType, documentUuid = null, doc = null, items = [] }, client = prisma) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg) return [];
	const newMv = await prospectiveMovements(documentType, doc, items, client);
	const oldMv = documentUuid
		? (await client.productRegister.findMany({
			where: { documentType, documentUuid },
			select: { productUuid: true, warehouseUuid: true, movementType: true, quantity: true, date: true, documentType: true, documentId: true, id: true },
		})).filter((m) => m.productUuid)
		: [];

	// Пары товар|склад, где движения документа меняются.
	const pairs = new Map();
	const addTo = (m, side) => {
		const k = pairKey(m);
		let p = pairs.get(k);
		if (!p) { p = { productUuid: m.productUuid, warehouseUuid: m.warehouseUuid ?? null, old: [], new: [] }; pairs.set(k, p); }
		p[side].push(m);
	};
	for (const m of oldMv) addTo(m, "old");
	for (const m of newMv) addTo(m, "new");
	for (const [k, p] of pairs) {
		const sum = (list, type) => r4(list.filter((m) => m.movementType === type).reduce((acc, m) => acc + Number(m.quantity || 0), 0));
		const t = (list) => list.map((m) => new Date(m.date).getTime()).sort((x, y) => x - y)[0] ?? null;
		// Ничего не поменялось (те же количества, та же дата) — пару не проверяем.
		if (sum(p.old, "in") === sum(p.new, "in") && sum(p.old, "out") === sum(p.new, "out") && t(p.old) === t(p.new)) pairs.delete(k);
	}
	if (!pairs.size) return [];

	const own = [...oldMv, ...newMv];
	const tmin = new Date(Math.min(...own.map((m) => new Date(m.date).getTime())));
	const productUuids = [...new Set([...pairs.values()].map((p) => p.productUuid))];
	const whs = [...new Set([...pairs.values()].map((p) => p.warehouseUuid))];
	const whWhere = whs.includes(null)
		? { OR: [{ warehouseUuid: { in: whs.filter(Boolean) } }, { warehouseUuid: null }] }
		: { warehouseUuid: { in: whs } };
	const notOwn = documentUuid ? { NOT: { documentUuid } } : {};

	// Остаток прочих документов ДО самой ранней затронутой даты — агрегатом в SQL;
	// движения С этой даты — построчно (обычно это недавний хвост).
	// Последовательно: проверка идёт и внутри транзакции (одно соединение).
	const beforeRows = await client.productRegister.groupBy({
		by: ["productUuid", "warehouseUuid", "movementType"],
		where: { productUuid: { in: productUuids }, ...whWhere, date: { lt: tmin }, ...notOwn },
		_sum: { quantity: true },
	});
	const afterRows = await client.productRegister.findMany({
		where: { productUuid: { in: productUuids }, ...whWhere, date: { gte: tmin }, ...notOwn },
		select: { productUuid: true, warehouseUuid: true, movementType: true, quantity: true, date: true, documentType: true, documentId: true, id: true },
	});
	const base = new Map();
	for (const r of beforeRows) {
		const k = pairKey(r);
		if (!pairs.has(k)) continue;
		base.set(k, (base.get(k) ?? 0) + signed({ movementType: r.movementType, quantity: r._sum?.quantity }));
	}
	const after = new Map();
	for (const r of afterRows) {
		const k = pairKey(r);
		if (!pairs.has(k)) continue;
		if (!after.has(k)) after.set(k, []);
		after.get(k).push(r);
	}

	// Активные резервы вычитаются только для расходных документов; резерв-основание
	// самой реализации исключается — она его и закрывает.
	const isOutflowDoc = cfg.movements.some((m) => m.type === "out");
	const excludeReservationUuid = doc?.basisDocumentType === "reservation" ? doc?.basisDocumentUuid ?? null : null;
	const reserved = isOutflowDoc
		? await reservedQuantities([...pairs.values()], excludeReservationUuid, client)
		: new Map();

	const found = [];
	for (const [k, p] of pairs) {
		const events = [
			...(after.get(k) ?? []).map((m) => ({ ...m, src: "base" })),
			...p.old.map((m) => ({ ...m, src: "old" })),
			...p.new.map((m) => ({ ...m, src: "new" })),
		].sort(compareMovements);
		const res = reserved.get(k) ?? 0;
		let balOld = (base.get(k) ?? 0) - res;
		let balNew = balOld;
		let worst = null;
		for (const e of events) {
			const d = signed(e);
			if (e.src !== "new") balOld += d;
			if (e.src !== "old") balNew += d;
			if (balNew < -EPS && balNew < balOld - EPS && (worst === null || balNew < worst.bal)) {
				worst = { bal: balNew, date: e.date };
			}
		}
		if (!worst) continue;
		const sum = (list, type) => list.filter((m) => m.movementType === type).reduce((acc, m) => acc + Number(m.quantity || 0), 0);
		const newOut = sum(p.new, "out");
		// Расход документа по этой паре — «не хватает на расход»; иначе ухудшение дал
		// снятый/уменьшенный приход (распроведение, удаление, правка строк прихода).
		const kind = newOut > EPS ? "out" : "inflow";
		const deficit = r4(-worst.bal);
		const requested = kind === "out" ? r4(newOut) : r4(sum(p.old, "in") - sum(p.new, "in"));
		found.push({
			productUuid: p.productUuid,
			warehouseUuid: p.warehouseUuid,
			requested,
			available: r4(Math.max(0, requested - deficit)),
			deficit,
			date: worst.date,
			kind,
		});
	}
	if (!found.length) return [];

	// Имена — одним запросом на товары и одним на склады.
	const products = await client.product.findMany({ where: { uuid: { in: found.map((f) => f.productUuid) } }, select: { uuid: true, name: true, sku: true } });
	const warehouses = await client.warehouse.findMany({ where: { uuid: { in: found.map((f) => f.warehouseUuid).filter(Boolean) } }, select: { uuid: true, name: true } });
	const pName = new Map(products.map((x) => [x.uuid, x]));
	const wName = new Map(warehouses.map((x) => [x.uuid, x.name]));
	return found.map((f) => ({
		...f,
		productName: pName.get(f.productUuid)?.name ?? "",
		sku: pName.get(f.productUuid)?.sku ?? "",
		warehouseName: f.warehouseUuid ? wName.get(f.warehouseUuid) ?? "" : "",
	}));
}

/**
 * Остатки всех товаров на складе по состоянию на дату (включительно).
 * Используется Инвентаризацией для заполнения «количества по учёту».
 *
 * @returns {Promise<Map<string, {quantity:number, amount:number}>>} productUuid → остаток
 */
export async function warehouseBalances(
	organizationUuid,
	warehouseUuid,
	dateUpTo,
	client = prisma,
) {
	if (!warehouseUuid) return new Map();
	// Агрегат в SQL, а не вся история склада в JS.
	const rows = await client.productRegister.groupBy({
		by: ["productUuid", "movementType"],
		where: {
			warehouseUuid,
			...(organizationUuid ? { organizationUuid } : {}),
			...(dateUpTo ? { date: { lte: dateUpTo } } : {}),
		},
		_sum: { quantity: true, amount: true },
	});
	const map = new Map();
	for (const r of rows) {
		if (!r.productUuid) continue;
		const sign = r.movementType === "out" ? -1 : 1;
		const cur = map.get(r.productUuid) ?? { quantity: 0, amount: 0 };
		cur.quantity += sign * (Number(r._sum?.quantity) || 0);
		cur.amount += sign * (Number(r._sum?.amount) || 0);
		map.set(r.productUuid, cur);
	}
	for (const [k, v] of map) {
		v.quantity = r4(v.quantity);
		v.amount = r2(v.amount);
		// Нулевые остатки в инвентаризацию не тянем.
		if (v.quantity === 0 && v.amount === 0) map.delete(k);
	}
	return map;
}

/**
 * Дефициты остатка для расходного документа по ПЕРЕДАННЫМ строкам (предпроверка формы
 * /product-register/check-availability и прежние вызовы). doc — склад(ы), дата,
 * основание; документ считается проведённым. documentUuid — его движения в регистре
 * берутся как «до изменения».
 */
export async function computeShortages(
	{ documentType, documentUuid, doc, items },
	client = prisma,
) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg) return [];
	if (!cfg.movements.some((m) => m.type === "out")) return []; // приходный документ — без проверки
	return computeStockChangeShortages(
		{ documentType, documentUuid: documentUuid ?? null, doc: { ...(doc ?? {}), posted: true, deletedAt: null }, items: items ?? [] },
		client,
	);
}

/** Пары товар|склад, которые затронет документ (для блокировок). */
async function affectedPairs(documentType, documentUuid, doc, items, client) {
	const newMv = await prospectiveMovements(documentType, doc, items, client);
	const oldMv = documentUuid
		? await client.productRegister.findMany({ where: { documentType, documentUuid }, select: { productUuid: true, warehouseUuid: true } })
		: [];
	return [...newMv, ...oldMv].filter((m) => m.productUuid);
}

/**
 * Бэкенд-гард ВНУТРИ транзакции записи строк: документ и строки читаются через тот же
 * клиент (уже в новом состоянии), движения в регистре — ещё прежние. Берёт блокировки
 * пар товар|склад — параллельный расход того же товара ждёт, а не проходит проверку
 * одновременно (У4). Бросает StockShortageError.
 */
export async function assertStockAvailable(
	documentType,
	documentUuid,
	client = prisma,
) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	const doc = await client[cfg.parentModel].findUnique({ where: { uuid: documentUuid } });
	if (!doc) return;
	// Настройка организации «Контроль остатков ТМЗ» выключена → минус разрешён.
	if (!(await resolveStockControl(doc.organizationUuid, doc.date, client))) return;
	const items = await client[cfg.itemModel].findMany({ where: { [cfg.parentField]: documentUuid } });
	await lockStockPairs(client, await affectedPairs(documentType, documentUuid, doc, items, client));
	const shortages = await computeStockChangeShortages({ documentType, documentUuid, doc, items }, client);
	if (shortages.length) throw new StockShortageError(shortages);
}

/**
 * Бэкенд-гард для роутера шапки ПЕРЕД записью: prospectiveDoc — поля из payload поверх
 * сохранённого документа (склад, дата, основание, posted); строки — из БД. Проверяет
 * любое изменение: проведение/распроведение, перенос даты, смену склада — для расходных
 * И приходных документов. prospectiveDoc = null — документ удаляется.
 */
export async function assertStockAfterChange(documentType, documentUuid, prospectiveDoc, client = prisma) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	const saved = await client[cfg.parentModel].findUnique({ where: { uuid: documentUuid } });
	if (!saved) return;
	const defined = Object.fromEntries(Object.entries(prospectiveDoc ?? {}).filter(([, v]) => v !== undefined));
	const doc = prospectiveDoc === null ? { ...saved, posted: false } : { ...saved, ...defined };
	if (!(await resolveStockControl(doc.organizationUuid, doc.date, client))) return;
	const items = await client[cfg.itemModel].findMany({ where: { [cfg.parentField]: documentUuid } });
	const shortages = await computeStockChangeShortages({ documentType, documentUuid, doc, items }, client);
	if (shortages.length) throw new StockShortageError(shortages);
}

/**
 * Прежний гард расходного документа перед проведением (зовут роутеры шапок: sales,
 * writeoffs, inventorytransfers, purchasereturns). Теперь — частный случай
 * assertStockAfterChange: prospectiveDoc накладывается на СОХРАНЁННЫЙ документ, поэтому
 * дата и основание-резерв берутся из документа, даже если роутер передал только склад
 * (раньше резерв-основание реализации не исключался — её нельзя было провести).
 * Проведение подразумевается (posted: true).
 */
export async function assertStockForPosting(
	documentType,
	documentUuid,
	prospectiveDoc,
	client = prisma,
) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	if (!cfg.movements.some((m) => m.type === "out")) return; // приходный — пропуск (как раньше)
	await assertStockAfterChange(documentType, documentUuid, { ...(prospectiveDoc ?? {}), posted: true, deletedAt: null }, client);
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
	documentHasInflow,
	documentTypeForParentModel,
	reconcileDocumentRegister,
	reconcileByParentModel,
	removeDocumentRegister,
	StockShortageError,
	formatShortageMessage,
	prospectiveMovements,
	computeStockChangeShortages,
	computeShortages,
	assertStockAvailable,
	assertStockAfterChange,
	assertStockForPosting,
	respondStockError,
};
