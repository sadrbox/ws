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

/** Нормализует запись документа в узел цепочки (с устойчивостью к разным полям). */
function toNode(type, rec, orgName) {
	const cfg = DOC_REGISTRY[type];
	return {
		type,
		typeLabel: cfg?.label ?? type,
		uuid: rec.uuid,
		id: rec.id ?? null,
		date: rec.date ?? null,
		posted: rec.posted === true,
		amount: rec.amount != null ? Number(rec.amount) : null,
		organizationUuid: rec.organizationUuid ?? null,
		organizationName: orgName ?? null,
		basisDocumentType: rec.basisDocumentType ?? null,
		basisDocumentUuid: rec.basisDocumentUuid ?? null,
		children: [],
	};
}

/** Загружает документ по типу+uuid (полная запись) + имя организации. */
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
	let orgName = null;
	if (rec.organizationUuid) {
		try {
			const org = await prisma.organization.findUnique({
				where: { uuid: rec.organizationUuid },
				select: { name: true, shortName: true },
			});
			orgName = org?.shortName || org?.name || null;
		} catch { /* noop */ }
	}
	return toNode(type, rec, orgName);
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
			let orgName = null;
			if (rec.organizationUuid) {
				try {
					const org = await prisma.organization.findUnique({
						where: { uuid: rec.organizationUuid },
						select: { name: true, shortName: true },
					});
					orgName = org?.shortName || org?.name || null;
				} catch { /* noop */ }
			}
			children.push(toNode(type, rec, orgName));
		}
	}
	return children;
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
		for (const child of node.children) await expand(child);
	};
	await expand(root);

	return { root, target: { type, uuid }, integrity };
}
