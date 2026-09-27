// ─────────────────────────────────────────────────────────────────────────────
// Фиксация изменения ШАПКИ документа-регистратора (У2/У4 аудита 26.09) — одно место
// для всех роутеров складских документов (sales, purchases, writeoffs, goodsreceipts,
// importdeclarations, inventorytransfers, возвраты).
//
// БЫЛО. Роутер обновлял шапку, потом отдельными вызовами синхронизировал строки,
// пересобирал регистр и проводки; ошибка пересбора глушилась в сервисе — документ
// оставался «проведённым без движений». Контроль остатка шёл только при проведении
// расходного документа: распроведение прихода, из которого уже продано, проходило.
//
// СТАЛО. Шапка → денормализованные поля строк → контроль остатка по хронологии (любое
// изменение, в т. ч. распроведение и перенос даты прихода) → регистр → проводки — ОДНОЙ
// транзакцией под блокировкой документа. Отказ или сбой откатывает и шапку. Связи
// (include) дочитываются после фиксации: внутри транзакции Prisma грузит их параллельными
// запросами, а у транзакции одно соединение. После фиксации — пересчёт себестоимости
// хвоста в фоне, и только если поменялось влияющее на неё (не комментарий).
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma-client.js";
import { lockDocument, POSTING_TX_OPTIONS } from "./documentLock.js";
import { assertStockAvailable, assertStockAfterChange, documentHasInflow, respondStockError } from "./productRegister.js";
import { reconcileDocumentRegister } from "./productRegister.js";
import { reconcileDocumentEntries } from "./accountingPosting.js";
import { recomputeIfRetroactive, costingFieldsChanged } from "./recomputeCosting.js";
import { checkOwnership } from "../utils/auth.js";

// Денормализованные поля строк — только те, что есть у модели строки по схеме: у строк
// списания, оприходования и ГТД есть лишь organizationUuid (прежний syncItemsFromParent там
// молча падал в try/catch и ничего не синхронизировал).
const DENORM_FIELDS = ["date", "posted", "organizationUuid", "counterpartyUuid"];
const denormFieldsOf = (itemModel) => {
	const model = Prisma.dmmf?.datamodel?.models?.find((m) => m.name.toLowerCase() === String(itemModel).toLowerCase());
	if (!model) return [];
	const names = new Set(model.fields.map((f) => f.name));
	return DENORM_FIELDS.filter((f) => names.has(f));
};

/**
 * Зафиксировать изменение шапки документа-регистратора.
 *
 * @param {object} p
 * @param {string} p.documentType — тип регистра/проводок ("sale", "purchase", …)
 * @param {string} p.model — prisma-модель документа ("sale")
 * @param {string} p.uuid — uuid документа
 * @param {object} p.data — данные обновления шапки
 * @param {object} p.existing — сохранённая шапка ДО изменения (date, posted, склады, …)
 * @param {string|null} [p.itemModel] — модель строк для денормализации (date/posted/организация/контрагент)
 * @param {string|null} [p.parentField] — поле связи строки с документом
 * @param {object} [p.include] — связи для ответа (читаются после фиксации)
 * @param {(tx: object, updated: object) => Promise<void>} [p.inTransaction] — доп. шаги внутри транзакции
 * @returns {Promise<object>} документ после фиксации (с include)
 */
export async function commitDocumentHeader(
	{ documentType, model, uuid, data, existing, itemModel = null, parentField = null, include = undefined, inTransaction = null },
	client = prisma,
) {
	await client.$transaction(async (tx) => {
		await lockDocument(tx, documentType, uuid);
		const updated = await tx[model].update({ where: { uuid }, data });
		// Денормализованные поля строк — те же, что у syncItemsFromParent (фабрика строк),
		// но без глушения ошибки: внутри транзакции она и так откатывает всё.
		if (itemModel && parentField) {
			const values = {
				date: updated.date ?? null,
				posted: updated.posted === true,
				organizationUuid: updated.organizationUuid ?? null,
				counterpartyUuid: updated.counterpartyUuid ?? null,
			};
			const fields = denormFieldsOf(itemModel);
			if (fields.length) {
				await tx[itemModel].updateMany({
					where: { [parentField]: uuid },
					data: Object.fromEntries(fields.map((f) => [f, values[f]])),
				});
			}
		}
		// Остаток по хронологии — до пересбора регистра (в нём ещё прежние движения документа).
		await assertStockAvailable(documentType, uuid, tx);
		await reconcileDocumentRegister(documentType, uuid, tx);
		await reconcileDocumentEntries(documentType, uuid, tx);
		if (inTransaction) await inTransaction(tx, updated);
	}, POSTING_TX_OPTIONS);

	const item = await client[model].findUnique({ where: { uuid }, ...(include ? { include } : {}) });
	// Ввод задним числом делает COGS последующих документов устаревшим — пересчёт хвоста
	// (в фоне) от меньшей из дат: прежней и новой.
	const from = [existing?.date, item?.date].filter(Boolean).map((d) => new Date(d)).sort((x, y) => x - y)[0];
	if (item && from) {
		await recomputeIfRetroactive({
			organizationUuid: item.organizationUuid,
			date: from,
			changed: costingFieldsChanged(existing, data),
		}, client);
	}
	return item;
}

/**
 * Проверить перед удалением: приходный документ (или перемещение), из поступления которого
 * уже расходовали, удалять нельзя — остаток уйдёт в минус. Бросает StockShortageError.
 * Чужие и непроведённые документы пропускаются (о них ответит общий обработчик удаления).
 */
export async function assertDocumentsRemovable(documentType, model, uuids, req, client = prisma) {
	if (!documentHasInflow(documentType) || !uuids?.length) return;
	const docs = await client[model].findMany({
		where: { uuid: { in: uuids } },
		select: { uuid: true, organizationUuid: true, posted: true, deletedAt: true },
	});
	for (const d of docs) {
		if (!d.posted || d.deletedAt || !checkOwnership(d, req)) continue;
		await assertStockAfterChange(documentType, d.uuid, null, client);
	}
}

/**
 * Express-middleware перед общим обработчиком удаления: DELETE /:id и POST /batch-delete
 * ({ uuids }). Нехватка остатка → 409, иначе — дальше.
 */
export function requireStockRemovable(documentType, model, client = prisma) {
	return async (req, res, next) => {
		try {
			let uuids = [];
			if (req.params?.id !== undefined) {
				const n = Number(req.params.id);
				const where = !isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(req.params.id) };
				const doc = await client[model].findUnique({ where, select: { uuid: true } });
				if (doc) uuids = [doc.uuid];
			} else if (Array.isArray(req.body?.uuids)) {
				uuids = req.body.uuids.filter((u) => typeof u === "string" && u);
			}
			await assertDocumentsRemovable(documentType, model, uuids, req, client);
			return next();
		} catch (err) {
			if (respondStockError(err, res)) return;
			console.error(`requireStockRemovable(${documentType}) error:`, err);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	};
}

/**
 * После удаления проведённого документа — пересчёт себестоимости хвоста (в фоне):
 * удаление задним числом меняет COGS последующих документов.
 */
export async function recomputeAfterDelete(doc, client = prisma) {
	if (!doc?.posted || !doc.organizationUuid || !doc.date) return;
	await recomputeIfRetroactive({ organizationUuid: doc.organizationUuid, date: doc.date }, client);
}

export default { commitDocumentHeader, assertDocumentsRemovable, requireStockRemovable, recomputeAfterDelete };
