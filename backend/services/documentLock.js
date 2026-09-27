// ─────────────────────────────────────────────────────────────────────────────
// Перепроведение документа — в ОДНОЙ транзакции под блокировкой документа (У2 аудита
// 26.09).
//
// БЫЛО. Пересбор движений и проводок — «удалить прежние, вставить новые» — шёл без
// транзакции и без блокировки. Два одновременных перепроведения одного документа
// (двойное «Провести», авто-пересчёт одновременно с сохранением, два пользователя)
// удаляли прежнее оба, а вставляли каждый своё: ПКО на 1000 давал проводок на 2000.
// Сбой посередине оставлял документ проведённым без движений.
//
// СТАЛО. inDocumentTransaction(client, тип, uuid, fn):
//   • клиент — корневой prisma → открываем транзакцию и в ней берём
//     pg_advisory_xact_lock(тип, uuid): второе перепроведение того же документа ЖДЁТ
//     первое, а не перемешивается с ним. Лок транзакционный — снимается сам при
//     фиксации/откате, повиснуть не может;
//   • клиент — уже транзакция (tx) → берём тот же лок в ней (повторный вход в свой же лок
//     разрешён) и работаем в ней: вызывающий сам решает, что ещё входит в эту же операцию
//     (шапка, строки, сумма документа).
// Блокировки товаров (lockStockPairs) сериализуют параллельный расход одного товара со
// склада: две продажи последней единицы больше не проходят проверку обе.
//
// Мок-клиенты тестов без $executeRawUnsafe/$transaction работают как раньше — без
// блокировки и без транзакции.
// ─────────────────────────────────────────────────────────────────────────────
import { lockKeyOf } from "./clusterLock.js";

/** Пространства ключей advisory-локов (clusterLock — 7213002, миграции ИИ — 7213001). */
const DOCUMENT_NAMESPACE = 7213003;
const STOCK_NAMESPACE = 7213004;

/**
 * Параметры интерактивной транзакции перепроведения. По умолчанию у Prisma 5 с на всю
 * транзакцию — пересбор себестоимости длинной истории в него не укладывается.
 */
export const POSTING_TX_OPTIONS = Object.freeze({ maxWait: 15_000, timeout: 120_000 });

/** Корневой ли это клиент (умеет открывать транзакции), а не tx внутри транзакции. */
export function isRootClient(client) {
	return typeof client?.$transaction === "function";
}

async function xactLock(tx, namespace, key) {
	if (typeof tx?.$executeRawUnsafe !== "function") return; // мок без SQL
	// $executeRaw, а не $queryRaw: функция возвращает void, который Prisma не десериализует.
	await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::int, $2::int)", namespace, key);
}

/** Взять транзакционный лок документа в текущей транзакции. */
export function lockDocument(tx, documentType, documentUuid) {
	return xactLock(tx, DOCUMENT_NAMESPACE, lockKeyOf(`${documentType}:${documentUuid}`));
}

/**
 * Взять транзакционные локи пар «товар|склад» — в отсортированном порядке, чтобы две
 * транзакции с пересекающимися наборами не ждали друг друга по кругу.
 */
export async function lockStockPairs(tx, pairs) {
	const keys = [...new Set((pairs ?? []).map((p) => `${p.productUuid ?? ""}|${p.warehouseUuid ?? ""}`))].sort();
	for (const k of keys) await xactLock(tx, STOCK_NAMESPACE, lockKeyOf(k));
}

/**
 * Выполнить fn(tx) в транзакции под блокировкой документа (см. шапку).
 * Ошибка fn откатывает транзакцию и пробрасывается вызывающему.
 */
export async function inDocumentTransaction(client, documentType, documentUuid, fn, options = POSTING_TX_OPTIONS) {
	if (isRootClient(client)) {
		return client.$transaction(async (tx) => {
			await lockDocument(tx, documentType, documentUuid);
			return fn(tx);
		}, options);
	}
	await lockDocument(client, documentType, documentUuid);
	return fn(client);
}

export default { POSTING_TX_OPTIONS, isRootClient, lockDocument, lockStockPairs, inDocumentTransaction };
