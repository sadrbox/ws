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
	const found = await client[def.model].findUnique({
		where: { uuid: basisDocumentUuid },
		select: { uuid: true },
	});
	if (!found) {
		throw new BasisNotFoundError(
			`Документ-основание не найден: ${def.label} (${basisDocumentUuid}). ` +
			`Возможно, он был удалён — отключите связь основания.`,
		);
	}
}

/** Express-helper: если ошибка — «основание не найдено», отвечает 422 и возвращает true. */
export function respondBasisError(err, res) {
	if (err instanceof BasisNotFoundError) {
		res.status(422).json({ success: false, message: err.message });
		return true;
	}
	return false;
}

export default { assertBasisExists, respondBasisError, BasisNotFoundError };
