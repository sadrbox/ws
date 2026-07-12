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

/**
 * Бросает BasisNotFoundError, если основание указано, но не существует.
 * Пустое основание (нет типа/uuid) — допустимо (документ без основания).
 *
 * @param {string|null|undefined} basisDocumentType
 * @param {string|null|undefined} basisDocumentUuid
 * @param {*} [client] — prisma/transaction-клиент
 */
export async function assertBasisExists(basisDocumentType, basisDocumentUuid, client = prisma) {
	if (!basisDocumentType || !basisDocumentUuid) return;
	const def = DOC_REGISTRY[basisDocumentType];
	// Неизвестный тип основания — не блокируем (нет модели для проверки).
	if (!def) return;
	const needsPosted = BASIS_MUST_BE_POSTED.has(basisDocumentType);
	const found = await client[def.model].findUnique({
		where: { uuid: basisDocumentUuid },
		select: needsPosted ? { uuid: true, posted: true } : { uuid: true },
	});
	if (!found) {
		throw new BasisNotFoundError(
			`Документ-основание не найден: ${def.label} (${basisDocumentUuid}). ` +
			`Возможно, он был удалён — отключите связь основания.`,
		);
	}
	if (needsPosted && found.posted !== true) {
		throw new BasisNotPostedError(
			`Документ-основание не проведён: ${def.label}. ` +
			`Сначала проведите его — документы «на основании» создаются только от проведённого.`,
		);
	}
}

/** Express-helper: ошибка основания (не найдено / не проведено) → 422. */
export function respondBasisError(err, res) {
	if (err instanceof BasisNotFoundError || err instanceof BasisNotPostedError) {
		res.status(422).json({ success: false, message: err.message });
		return true;
	}
	return false;
}

export default { assertBasisExists, respondBasisError, BasisNotFoundError, BasisNotPostedError };
