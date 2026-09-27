// ─────────────────────────────────────────────────────────────────────────────
// Валидация документа-основания при сохранении (POST/PUT).
//
// «Основание» — полиморфная МЯГКАЯ ссылка (basisDocumentType + basisDocumentUuid),
// а не внешний ключ, поэтому БД её не контролирует. Чтобы в документ нельзя было
// записать ссылку «в никуда» (на удалённый/несуществующий документ), все doc-роутеры
// вызывают assertBasisExists в POST и PUT.
//
// Удаление основания при наличии детей блокирует guardBasisDependents
// (utils/checkReferences.js); здесь — обратная защита: на стороне ребёнка.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { DOC_REGISTRY } from "./documentChain.js";

export class BasisNotFoundError extends Error {
	constructor(message) {
		super(message);
		this.name = "BasisNotFoundError";
	}
}

/** Основание существует, но НЕ проведено (не утверждено). */
export class BasisNotPostedError extends Error {
	constructor(message) {
		super(message);
		this.name = "BasisNotPostedError";
	}
}

// ─── Документы-«утверждения» ─────────────────────────────────────────────────
// У этих документов проведение НЕ двигает регистры и НЕ даёт проводок — оно
// означает УТВЕРЖДЕНИЕ. Смысл флагу придаёт именно этот гейт: создавать документы
// «на основании» можно только от ПРОВЕДЁННОГО (утверждённого) документа.
//   stock_count          — инвентаризация утверждена → оформляем Списание/Оприходование;
//   purchase_requisition — заявка утверждена → оформляем Заказ поставщику/Закупку.
// Остальные типы-основания сюда НЕ входят: у них проведение и так имеет эффект
// (регистр/проводки), а требовать его для порождения документа — отдельное решение.
const BASIS_MUST_BE_POSTED = new Set(["stock_count", "purchase_requisition"]);

// Основания-регистраторы: их проведение ДВИГАЕТ склад/деньги. ПРОВОДИТЬ документ на
// основании непроведённого такого документа нельзя (аудит 26.09, У9): возврат по
// непроведённой реализации вернул бы на склад товар, который не выбывал. Черновик
// «на основании» черновика создавать по-прежнему можно — проверка только при проведении.
const BASIS_POSTED_FOR_POSTING = new Set(["sale", "purchase", "reservation", "import_declaration", "goods_receipt", "write_off", "inventory_transfer"]);

/** Основание — документ ДРУГОЙ организации (аудит 26.09, У9). */
export class BasisOrganizationError extends Error {
	constructor(message) {
		super(message);
		this.name = "BasisOrganizationError";
	}
}

/** Возврат больше, чем было продано/куплено по основанию (аудит 26.09, У9). */
export class ReturnExceedsBasisError extends Error {
	constructor(message, lines = []) {
		super(message);
		this.name = "ReturnExceedsBasisError";
		this.lines = lines;
	}
}

/**
 * Бросает BasisNotFoundError, если основание указано, но не существует.
 * Пустое основание (нет типа/uuid) — допустимо (документ без основания).
 *
 * @param {string|null|undefined} basisDocumentType
 * @param {string|null|undefined} basisDocumentUuid
 * @param {*} [client] — prisma/transaction-клиент
 * @param {object} [opts]
 * @param {string|null} [opts.organizationUuid] — организация документа: основание обязано
 *   быть той же организации (или «общим» без организации). Не передана — не проверяем.
 * @param {boolean} [opts.posting] — документ проводится: основание-регистратор должно
 *   быть проведено (BASIS_POSTED_FOR_POSTING).
 */
export async function assertBasisExists(basisDocumentType, basisDocumentUuid, client = prisma, { organizationUuid = undefined, posting = false } = {}) {
	if (!basisDocumentType || !basisDocumentUuid) return;
	const def = DOC_REGISTRY[basisDocumentType];
	// Неизвестный тип основания — не блокируем (нет модели для проверки).
	if (!def) return;
	const needsPosted = BASIS_MUST_BE_POSTED.has(basisDocumentType) || (posting && BASIS_POSTED_FOR_POSTING.has(basisDocumentType));
	const checkOrg = organizationUuid !== undefined;
	const found = await client[def.model].findUnique({
		where: { uuid: basisDocumentUuid },
		select: { uuid: true, ...(needsPosted ? { posted: true } : {}), ...(checkOrg ? { organizationUuid: true } : {}) },
	});
	if (found && checkOrg && found.organizationUuid && organizationUuid && found.organizationUuid !== organizationUuid) {
		throw new BasisOrganizationError(
			`Документ-основание (${def.label}) принадлежит другой организации — документ на его основании ` +
			`можно создать только в той же организации.`,
		);
	}
	if (!found) {
		throw new BasisNotFoundError(
			`Документ-основание не найден: ${def.label} (${basisDocumentUuid}). ` +
			`Возможно, он был удалён — отключите связь основания.`,
		);
	}
	if (needsPosted && found.posted !== true) {
		throw new BasisNotPostedError(
			BASIS_MUST_BE_POSTED.has(basisDocumentType)
				? `Документ-основание не проведён: ${def.label}. ` +
					`Сначала проведите его — документы «на основании» создаются только от проведённого.`
				: `Документ-основание не проведён: ${def.label}. ` +
					`Провести документ на основании непроведённого нельзя — сначала проведите основание.`,
		);
	}
}

// Возврат ↔ основание: модели строк и поле связи.
const RETURN_BASIS = {
	sale_return: { basisType: "sale", model: "saleReturn", itemModel: "saleReturnItem", parentField: "saleReturnUuid", basisItemModel: "saleItem", basisParentField: "saleUuid", verb: "продано" },
	purchase_return: { basisType: "purchase", model: "purchaseReturn", itemModel: "purchaseReturnItem", parentField: "purchaseReturnUuid", basisItemModel: "purchaseItem", basisParentField: "purchaseUuid", verb: "поступило" },
};

/**
 * Количество возврата по основанию не больше проданного/купленного (аудит 26.09, У9).
 * Считается по товарам: этот возврат (его строки — через client, т. е. уже в новом
 * состоянии внутри транзакции) плюс ДРУГИЕ проведённые возвраты того же основания.
 * Проверяется, только если возврат проведён/проводится и основание — реализация
 * (поступление); возврат без основания не ограничиваем — сравнить не с чем.
 *
 * @param {object} [prospective] — поля шапки поверх сохранённых (posted, basis…)
 */
export async function assertReturnWithinBasis(documentType, documentUuid, prospective = {}, client = prisma) {
	const cfg = RETURN_BASIS[documentType];
	if (!cfg || !documentUuid) return;
	const saved = await client[cfg.model].findUnique({
		where: { uuid: documentUuid },
		select: { uuid: true, posted: true, deletedAt: true, basisDocumentType: true, basisDocumentUuid: true },
	});
	if (!saved) return;
	const doc = { ...saved, ...Object.fromEntries(Object.entries(prospective ?? {}).filter(([, v]) => v !== undefined)) };
	if (doc.posted !== true || doc.deletedAt) return;
	if (doc.basisDocumentType !== cfg.basisType || !doc.basisDocumentUuid) return;

	const sum = (rows) => {
		const m = new Map();
		for (const r of rows) {
			if (!r.productUuid) continue;
			m.set(r.productUuid, (m.get(r.productUuid) ?? 0) + (Number(r.quantity) || 0));
		}
		return m;
	};
	const basisItems = await client[cfg.basisItemModel].findMany({
		where: { [cfg.basisParentField]: doc.basisDocumentUuid, deletedAt: null },
		select: { productUuid: true, quantity: true },
	});
	const otherReturns = await client[cfg.model].findMany({
		where: { basisDocumentType: cfg.basisType, basisDocumentUuid: doc.basisDocumentUuid, posted: true, deletedAt: null, uuid: { not: documentUuid } },
		select: { uuid: true },
	});
	const returnedRows = await client[cfg.itemModel].findMany({
		where: { [cfg.parentField]: { in: [documentUuid, ...otherReturns.map((r) => r.uuid)] }, deletedAt: null },
		select: { productUuid: true, quantity: true },
	});
	const basis = sum(basisItems);
	const returned = sum(returnedRows);
	const over = [];
	for (const [productUuid, qty] of returned) {
		const limit = basis.get(productUuid) ?? 0;
		if (qty > limit + 1e-9) over.push({ productUuid, returned: Math.round(qty * 10000) / 10000, limit: Math.round(limit * 10000) / 10000 });
	}
	if (!over.length) return;
	const products = await client.product.findMany({ where: { uuid: { in: over.map((o) => o.productUuid) } }, select: { uuid: true, name: true } });
	const name = new Map(products.map((p) => [p.uuid, p.name]));
	throw new ReturnExceedsBasisError(
		`Возврат больше, чем ${cfg.verb} по документу-основанию:\n` +
			over.map((o) => `• ${name.get(o.productUuid) ?? o.productUuid}: возвращается ${o.returned}, ${cfg.verb} ${o.limit}`).join("\n"),
		over,
	);
}

/** Express-helper: ошибка основания (не найдено / не проведено) → 422. */
export function respondBasisError(err, res) {
	if (err instanceof BasisNotFoundError || err instanceof BasisNotPostedError
		|| err instanceof BasisOrganizationError || err instanceof ReturnExceedsBasisError) {
		res.status(422).json({ success: false, message: err.message });
		return true;
	}
	return false;
}

export default {
	assertBasisExists,
	assertReturnWithinBasis,
	respondBasisError,
	BasisNotFoundError,
	BasisNotPostedError,
	BasisOrganizationError,
	ReturnExceedsBasisError,
};
