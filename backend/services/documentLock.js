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
import { dbPoolConfig } from "../utils/dbPoolConfig.js";

/** Пространства ключей advisory-локов (clusterLock — 7213002, миграции ИИ — 7213001). */
const DOCUMENT_NAMESPACE = 7213003;
const STOCK_NAMESPACE = 7213004;
const CASH_NAMESPACE = 7213005;

/**
 * Параметры интерактивной транзакции перепроведения. По умолчанию у Prisma 5 с на всю
 * транзакцию — пересбор себестоимости длинной истории в него не укладывается.
 */
export const POSTING_TX_OPTIONS = Object.freeze({ maxWait: 15_000, timeout: 120_000 });

// ─── Пределы времени в транзакциях проведения (КР-15 аудита 27.09) ─────────────
// БЫЛО. Пул задаёт statement_timeout 30 с (DB_STATEMENT_TIMEOUT_MS), а ожидание
// pg_advisory_xact_lock — тоже запрос. Документ или товар, занятый другой транзакцией
// проведения (она может идти до 120 с), давал ожидающему 57014 → «Ошибка сервера», а
// пересбор большого документа обрывался на середине (откат, 500).
// СТАЛО. Транзакция проведения при первой блокировке задаёт себе пределы (SET LOCAL — до
// конца транзакции):
//   • statement_timeout — как у самой транзакции (120 с), не меньше предела пула; пул без
//     предела (DB_STATEMENT_TIMEOUT_MS=0) так и остаётся без предела;
//   • lock_timeout — POSTING_LOCK_WAIT_MS: дольше ждать чужую блокировку незачем — отказ
//     DocumentBusyError → 409 «занят другим пользователем, повторите».
/** Сколько транзакция проведения ждёт чужую блокировку документа/товара/кассы, мс. */
export const POSTING_LOCK_WAIT_MS = 20_000;
/** Предел одного запроса для снимка себестоимости и тяжёлых отчётов (withLongStatements), мс. */
export const LONG_STATEMENT_MS = 180_000;

/** statement_timeout не ниже предела пула; 0 у пула («без предела») сохраняется. */
export function statementTimeoutFor(ms) {
	const base = dbPoolConfig(process.env, { warn: () => {} }).statement_timeout;
	return base === 0 ? 0 : Math.max(base, ms);
}

/** Отказ: блокировку держит другая транзакция дольше POSTING_LOCK_WAIT_MS (409). */
export class DocumentBusyError extends Error {
	constructor(message = "Документ занят другим пользователем — повторите через минуту") {
		super(message);
		this.name = "DocumentBusyError";
		this.code = "DOCUMENT_BUSY";
		this.status = 409;
		this.errors = [message];
	}
}

/**
 * SQLSTATE ошибки Postgres. Prisma 7 + adapter-pg отдаёт её по-разному: сырой запрос —
 * PrismaClientKnownRequestError P2010 с meta.driverAdapterError.cause, запрос модели (update,
 * delete) — сам DriverAdapterError с cause (проверено на одноразовой базе), либо как есть.
 */
function pgCodeOf(e) {
	const cause = e?.meta?.driverAdapterError?.cause ?? (e?.name === "DriverAdapterError" ? e.cause : null);
	return cause?.originalCode ?? cause?.code ?? e?.meta?.code ?? (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : null);
}

/**
 * Не дождались блокировки внутри транзакции проведения (lock_timeout, 55P03): кроме advisory-локов
 * документа/товара/кассы это и блокировка строки, которую держит чужая транзакция. Роутеры
 * отвечают на неё тем же 409 «занят, повторите» (respondPostingError), а не 500.
 */
export function isLockWaitError(err) {
	return pgCodeOf(err) === "55P03";
}

// Транзакции, которым пределы уже заданы (один tx-клиент на транзакцию; повторные локи — без SET).
const tuned = new WeakSet();

/** Задать пределы транзакции проведения (один раз на транзакцию). */
export async function applyPostingTimeouts(tx) {
	if (typeof tx?.$executeRawUnsafe !== "function") return; // мок без SQL
	if (tuned.has(tx)) return;
	// SET не принимает параметров — подставляем целые числа сами.
	await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${statementTimeoutFor(POSTING_TX_OPTIONS.timeout)}`);
	await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${POSTING_LOCK_WAIT_MS}`);
	tuned.add(tx);
}

/** Корневой ли это клиент (умеет открывать транзакции), а не tx внутри транзакции. */
export function isRootClient(client) {
	return typeof client?.$transaction === "function";
}

async function xactLock(tx, namespace, key, busyMessage) {
	if (typeof tx?.$executeRawUnsafe !== "function") return; // мок без SQL
	await applyPostingTimeouts(tx);
	try {
		// $executeRaw, а не $queryRaw: функция возвращает void, который Prisma не десериализует.
		await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1::int, $2::int)", namespace, key);
	} catch (err) {
		// Не дождались: lock_timeout (55P03) или statement_timeout (57014), если его задали короче.
		const code = pgCodeOf(err);
		if (code === "55P03" || code === "57014") throw new DocumentBusyError(busyMessage);
		throw err;
	}
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
	for (const k of keys) {
		await xactLock(tx, STOCK_NAMESPACE, lockKeyOf(k), "Остаток этого товара сейчас проводит другой документ — повторите через минуту");
	}
}

/**
 * Взять транзакционный лок кассы организации (КР-13 аудита 27.09): проверка остатка кассы,
 * запись ордера и его проводки идут под ним, и два расходных ордера одной организации
 * больше не проходят проверку одновременно. Несколько организаций — в отсортированном порядке.
 */
export async function lockCash(tx, organizationUuids) {
	const orgs = [...new Set((Array.isArray(organizationUuids) ? organizationUuids : [organizationUuids]).filter(Boolean))].sort();
	for (const org of orgs) {
		await xactLock(tx, CASH_NAMESPACE, lockKeyOf(`cash:${org}`), "Кассу организации сейчас проводит другой документ — повторите через минуту");
	}
}

/**
 * Выполнить fn(tx) с поднятым пределом запроса (КР-15): снимок себестоимости и тяжёлые отчёты
 * на большой истории не укладываются в 30 с пула. Корневой клиент — своя транзакция с
 * SET LOCAL statement_timeout; передан tx — работаем в нём как есть.
 */
export async function withLongStatements(client, fn, { timeoutMs = LONG_STATEMENT_MS } = {}) {
	if (!isRootClient(client)) return fn(client);
	const ms = statementTimeoutFor(timeoutMs);
	return client.$transaction(async (tx) => {
		if (typeof tx?.$executeRawUnsafe === "function") await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${ms}`);
		return fn(tx);
	}, { maxWait: POSTING_TX_OPTIONS.maxWait, timeout: ms === 0 ? 30 * 60_000 : ms + 10_000 });
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

export default { POSTING_TX_OPTIONS, POSTING_LOCK_WAIT_MS, LONG_STATEMENT_MS, DocumentBusyError, isLockWaitError, applyPostingTimeouts, isRootClient, lockDocument, lockStockPairs, lockCash, withLongStatements, inDocumentTransaction };
