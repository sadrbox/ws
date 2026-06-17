// ─────────────────────────────────────────────────────────────────────────────
// ЕДИНЫЙ механизм поля «Номер документа» (number) для всех doc-роутеров И кнопки
// «Присвоить номер». ОДИН алгоритм (resolveDocumentNumber) — без дублирования и
// расхождений между сохранением и превью кнопки.
//
// Алгоритм присвоения номера (по приоритету):
//   1) номер введён ВРУЧНУЮ (поле отличается от сохранённого) → принимаем как есть;
//   2) у документа уже есть номер (оставлен или поле очищено):
//      • при СОХРАНЕНИИ — НЕ меняем (только проверка корректности — уникальность);
//      • кнопкой «Присвоить номер» (reformatExisting) — приводим формат к ТЕКУЩИМ
//        настройкам, сохраняя позицию (напр. «ПГРМ-000003» → «000003»);
//   3) НОВЫЙ документ (номера не было) → следующий по порядку СОХРАНЕНИЯ (счётчик
//      document_sequences, отдельный на префикс; НЕ зависит от даты документа).
// Уникальность номера проверяется в пределах календарного года.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { allocateNumber, peekNextNumber, reformatNumber } from "./documentNumbering.js";
import { assertUniqueNumber } from "../utils/uniqueNumber.js";

/**
 * ЕДИНЫЙ алгоритм определения номера документа (для кнопки-превью и сохранения).
 * @param {object} p
 * @param {string} p.docType
 * @param {string|null} p.organizationUuid
 * @param {Date|string|null} p.date
 * @param {string|null|undefined} p.manual        текущее/введённое значение поля «Номер»
 * @param {string|null} [p.existingNumber]        номер документа в БД (для update)
 * @param {object} [opts]
 * @param {boolean} [opts.preview]   true → НЕ инкрементировать счётчик (кнопка); иначе выделить (save)
 * @returns {Promise<string|null>}   итоговый номер (или null — нет конфига)
 */
export async function resolveDocumentNumber(
	{ docType, organizationUuid = null, date = null, manual, existingNumber = null },
	{ preview = false, reformatExisting = false } = {},
	client = prisma,
) {
	const m = manual == null ? "" : String(manual).trim();
	const ex = existingNumber == null ? "" : String(existingNumber).trim();
	// 1) Ручной ввод (поле отличается от сохранённого) — принимаем как есть.
	if (m && m !== ex) return m;
	// 2) Существующий номер: при сохранении НЕ меняем (только проверка корректности
	//    выше по стеку); кнопкой (reformatExisting) — приводим к текущим настройкам.
	if (ex) return reformatExisting ? ((await reformatNumber(docType, organizationUuid, ex, client)) ?? ex) : ex;
	// 3) Новый документ — следующий по очереди сохранения (превью без инкремента).
	return preview
		? await peekNextNumber(docType, organizationUuid, date, client)
		: await allocateNumber(docType, organizationUuid, date, client);
}

/**
 * Гарантирует номер документа при записи (create/update): тот же resolveDocumentNumber
 * + проверка уникальности. Вызывать в POST и PUT всех doc-роутеров.
 *
 * @param {object}  p
 * @param {string}  p.docType        вид документа (ключ NUMBER_CONFIG), напр. "sale"
 * @param {string}  p.modelName      prisma-модель для проверки уникальности, напр. "sale"
 * @param {string|null|undefined} p.manual  введённое/текущее значение поля «Номер»
 * @param {string|null} [p.existingNumber]  номер документа в БД (для update — чтобы не менять верно присвоенный)
 * @param {string|null} p.organizationUuid
 * @param {Date|string|null} p.date
 * @param {string} [p.excludeUuid]   при update — uuid текущего документа
 * @param {object} [p.uniqueWhere]   доп. фильтр серии для уникальности (напр. {direction} для cashOrder)
 * @param {*} [client]               prisma/transaction-клиент
 * @returns {Promise<string|null>}   итоговый номер
 */
export async function ensureDocumentNumber(
	{ docType, modelName, manual, existingNumber = null, organizationUuid = null, date = null, excludeUuid, uniqueWhere = {} } = {},
	client = prisma,
) {
	const number = await resolveDocumentNumber({ docType, organizationUuid, date, manual, existingNumber }, { preview: false }, client);
	if (number) await assertUniqueNumber(modelName, { number, date, organizationUuid, excludeUuid, extraWhere: uniqueWhere }, client);
	return number;
}

export default { ensureDocumentNumber, resolveDocumentNumber };
