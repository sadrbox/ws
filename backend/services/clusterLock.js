// Блокировка задачи между процессами (24.09; соединение — 25.09).
//
// ЗАЧЕМ. В проде бэкенд поднимается кластером на четыре воркера pm2 — это четыре планировщика,
// то есть четыре одновременных `pg_dump` одной базы и четыре чистки журнала. Каждый сам по себе
// безобиден, вместе — нагрузка на диск и БД в самый неподходящий момент: стартуют они синхронно.
//
// ПОЧЕМУ ADVISORY-LOCK, А НЕ ФЛАГ В ТАБЛИЦЕ. Лок живёт в СЕССИИ и снимается сам, когда
// соединение обрывается. Упавший на середине бэкапа воркер не оставит задачу заблокированной
// навсегда — а именно так ведёт себя флаг в таблице, и чинить его приходится руками в тот
// момент, когда уже не до того.
//
// СВОЁ СОЕДИНЕНИЕ, А НЕ ПУЛ (25.09). Сессионный лок принадлежит СОЕДИНЕНИЮ: взять и снять его надо в
// одном и том же. Первая версия брала и снимала через пул Prisma, и снятие уходило в соседнее
// соединение: Postgres отвечал «you don't own a lock» (предупреждение в журнале), а лок оставался
// на первом соединении, пока пул не закроет его по простою. Всё это время задачу не мог взять ни один
// воркер, а закрытие по простою посреди долгой задачи (бэкап идёт в `pg_dump`, пулом не пользуется)
// снимало лок, пока задача ещё шла.
//
// Поэтому у процесса ОДНО отдельное соединение для блокировок:
//   • взять и снять — всегда в нём, лок держится ровно столько, сколько идёт задача;
//   • не из пула приложения: задачи сами берут соединения из пула, и держи каждая ещё одно на время
//     работы, десяток одновременных задач выбрал бы пул до дна и встал бы в ожидании сам себя;
//   • одно на процесс, а не на задачу: сессия держит сколько угодно разных локов, запросы «взять» и
//     «снять» — миллисекунды. Четыре воркера — четыре соединения, а не четыре на число задач.
// Соединение оборвалось — Postgres сам снял все его локи; идущие задачи дорабатывают без защиты
// (прервать их нельзя — пишем в журнал), следующее взятие откроет новое соединение.
//
// ОШИБКА САМОЙ БЛОКИРОВКИ (база недоступна для нового соединения). В одиночном процессе задача
// выполняется без блокировки: там она не нужна, и её недоступность не должна отменять бэкап. В
// кластере — пропуск запуска: следующий тик повторит, а четыре бэкапа разом — ровно то, от чего
// блокировка защищает.
import cluster from "node:cluster";
import pg from "pg";
import { logger } from "./logger.js";

/** Своё пространство ключей, чтобы не столкнуться с локом миграций AI-сервиса (7213001). */
const NAMESPACE = 7213002;

/** Срок запроса и подключения: взять или снять лок — миллисекунды; дольше — соединение не живо. */
const QUERY_TIMEOUT_MS = 10_000;

/** Ключ из имени задачи: одно и то же число во всех воркерах. */
export function lockKeyOf(name) {
	let h = 0;
	for (let i = 0; i < String(name).length; i++) h = (Math.imul(31, h) + String(name).charCodeAt(i)) | 0;
	return h;
}

/** Соединение блокировок по умолчанию: та же база, что у приложения, но мимо его пула. */
async function connectDefault() {
	const client = new pg.Client({
		connectionString: process.env.DATABASE_URL,
		// По имени соединение видно в pg_stat_activity: чьи это локи — вопрос первый при разборе.
		application_name: `aleppo-locks${cluster.isWorker ? `-${cluster.worker?.id ?? ""}` : ""}`,
		// Соединение подолгу молчит между задачами: keep-alive замечает оборванное сетью.
		keepAlive: true,
		connectionTimeoutMillis: QUERY_TIMEOUT_MS,
		query_timeout: QUERY_TIMEOUT_MS,
	});
	await client.connect();
	return client;
}

/**
 * Сессия блокировок процесса: одно соединение, открывается при первой задаче, после обрыва —
 * заново при следующей. Фабрика — ради тестов: два «воркера» в одном процессе — две сессии.
 *
 * @param {object} [opts]
 * @param {() => Promise<{query: Function, on: Function, end: Function}>} [opts.connect] открыть соединение
 * @param {boolean} [opts.clustered] процесс — воркер кластера (ошибка блокировки → пропуск запуска)
 * @param {{warn?: Function}} [opts.log]
 */
export function createLockSession({ connect = connectDefault, clustered = cluster.isWorker, log = logger("cluster-lock") } = {}) {
	let client = null;
	let opening = null;
	/** Номер соединения: лок, взятый в прежнем, снимать нечем и незачем — его снял обрыв. */
	let generation = 0;
	/** Локи, взятые (или берущиеся) этим процессом: ключ → номер соединения. */
	const held = new Map();

	/** Закрыть соединение: Postgres снимет все его локи. */
	function drop(reason) {
		const c = client;
		if (!c) return;
		client = null;
		generation++;
		if (held.size) {
			log.warn?.(`соединение блокировок закрыто (${reason}): локи сняты, без защиты дорабатывают ${held.size} задач(и)`);
		}
		c.end().catch(() => {});
	}

	async function open() {
		if (client) return client;
		// Одновременно просящие ждут одно открытие, а не открывают по соединению каждый.
		opening ??= (async () => {
			const c = await connect();
			c.on("error", (e) => { if (client === c) drop(e?.message || "ошибка соединения"); });
			c.on("end", () => { if (client === c) drop("соединение завершено"); });
			client = c;
			return c;
		})().finally(() => { opening = null; });
		return opening;
	}

	/** Взять лок; вернёт номер соединения или null (лок держит другой процесс). */
	async function tryLock(key) {
		const c = await open();
		const gen = generation;
		try {
			const r = await c.query("SELECT pg_try_advisory_lock($1::int, $2::int) AS ok", [NAMESPACE, key]);
			return r?.rows?.[0]?.ok === true ? gen : null;
		} catch (e) {
			// Соединение в неизвестном состоянии (могло и взять лок): закрываем — так лок точно снят.
			if (client === c) drop(e?.message || "ошибка запроса");
			throw e;
		}
	}

	async function unlock(key, gen) {
		held.delete(key);
		const c = client;
		if (!c || gen !== generation) return; // соединение, в котором брали, закрыто — лок снят вместе с ним
		try {
			const r = await c.query("SELECT pg_advisory_unlock($1::int, $2::int) AS ok", [NAMESPACE, key]);
			if (r?.rows?.[0]?.ok !== true) log.warn?.(`лок ${key} не найден при снятии`);
		} catch (e) {
			// Снять не удалось — закрываем соединение: лок уйдёт вместе с ним, а не повиснет.
			if (client === c) drop(e?.message || "ошибка снятия");
		}
	}

	/**
	 * Выполнить `run` под блокировкой. Лок не получен — задачу уже ведёт другой процесс, и делать её
	 * вторым нечего: пропускаем тик, а не ждём (следующий всё равно будет).
	 */
	async function withLock(name, run, onError = null) {
		const key = lockKeyOf(name);
		// Та же задача уже идёт в этом процессе. Спросить Postgres здесь нельзя: сессионный лок
		// повторно входим, и своему же соединению он ответил бы «да».
		if (held.has(key)) return undefined;
		held.set(key, null);
		let gen;
		try {
			gen = await tryLock(key);
		} catch (e) {
			held.delete(key);
			if (clustered) {
				onError?.(`${name}: блокировка недоступна — запуск пропущен (без неё задачу выполнили бы все воркеры)`, e?.message || e);
				return undefined;
			}
			onError?.(`${name}: блокировка недоступна, выполняю без неё`, e?.message || e);
			return run();
		}
		if (gen === null) {
			held.delete(key);
			return undefined;
		}
		held.set(key, gen);
		try {
			return await run();
		} finally {
			await unlock(key, gen);
		}
	}

	/** Закрыть соединение (остановка процесса, тесты). */
	async function close() {
		const c = client;
		client = null;
		generation++;
		held.clear();
		if (c) await c.end().catch(() => {});
	}

	return { withLock, close, _state: () => ({ connected: !!client, generation, held: [...held.keys()] }) };
}

let shared = null;

/** Выполнить `run` под блокировкой процесса (одна сессия блокировок на процесс). */
export function withClusterLock(name, run, onError = null) {
	shared ??= createLockSession();
	return shared.withLock(name, run, onError);
}

/** Закрыть соединение блокировок процесса. */
export async function closeClusterLocks() {
	const s = shared;
	shared = null;
	if (s) await s.close();
}

export default { lockKeyOf, createLockSession, withClusterLock, closeClusterLocks };
