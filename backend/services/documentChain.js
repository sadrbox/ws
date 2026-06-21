// ─────────────────────────────────────────────────────────────────────────
// Цепочка связанных документов (Stage C).
//
// Документ ссылается на основание через basisDocumentType + basisDocumentUuid
// (указатель ВВЕРХ). «Дети» — документы, у которых basisDocumentUuid равен
// uuid данного документа (поиск ВНИЗ по всем моделям с этим полем).
//
// buildDocumentChain(type, uuid):
//   1) поднимается до КОРНЯ (по basisDocumentUuid), защита от циклов;
//   2) от корня строит дерево потомков (по всем дочерним моделям);
//   3) собирает проблемы целостности (битые ссылки, циклы).
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/** Реестр типов документов цепочки: docType → { model, label, hasBasis }. */
export const DOC_REGISTRY = {
	commercial_offer: { model: "commercialOffer", label: "Коммерческое предложение", hasBasis: true },
	sales_order: { model: "salesOrder", label: "Заказ покупателя", hasBasis: true },
	reservation: { model: "reservation", label: "Резервирование", hasBasis: true },
	sale: { model: "sale", label: "Реализация", hasBasis: true },
	outgoing_invoice: { model: "outgoingInvoice", label: "Счёт-фактура (исх.)", hasBasis: true },
	payment_invoice: { model: "paymentInvoice", label: "Счёт на оплату", hasBasis: false },
	sale_return: { model: "saleReturn", label: "Возврат от покупателя", hasBasis: true },
	purchase_requisition: { model: "purchaseRequisition", label: "Заявка на закупку", hasBasis: true },
	purchase_order: { model: "purchaseOrder", label: "Заказ поставщику", hasBasis: true },
	purchase: { model: "purchase", label: "Поступление", hasBasis: true },
	incoming_invoice: { model: "incomingInvoice", label: "Счёт-фактура (вх.)", hasBasis: false },
	purchase_return: { model: "purchaseReturn", label: "Возврат поставщику", hasBasis: true },
	bank_statement: { model: "bankStatement", label: "Банковская выписка", hasBasis: true },
};

/** Типы-«дети» — те, у кого есть поле basisDocumentUuid (могут ссылаться на основание). */
const CHILD_TYPES = Object.entries(DOC_REGISTRY)
	.filter(([, c]) => c.hasBasis)
	.map(([type]) => type);

/** Имя организации по uuid (короткое → полное → null). */
async function loadOrgName(uuid) {
	if (!uuid) return null;
	try {
		const org = await prisma.organization.findUnique({
			where: { uuid },
			select: { name: true, shortName: true },
		});
		return org?.shortName || org?.name || null;
	} catch {
		return null;
	}
}

/** Нормализует число (Decimal/строка) для сравнения: "30.0000" → "30", null → "". */
const normNum = (v) => (v == null || v === "" ? "" : String(Number(v)));

/** Сигнатура строки товара для сравнения с основанием (без учёта порядка строк). */
const serializeItem = (it) =>
	[
		it.productUuid ?? "",
		normNum(it.quantity),
		normNum(it.price),
		normNum(it.vatRate),
		normNum(it.discountPercent),
		normNum(it.exciseRate),
	].join("|");

/**
 * Загружает строки документа (если у модели есть *Item-таблица).
 * @returns {Promise<Array|null>} массив строк или null (у документа нет табличной части).
 */
async function loadItems(type, uuid) {
	const cfg = DOC_REGISTRY[type];
	if (!cfg) return null;
	const itemModel = `${cfg.model}Item`;
	if (!prisma[itemModel]) return null; // header-документ (напр. банк-выписка)
	try {
		return await prisma[itemModel].findMany({
			where: { [`${cfg.model}Uuid`]: uuid, deletedAt: null },
			select: {
				productUuid: true,
				quantity: true,
				price: true,
				vatRate: true,
				discountPercent: true,
				exciseRate: true,
				amount: true,
			},
		});
	} catch {
		return null;
	}
}

/** Сравнение двух отсортированных сигнатур строк. */
const sigEqual = (a, b) =>
	Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((s, i) => s === b[i]);

/**
 * Строит узел цепочки из записи документа: подтягивает имя организации, строки;
 * СУММА считается по строкам (надёжнее хранимого rec.amount, который может
 * устаревать), сигнатура строк (_sig) — для сравнения с основанием.
 */
async function buildNode(type, rec) {
	const cfg = DOC_REGISTRY[type];
	const orgName = await loadOrgName(rec.organizationUuid);
	const items = await loadItems(type, rec.uuid);

	let amount = rec.amount != null ? Number(rec.amount) : null;
	let sig = null;
	if (items) {
		amount = items.reduce((s, it) => s + Number(it.amount ?? 0), 0);
		sig = items.map(serializeItem).sort();
	}

	return {
		type,
		typeLabel: cfg?.label ?? type,
		uuid: rec.uuid,
		id: rec.id ?? null,
		number: rec.number ?? null,
		date: rec.date ?? null,
		posted: rec.posted === true,
		amount,
		organizationUuid: rec.organizationUuid ?? null,
		organizationName: orgName,
		basisDocumentType: rec.basisDocumentType ?? null,
		basisDocumentUuid: rec.basisDocumentUuid ?? null,
		// Расхождение со своим основанием (выставляется при построении дерева).
		basisMismatch: false,
		_sig: sig,
		children: [],
	};
}

/** Загружает документ по типу+uuid и строит узел. */
async function fetchDoc(type, uuid) {
	const cfg = DOC_REGISTRY[type];
	if (!cfg || !uuid) return null;
	let rec;
	try {
		rec = await prisma[cfg.model].findUnique({ where: { uuid } });
	} catch {
		return null;
	}
	if (!rec) return null;
	return buildNode(type, rec);
}

/** Находит «детей» документа (по всем дочерним моделям). */
async function fetchChildren(uuid) {
	const children = [];
	for (const type of CHILD_TYPES) {
		const cfg = DOC_REGISTRY[type];
		let recs = [];
		try {
			recs = await prisma[cfg.model].findMany({
				where: { basisDocumentUuid: uuid },
			});
		} catch {
			continue;
		}
		for (const rec of recs) {
			children.push(await buildNode(type, rec));
		}
	}
	return children;
}

/** Рекурсивно убирает служебные поля (_sig) из дерева перед отдачей. */
function stripInternal(node) {
	delete node._sig;
	node.children.forEach(stripInternal);
}

/**
 * Строит цепочку связанных документов для заданного документа.
 * @returns {{ root, target, integrity }} root — корневой узел дерева,
 *   target — { type, uuid } исходного документа (для подсветки),
 *   integrity — массив проблем целостности.
 */
export async function buildDocumentChain(type, uuid) {
	const integrity = [];
	const start = await fetchDoc(type, uuid);
	if (!start) return null;

	// ── 1) Поднимаемся до корня по basisDocumentUuid ──────────────────────
	let root = start;
	const upVisited = new Set([`${type}:${uuid}`]);
	while (root.basisDocumentType && root.basisDocumentUuid) {
		const key = `${root.basisDocumentType}:${root.basisDocumentUuid}`;
		if (upVisited.has(key)) {
			integrity.push({ kind: "cycle", message: `Цикл в основаниях: ${key}` });
			break;
		}
		upVisited.add(key);
		const parent = await fetchDoc(root.basisDocumentType, root.basisDocumentUuid);
		if (!parent) {
			integrity.push({
				kind: "dangling",
				message: `Основание не найдено: ${root.typeLabel} → ${root.basisDocumentType} (${root.basisDocumentUuid})`,
				type: root.basisDocumentType,
				uuid: root.basisDocumentUuid,
				// Документ-РЕБЁНОК с висячей ссылкой — его и нужно чинить (очистить основание).
				childType: root.type,
				childUuid: root.uuid,
				childLabel: root.typeLabel,
			});
			break;
		}
		root = parent;
	}

	// ── 2) Строим дерево потомков от корня (BFS, защита от циклов) ─────────
	const downVisited = new Set();
	const expand = async (node) => {
		const key = `${node.type}:${node.uuid}`;
		if (downVisited.has(key)) {
			integrity.push({ kind: "cycle", message: `Повторный узел в дереве: ${key}` });
			return;
		}
		downVisited.add(key);
		node.children = await fetchChildren(node.uuid);
		// Дочерний документ построен из этого узла-основания → если набор строк
		// расходится с основанием, помечаем расхождение (тот же смысл, что и
		// предупреждение у кнопки «Перезаполнить по основанию»). Сравниваем,
		// только когда у обоих есть табличная часть (_sig != null).
		for (const child of node.children) {
			if (node._sig && child._sig) {
				child.basisMismatch = !sigEqual(node._sig, child._sig);
			}
		}
		for (const child of node.children) await expand(child);
	};
	await expand(root);
	stripInternal(root);

	return { root, target: { type, uuid }, integrity };
}
