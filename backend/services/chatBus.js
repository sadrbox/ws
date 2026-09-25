// ─────────────────────────────────────────────────────────────────────────────
// Шина событий реального времени (E4, collaboration).
//
// Публикует событие в канал организации и доставляет всем SSE-подписчикам этой
// организации. Обслуживает и чат, и уведомления (назначение задачи и т.п.) — одна
// инфраструктура, не две.
//
// МЕЖДУ ПРОЦЕССАМИ — Postgres LISTEN/NOTIFY (25.09). В проде бэкенд — кластер из четырёх
// воркеров pm2: подписчик SSE сидит в одном воркере, а событие публикует тот, куда пришёл
// запрос. EventEmitter воркера о чужих событиях не знает — чат и уведомления терялись бы в
// трёх случаях из четырёх. Поэтому в кластере событие, кроме своих подписчиков, уходит в канал
// Postgres, а каждый воркер слушает канал и раздаёт пришедшее своим подписчикам. Redis не
// нужен: Postgres уже есть.
//
//   • Свои подписчики получают событие сразу, как раньше, без базы. Своё же уведомление,
//     вернувшееся из канала, отбрасывается по метке процесса — дублей нет.
//   • У процесса одно отдельное соединение для LISTEN/NOTIFY, не из пула: LISTEN живёт в
//     сессии, а пул отдаёт соединения кому попало. Открывается при первой подписке или
//     публикации; оборвалось — переоткрывается с паузой. События, пришедшие в разрыв,
//     теряются: для «реального времени» это приемлемо — уведомления хранятся и дочитываются
//     опросом, а чат перечитывается при открытии.
//   • NOTIFY берёт меньше 8000 байт, а сообщение чата бывает длиннее: такое событие режется
//     на части, которые уходят одним запросом (одной транзакцией) и собираются на приёме.
//   • Одиночный процесс (разработка, pm2 fork) канал не трогает вовсе — только EventEmitter.
// ─────────────────────────────────────────────────────────────────────────────
import cluster from "node:cluster";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import pg from "pg";
import { logger } from "./logger.js";

/** Канал Postgres. */
const CHANNEL = "aleppo_bus";
/** Часть — с запасом до предела NOTIFY (8000 байт) на заголовок части. */
const CHUNK_BYTES = 7_000;
/** Больше между процессами не шлём (свои подписчики событие получат): это ошибка публикующего. */
const MAX_EVENT_BYTES = 1_000_000;
/** Сколько ждать недостающие части длинного события. */
const PARTS_TTL_MS = 30_000;
/** Паузы переподключения после обрыва. */
const RECONNECT_MS = [1_000, 5_000, 15_000, 30_000];

/** Имя канала организации. */
const channelOf = (organizationUuid) => `org:${organizationUuid}`;

/** Соединение шины по умолчанию: та же база, что у приложения, но мимо его пула. */
async function connectDefault() {
	const client = new pg.Client({
		connectionString: process.env.DATABASE_URL,
		// По имени соединение видно в pg_stat_activity.
		application_name: `aleppo-bus${cluster.isWorker ? `-${cluster.worker?.id ?? ""}` : ""}`,
		keepAlive: true,
		connectionTimeoutMillis: 10_000,
	});
	await client.connect();
	return client;
}

/** Разрезать строку на части не длиннее maxBytes в UTF-8, не разрывая символ. */
export function splitUtf8(text, maxBytes) {
	const out = [];
	let cur = "";
	let size = 0;
	for (const ch of text) {
		const n = Buffer.byteLength(ch);
		if (size + n > maxBytes && cur) {
			out.push(cur);
			cur = "";
			size = 0;
		}
		cur += ch;
		size += n;
	}
	if (cur || !out.length) out.push(cur);
	return out;
}

/**
 * Шина процесса. Фабрика — ради тестов: два «воркера» в одном процессе — две шины.
 *
 * @param {object} [opts]
 * @param {() => Promise<{query: Function, on: Function, end: Function}>} [opts.connect]
 * @param {boolean} [opts.clustered] процесс — воркер кластера: события ходят через Postgres
 * @param {{warn?: Function, info?: Function}} [opts.log]
 * @param {number[]} [opts.reconnectMs]
 */
export function createBus({ connect = connectDefault, clustered = cluster.isWorker, log = logger("bus"), reconnectMs = RECONNECT_MS } = {}) {
	const emitter = new EventEmitter();
	// Подписчиков на организацию может быть много (все открытые вкладки всех
	// пользователей с доступом) — снимаем дефолтный лимит в 10, иначе Node сыплет
	// предупреждениями о «возможной утечке».
	emitter.setMaxListeners(0);

	/** Метка процесса: своё уведомление, вернувшееся из канала, узнаётся по ней. */
	const origin = randomBytes(6).toString("hex");
	let seq = 0;
	let client = null;
	let opening = null;
	let retryTimer = null;
	let attempt = 0;
	let closed = false;
	/** Части длинных событий: id → {parts, got, at}. */
	const pending = new Map();

	const deliver = (organizationUuid, event) => emitter.emit(channelOf(organizationUuid), event);

	function receive(payload) {
		// «метка|id|номер|всего|данные» — данные могут содержать «|», поэтому режем только заголовок.
		const parts = String(payload).split("|");
		if (parts.length < 5) return;
		const [from, id, idx, total] = parts;
		if (from === origin) return; // своё — уже доставлено при публикации
		const data = parts.slice(4).join("|");
		const n = Number(total);
		let text = data;
		if (n > 1) {
			const now = Date.now();
			for (const [k, v] of pending) if (now - v.at > PARTS_TTL_MS) pending.delete(k);
			const key = `${from}|${id}`;
			const entry = pending.get(key) ?? { parts: new Array(n), got: 0, at: now };
			if (entry.parts[Number(idx)] === undefined) {
				entry.parts[Number(idx)] = data;
				entry.got++;
			}
			pending.set(key, entry);
			if (entry.got < n) return;
			pending.delete(key);
			text = entry.parts.join("");
		}
		try {
			const { org, event } = JSON.parse(text);
			if (org) deliver(org, event);
		} catch (e) {
			log.warn?.(`шина: событие из канала не разобрано: ${e?.message || e}`);
		}
	}

	function scheduleReconnect() {
		if (closed || retryTimer) return;
		const delay = reconnectMs[Math.min(attempt, reconnectMs.length - 1)];
		attempt++;
		retryTimer = setTimeout(() => {
			retryTimer = null;
			open().then(
				() => log.info?.("шина: соединение восстановлено"),
				() => scheduleReconnect(),
			);
		}, delay);
		retryTimer.unref?.();
	}

	function lost(c, reason) {
		if (client !== c) return;
		client = null;
		log.warn?.(`шина: соединение оборвано (${reason}) — события других процессов не приходят до переподключения`);
		c.end().catch(() => {});
		scheduleReconnect();
	}

	async function open() {
		if (client) return client;
		opening ??= (async () => {
			const c = await connect();
			c.on("notification", (msg) => { if (msg?.channel === CHANNEL) receive(msg.payload); });
			c.on("error", (e) => lost(c, e?.message || "ошибка соединения"));
			c.on("end", () => lost(c, "соединение завершено"));
			try {
				await c.query(`LISTEN ${CHANNEL}`);
			} catch (e) {
				c.end().catch(() => {});
				throw e;
			}
			if (closed) {
				c.end().catch(() => {});
				throw new Error("шина закрыта");
			}
			client = c;
			attempt = 0;
			return c;
		})().finally(() => { opening = null; });
		return opening;
	}

	async function forward(organizationUuid, event) {
		let text;
		try {
			text = JSON.stringify({ org: organizationUuid, event });
		} catch (e) {
			log.warn?.(`шина: событие «${event?.type}» не сериализуется: ${e?.message || e}`);
			return;
		}
		if (Buffer.byteLength(text) > MAX_EVENT_BYTES) {
			log.warn?.(`шина: событие «${event?.type}» больше ${MAX_EVENT_BYTES} байт — в другие процессы не ушло`);
			return;
		}
		const id = (seq++).toString(36);
		const chunks = splitUtf8(text, CHUNK_BYTES);
		const payloads = chunks.map((d, i) => `${origin}|${id}|${i}|${chunks.length}|${d}`);
		try {
			const c = await open();
			// Все части — одним запросом: одна транзакция, и подписчики получат их вместе.
			const sql = `SELECT ${payloads.map((_, i) => `pg_notify($1, $${i + 2})`).join(", ")}`;
			await c.query(sql, [CHANNEL, ...payloads]);
		} catch (e) {
			log.warn?.(`шина: событие «${event?.type}» не ушло в другие процессы: ${e?.message || e}`);
			if (!client) scheduleReconnect();
		}
	}

	/**
	 * Опубликовать событие в канал организации.
	 * @param {string} organizationUuid
	 * @param {{ type: string, [k: string]: unknown }} event — { type: "chat" | "task" | … }
	 */
	function publish(organizationUuid, event) {
		if (!organizationUuid) return;
		deliver(organizationUuid, event);
		if (clustered && !closed) void forward(organizationUuid, event);
	}

	/**
	 * Подписаться на события НЕСКОЛЬКИХ организаций (доступных пользователю).
	 * @param {string[]} organizationUuids
	 * @param {(event: object) => void} onEvent
	 * @returns {() => void} отписка
	 */
	function subscribe(organizationUuids, onEvent) {
		const orgs = [...new Set(organizationUuids.filter(Boolean))];
		for (const o of orgs) emitter.on(channelOf(o), onEvent);
		// Слушать канал — с первой подписки: воркеру без подписчиков чужие события не нужны.
		if (clustered && !closed) open().catch(() => scheduleReconnect());
		return () => {
			for (const o of orgs) emitter.off(channelOf(o), onEvent);
		};
	}

	/** Закрыть соединение шины (остановка процесса, тесты). */
	async function close() {
		closed = true;
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = null;
		const c = client;
		client = null;
		if (c) await c.end().catch(() => {});
	}

	return { publish, subscribe, close, _state: () => ({ connected: !!client, pending: pending.size, origin }) };
}

const bus = createBus();

export const publish = bus.publish;
export const subscribe = bus.subscribe;

export default { publish, subscribe };
