// ─────────────────────────────────────────────────────────────────────────────
// Единый механизм поля «Номер документа» (number) для ВСЕХ doc-роутеров.
//
// Правило: номер присваивается АВТОМАТИЧЕСКИ при записи документа (create/update).
//   • ручной/импортный номер сохраняется как есть;
//   • если номера нет — автогенерация (allocateNumber, единый счётчик с
//     самовосстановлением по журналу за год);
//   • уникальность номера проверяется в пределах календарного года.
//
// Использовать ОДНУ функцию ensureDocumentNumber и в POST, и в PUT — чтобы
// механизм был единым (не дублировался по роутерам).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { allocateNumber } from "./documentNumbering.js";
import { assertUniqueNumber } from "../utils/uniqueNumber.js";

/**
 * Гарантирует номер документа при записи (create/update).
 *
 * @param {object}  p
 * @param {string}  p.docType        вид документа (ключ NUMBER_CONFIG), напр. "sale"
 * @param {string}  p.modelName      prisma-модель для проверки уникальности, напр. "sale"
 * @param {string|null|undefined} p.manual  введённый/текущий номер (payload или запись)
 * @param {string|null} p.organizationUuid
 * @param {Date|string|null} p.date
 * @param {string} [p.excludeUuid]   при update — uuid текущего документа
 * @param {*} [client]               prisma/transaction-клиент
 * @returns {Promise<string|null>}   итоговый номер (или null — автонумерация выключена и номер не задан)
 */
export async function ensureDocumentNumber(
	{ docType, modelName, manual, organizationUuid = null, date = null, excludeUuid } = {},
	client = prisma,
) {
	const m = manual == null ? "" : String(manual).trim();
	let number = m || null;
	if (!number) number = await allocateNumber(docType, organizationUuid, date, client);
	if (number) await assertUniqueNumber(modelName, { number, date, organizationUuid, excludeUuid }, client);
	return number;
}

export default { ensureDocumentNumber };
