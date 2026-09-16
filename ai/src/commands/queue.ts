// Очередь команд агентам.
//
// Хранится в PostgreSQL — команда переживает перезапуск сервиса и отсутствие агента.
// Long-poll агента не крутит базу в цикле: ожидающие запросы висят на in-process
// «звонке» (EventEmitter по agentId) и просыпаются, когда что-то кладут в очередь. При
// нескольких инстансах сервиса звонок сработает только в том, куда попал enqueue, —
// остальные заметят команду на следующем цикле poll (максимум POLL_MAX_WAIT секунд).
// Для MVP с одним инстансом это ровно ноль задержки.
//
// ИДЕМПОТЕНТНОСТЬ. requestId уходит в 1С как есть; повтор команды с тем же requestId —
// не дубль документа, а тот же результат. Поэтому очередь не пытается дедуплицировать
// команды по содержимому: это уже сделано там, где создаётся документ.

import { EventEmitter } from "node:events";
import type { Db } from "../db/pool.ts";

// `canceled` пишет queue.cancel — тип обязан его знать: иначе проверка «команда отменена»
// (S2) выглядит для компилятора невозможной.
export type CommandState = "queued" | "dispatched" | "done" | "failed" | "expired" | "canceled";

export type EnqueueInput = {
	agentId: string;
	organizationUuid: string;
	/** Имя базы в кластере; null — агент протокола v1, у которого база одна (DEFAULT_BASE_KEY). */
	baseKey?: string | null;
	type: string;
	payload: Record<string, unknown>;
	requestId?: string | null;
	userUuid?: string | null;
	conversationId?: string | null;
	/** Срок ВЫПОЛНЕНИЯ, от выдачи агенту (С2). */
	ttlSeconds?: number;
	/**
	 * Сколько команда может ЖДАТЬ ОЧЕРЕДИ до выдачи (С2). По умолчанию — как срок выполнения.
	 * Групповые задания ждут дольше: сто баз при одном месте идут часами.
	 */
	queueWaitSeconds?: number;
	/**
	 * Идёт ли команда внутрь базы (С1) — занимает место базы и агента. По умолчанию — есть ли
	 * база, как прежде; кластерные команды с базой обязаны передавать `false`.
	 */
	inBase?: boolean;
	/**
	 * Меньше — раньше. 0 (по умолчанию) — то, что человек запросил сейчас и ждёт на
	 * экране; 10 — пакетные операции по многим базам: их запускают и уходят, и они не
	 * должны загораживать одиночный запрос.
	 */
	priority?: number;
};

export type CommandRow = {
	id: string;
	agent_id: string;
	organization_uuid: string;
	base_key: string | null;
	request_id: string | null;
	type: string;
	payload: Record<string, unknown>;
	state: CommandState;
	user_uuid: string | null;
	conversation_id: string | null;
	result_status: string | null;
	result: unknown;
	error: { code: string; message: string; details?: unknown } | null;
	onec_http_status: number | null;
	created_at: Date;
	dispatched_at: Date | null;
	finished_at: Date | null;
	expires_at: Date;
	batch_id?: string | null;
	in_base?: boolean | null;
	ttl_seconds?: number | null;
	attempt?: number;
	retried_by?: string | null;
	/** Раньше этого времени не выдавать (повтор «база занята» с паузой, С19). */
	available_at?: Date | null;
	/** Результат пришёл после истечения срока (С21). */
	late?: boolean;
	/** Когда агент начал работу по команде (С33). */
	started_at?: Date | null;
	/** Когда агент последний раз подтвердил, что команда выполняется (С33). */
	running_seen_at?: Date | null;
};

/** Потолок продления от выдачи (С33): зациклившийся агент не держит команду вечно. */
export const RUNNING_LEASE_CAP_SECS = 24 * 3600;

/**
 * На сколько продлить срок выполняемой команды (С33): три периода heartbeat, не меньше 90 с. Период сервис
 * не знает (он в настройках агента) — берёт интервал с прошлого сигнала агента, не больше 5 мин: после
 * долгого молчания большой запас скрыл бы зависание.
 */
export function runningLeaseSecs(prevSeenAt: Date | string | null | undefined, now = Date.now()): number {
	const prev = prevSeenAt ? new Date(prevSeenAt).getTime() : NaN;
	const gap = Number.isFinite(prev) ? Math.max(0, (now - prev) / 1000) : 0;
	return Math.max(90, Math.round(Math.min(300, gap) * 3));
}

/** Сколько секунд истёкшая, но выданная команда без ответа ещё держит место (С3). */
export const DEFAULT_LATE_GRACE_SECS = 600;

/**
 * Пауза перед повтором «база занята» (С19): перед второй попыткой — 2 мин, перед третьей — 5.
 * Агент отвечает IB_BUSY за секунды; без паузы три попытки уходили раньше, чем в базе хоть что-то
 * менялось.
 */
export const BUSY_RETRY_DELAYS_SECS = [120, 300] as const;

/** Сколько попыток даётся команде задания, когда база занята (IB_BUSY, С10). */
export const BUSY_MAX_ATTEMPTS = 3;

/** Внутрь базы: явный признак, а у старых команд — как прежде, по наличию базы (С1). */
const IN_BASE = (a: string) => `COALESCE(${a}.in_base, ${a}.base_key IS NOT NULL)`;

/**
 * TIMEOUT АГЕНТА НЕ ЗНАЧИТ «РАБОТА ОКОНЧЕНА» (С18). Агент перестаёт ждать команду, а конфигуратор `1cv8`
 * работает дальше; пока он жив, агент держит базу (IB_BUSY) и снимает блокировку входа только после него.
 * Раньше такая команда сразу освобождала место: следующая команда задания или «Повторить неуспешные» уходили
 * агенту и получали отказ, сжигая повторы. Место держится, пока в снимке процессов агента есть процесс этой
 * команды (`commandId`, агент 01:06), и ещё 90 с после отказа — на задержку heartbeat.
 */
export const TIMEOUT_STILL_RUNNING = (a: string) => `(${a}.state = 'failed' AND ${a}.error->>'code' = 'TIMEOUT' AND (
	${a}.finished_at > now() - interval '90 seconds'
	OR EXISTS (SELECT 1 FROM agents ag, jsonb_array_elements(ag.processes) pr
	            WHERE ag.id = ${a}.agent_id AND pr->>'commandId' = ${a}.id)))`;

/**
 * ЗАНИМАЕТ ЛИ КОМАНДА МЕСТО (С3). Выданная — да. Истёкшая по сроку, но выданная и без ответа —
 * тоже, ещё `grace` секунд: агент мог продолжать работу, и выдать ему вторую команду внутрь базы
 * поверх первой значит повторить заклинивание, от которого место и защищает.
 */
const OCCUPIES = (a: string, graceParam: string) => `(${a}.state = 'dispatched' OR (
	${a}.state = 'expired' AND ${a}.dispatched_at IS NOT NULL AND ${a}.result_status IS NULL
	AND ${a}.error->>'code' = 'COMMAND_EXPIRED'
	AND ${a}.finished_at > now() - make_interval(secs => ${graceParam}::int)) OR ${TIMEOUT_STILL_RUNNING(a)})`;

/** Текст истечения: не дождалась очереди — это не «агент не на связи» (С2). */
const QUEUE_TIMEOUT_MESSAGE = "Команда не дождалась своей очереди у агента: он был занят другими командами. "
	+ "Повторите позже или разделите задание на части.";

/** Команда в формате протокола агента. */
export type WireCommand = {
	id: string; requestId?: string; baseKey?: string; type: string; payload: Record<string, unknown>;
	/**
	 * Срок команды (С31): агент ждёт свободного исполнителя ровно до него, а не по разнице сроков из
	 * контракта, — поздно дождавшаяся выполнилась бы, когда сервис уже объявил её просроченной.
	 */
	expiresAt?: string;
};

/**
 * Отказы «не выполнялась — повторите» (С19, С31, С25): в задании повторяются сами, с паузой. База
 * занята, агент занят другими командами, служба останавливалась до начала.
 */
// IB_TIMEOUT (С25): утилита не ответила за свой предел и снята — по контракту повтор допустим.
export const RETRY_LATER_CODES = new Set(["IB_BUSY", "AGENT_BUSY", "AGENT_STOPPING", "IB_TIMEOUT"]);

/**
 * «БАЗА ЗАНЯТА» ПО ТЕКСТУ ПЛАТФОРМЫ, а не только по коду (С38).
 *
 * Живой случай 16.09 на `_transition`: установку расширения не пустило фоновое задание — «Ошибка разделенного
 * доступа к базе данных. База данных заблокирована: … приложение: Фоновое задание», — но код пришёл общий.
 * Задание объявило «Не выполнено» и не повторило, хотя это ровно тот случай, ради которого повтор и сделан:
 * база освободится сама. Агент научится отвечать `IB_BUSY` (А39); до его обновления узнаём случай по тексту.
 */
const BUSY_TEXT = /разделен\w* доступ|разделённ\w* доступ|база данных заблокирована|монопольн|exclusive (?:access|mode)/i;

/** Отказ означает «база занята» — команду задания стоит повторить. */
export const isBusyFailure = (code: string | undefined | null, message: string | undefined | null): boolean =>
	RETRY_LATER_CODES.has(code ?? "") || BUSY_TEXT.test(message ?? "");

export type WireResult = {
	commandId: string;
	agentId: string;
	status: "SUCCESS" | "ERROR";
	result?: unknown;
	error?: { code: string; message: string; details?: unknown };
	startedAt?: string;
	finishedAt?: string;
	onecHttpStatus?: number;
};

/**
 * Подстановка учётных данных базы в момент ВЫДАЧИ команды.
 *
 * Возвращает пары «ключ базы → учётная запись» для указанных баз одного агента.
 * Зависимость передаётся снаружи: очередь не должна знать, что такое база и откуда
 * берутся пароли, — ей достаточно уметь спросить.
 */
export type AuthResolver = (agentId: string, baseKeys: string[]) =>
	Promise<Map<string, { user: string; password: string }>>;

export class CommandQueue {
	private readonly bell = new EventEmitter();
	private readonly db: Db;
	private closed = false;
	private authResolver: AuthResolver | null = null;

	/**
	 * Сколько команд внутрь баз агент получает одновременно. См. AGENT_IB_PARALLEL:
	 * значение по умолчанию — единица, и это защита, а не политика.
	 */
	private readonly ibParallel: number;

	/** Сколько секунд истёкшая, но выданная команда ещё держит место (С3). */
	private readonly lateGraceSecs: number;

	constructor(db: Db, ibParallel = 1, lateGraceSecs = DEFAULT_LATE_GRACE_SECS) {
		this.db = db;
		this.ibParallel = Math.max(1, ibParallel);
		this.lateGraceSecs = Math.max(0, lateGraceSecs);
		this.bell.setMaxListeners(1000);
	}

	/**
	 * Кто отвечает на вопрос «есть ли у этой базы своя учётная запись».
	 *
	 * Подставлять её при ПОСТАНОВКЕ команды нельзя: пароль осел бы в таблице команд, в
	 * журнале и в панели, где показывается payload. При выдаче он живёт ровно один HTTP-ответ
	 * агенту — тому, кто и так имеет доступ к базам.
	 */
	setAuthResolver(resolver: AuthResolver | null): void {
		this.authResolver = resolver;
	}

	/**
	 * Остановка: все висящие long-poll'ы просыпаются и уходят пустыми, к базе очередь больше
	 * не обращается. Вызывать ДО закрытия пула — иначе агент, ждавший команд, получит ошибку
	 * «pool after end» вместо пустого ответа.
	 */
	close(): void {
		this.closed = true;
		for (const name of this.bell.eventNames()) this.bell.emit(name);
	}

	async enqueue(input: EnqueueInput): Promise<CommandRow> {
		const id = "cmd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
		const ttl = Math.max(30, input.ttlSeconds ?? 3600);
		const queueWait = Math.max(30, input.queueWaitSeconds ?? ttl);
		const baseKey = input.baseKey ?? null;
		const inBase = input.inBase ?? baseKey !== null;
		// ON CONFLICT — по частичному уникальному индексу (agent_id, base_key, request_id) среди
		// НЕЗАВЕРШЁННЫХ команд: повторная постановка той же команды (двойное нажатие, ретрай HTTP)
		// возвращает уже стоящую в очереди, а не создаёт вторую. Идемпотентность самой операции
		// в 1С обеспечивает requestId — здесь мы защищаем только очередь.
		const r = await this.db.query<CommandRow>(
			// expires_at при постановке — предел ОЖИДАНИЯ очереди; срок выполнения (ttl_seconds)
			// отсчитывается заново при выдаче агенту (С2).
			`INSERT INTO commands (id, agent_id, organization_uuid, base_key, request_id, type, payload, user_uuid, conversation_id, expires_at, priority, in_base, ttl_seconds)
			 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now() + ($10 || ' seconds')::interval, $11, $12, $13)
			 ON CONFLICT (agent_id, COALESCE(base_key, ''), request_id)
			     WHERE request_id IS NOT NULL AND state IN ('queued', 'dispatched') DO NOTHING
			 RETURNING *`,
			[id, input.agentId, input.organizationUuid, baseKey, input.requestId ?? null, input.type,
				JSON.stringify(input.payload ?? {}), input.userUuid ?? null, input.conversationId ?? null, String(queueWait),
				input.priority ?? 0, inBase, ttl],
		);
		if (!r.rows[0]) {
			const existing = await this.db.query<CommandRow>(
				`SELECT * FROM commands
				  WHERE agent_id = $1 AND COALESCE(base_key, '') = COALESCE($2, '') AND request_id = $3
				    AND state IN ('queued', 'dispatched')
				  ORDER BY created_at LIMIT 1`,
				[input.agentId, baseKey, input.requestId ?? null],
			);
			if (existing.rows[0]) return existing.rows[0];
			throw new Error("команда не поставлена в очередь");
		}
		this.bell.emit(input.agentId);
		return r.rows[0];
	}

	/**
	 * Выдаёт агенту все ожидающие команды, при пустой очереди ждёт до waitSecs.
	 * Выдача атомарна: UPDATE ... WHERE state='queued' — два инстанса не отдадут одну команду дважды.
	 */
	/** `instanceId` — процесс агента, забирающий команды: по нему потом видно, чей ответ пропал. */
	async take(agentId: string, waitSecs: number, instanceId?: string | null): Promise<WireCommand[]> {
		const deadline = Date.now() + waitSecs * 1000;
		for (;;) {
			if (this.closed) return [];
			const batch = await this.dispatchQueued(agentId, instanceId ?? null);
			if (batch.length) return batch;
			const remaining = deadline - Date.now();
			if (remaining <= 0 || this.closed) return [];
			await this.waitForBell(agentId, Math.min(remaining, 5000));
		}
	}

	/**
	 * Просроченные команды — в `expired`, независимо от того, приходил ли агент.
	 *
	 * Раньше это делалось ТОЛЬКО при опросе очереди самим агентом. Пока агент на связи,
	 * разницы нет; стоит ему замолчать — и команда навсегда остаётся `queued`, а панель
	 * опрашивает её до своего пятнадцатиминутного предела: в консоли непрерывный поток
	 * запросов, на экране ничего. Срок истёк — значит выполнять её уже некому.
	 */
	/**
	 * Команды АГЕНТА, КОТОРОГО НЕТ, — закрываем, не дожидаясь их собственного срока.
	 *
	 * Живой случай: службу агента остановили на сервере 1С. Панель показывала операции
	 * «в работе», а через пятнадцать минут они закрывались по сроку с текстом про базу и
	 * журнал агента — хотя дело было не в базе, а в том, что забирать команду некому.
	 *
	 * ТОЛЬКО `queued`: их никто не начинал, и пока агент молчит, начать некому. Команды,
	 * которые агент уже ЗАБРАЛ, не трогаем — он мог уйти их выполнять и ответить позже
	 * (измерено: честный отказ приходил на 186-й секунде молчания). Их закроет свой срок.
	 *
	 * `silentSecs` — сколько агент должен молчать, чтобы счесть его отсутствующим.
	 * Перезапуск службы занимает секунды, поэтому короткая пауза ничего не значит.
	 */
	async expireOrphaned(silentSecs: number): Promise<number> {
		const r = await this.db.query(
			`UPDATE commands c
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(c.error, jsonb_build_object(
			          'code', 'AGENT_OFFLINE',
			          'message', 'Служба 1С-агента не на связи — забрать команду некому. '
			            || 'Проверьте, запущена ли она на сервере 1С.'))
			  FROM agents a
			 WHERE a.id = c.agent_id
			   AND c.state = 'queued'
			   AND (a.last_seen_at IS NULL OR a.last_seen_at < now() - make_interval(secs => $1::int))`,
			[silentSecs],
		);
		return r.rowCount ?? 0;
	}

	/**
	 * Команды, забранные ПРЕЖНИМ процессом агента, — закрываем сразу при регистрации нового.
	 *
	 * ЖИВОЙ СЛУЧАЙ 12.09 (23:14). Службу агента обновили. Забранная ею за десять секунд до
	 * остановки `IB_LIST_USERS` по базе `abdali` осталась без ответа: в spool попадают готовые
	 * РЕЗУЛЬТАТЫ, а прерванная посреди работы команда не оставляет ничего. При
	 * `AGENT_IB_PARALLEL = 1` эта одна мёртвая команда заняла единственное место внутрибазовых
	 * операций — и следующие двенадцать минут панель показывала «Выполняется» там, где не
	 * выполнялось ничего, пока не истёк пятнадцатиминутный срок.
	 *
	 * ПОЧЕМУ ПО ЭКЗЕМПЛЯРУ, А НЕ ПРОСТО ПО ФАКТУ РЕГИСТРАЦИИ. Агент регистрируется не только
	 * при старте: он повторяет регистрацию, когда отозвали токен и когда впервые получился
	 * вход в базу (`needs_register`). Закрывать по самому факту регистрации значило бы убивать
	 * СВОИ ЖЕ идущие команды — выгрузку базы, которая честно работает третий час. Разные
	 * процессы различает идентификатор экземпляра, который агент присылает сам.
	 *
	 * NULL в `dispatched_instance` — «не знаем, кто забрал» (команда выдана до миграции 021 или
	 * сборкой без заголовка). Такие не трогаем: догадка здесь хуже ожидания, их закроет срок.
	 */
	async failLostByRestart(agentId: string, instanceId: string): Promise<{ id: string; type: string; baseKey: string | null }[]> {
		if (!instanceId) return [];
		const r = await this.db.query<{ id: string; type: string; base_key: string | null }>(
			`UPDATE commands
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(error, jsonb_build_object(
			          'code', 'AGENT_RESTARTED',
			          'message', 'Служба 1С-агента перезапустилась, не ответив на команду. '
			            || 'Результат потерян — повторите операцию.'))
			  WHERE agent_id = $1 AND state = 'dispatched'
			    AND dispatched_instance IS NOT NULL AND dispatched_instance <> $2
			  RETURNING id, type, base_key`,
			[agentId, instanceId],
		);
		// Место в очереди освободилось — будим опрос, чтобы следующая команда ушла сразу.
		if (r.rowCount) this.bell.emit(agentId);
		return r.rows.map((x) => ({ id: x.id, type: x.type, baseKey: x.base_key }));
	}

	async expireOverdue(): Promise<number> {
		const r = await this.db.query(
			/*
			 * ПРИЧИНУ ЗАПИСЫВАЕМ СРАЗУ, пока известно состояние. После перевода в `expired`
			 * уже не отличить «агент не забрал» от «забрал и не ответил», а это два разных
			 * разговора: первое — про связь со службой, второе — про базу или про то, что
			 * операция дольше отведённого ей срока. Советовать чинить связь во втором
			 * случае — отправлять человека не туда.
			 */
			// Агента нет на связи — это закрывает expireOrphaned со своей причиной; здесь очередь
			// просто не дошла (С2).
			`UPDATE commands
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(error, jsonb_build_object(
			          'code', CASE WHEN state = 'queued' THEN 'COMMAND_QUEUE_TIMEOUT' ELSE 'COMMAND_EXPIRED' END,
			          'message', CASE WHEN state = 'queued'
			            THEN $1::text
			            ELSE 'Агент забрал команду, но не ответил за отведённое ей время. Связь тут ни при чём: проверьте базу и журнал агента — операция могла идти дольше своего срока.'
			          END))
			  WHERE state IN ('queued', 'dispatched') AND expires_at < now()`,
			[QUEUE_TIMEOUT_MESSAGE],
		);
		return r.rowCount ?? 0;
	}

	/**
	 * ОТМЕНА — только до начала выполнения.
	 *
	 * Команду, которую агент уже забрал, отменить нельзя: она выполняется на сервере 1С, и
	 * «отмена» в панели означала бы лишь то, что мы перестали ждать ответа, — а пользователь
	 * прочитал бы это как «операция не выполнена». Врать о состоянии чужой системы нельзя.
	 * Поэтому отменяются только `queued`: их ещё никто не начинал.
	 *
	 * Возвращает, сколько команд действительно отменено: ноль значит «не успели» — и это
	 * честный ответ, а не ошибка.
	 */
	async cancel(ids: string[], by: string): Promise<number> {
		if (!ids.length) return 0;
		const r = await this.db.query(
			`UPDATE commands
			    SET state = 'canceled', finished_at = now(),
			        error = jsonb_build_object(
			          'code', 'COMMAND_CANCELED',
			          'message', 'Команда отменена до начала выполнения.',
			          'details', jsonb_build_object('by', $2::text))
			  WHERE id = ANY($1::text[]) AND state = 'queued'`,
			[ids, by],
		);
		return r.rowCount ?? 0;
	}

	/** Отменить всё, что ещё не начато, в задании: групповую операцию останавливают целиком. */
	async cancelBatch(batchId: string, by: string): Promise<number> {
		const r = await this.db.query<{ id: string }>(
			`SELECT id FROM commands WHERE batch_id = $1 AND state = 'queued'`, [batchId],
		);
		return this.cancel(r.rows.map((x) => x.id), by);
	}

	/**
	 * ПРЕРВАТЬ НАЧАТУЮ КОМАНДУ (S4) — закрыть её самим, когда агент подтвердил, что снял задачу.
	 *
	 * Агент по прерванной команде результата не шлёт: задача снята, отвечать за неё некому.
	 * Без этого закрытия команда держала бы место внутрибазовых операций до своего срока — и
	 * вся очередь по всем базам стояла бы ровно так же, как до отмены.
	 *
	 * Условие `state = 'dispatched'`: итог, успевший прийти сам, правдив — прерывать нечего.
	 */
	async abort(id: string, by: string | null, note: string | null): Promise<boolean> {
		const r = await this.db.query<{ agent_id: string; base_key: string | null }>(
			`UPDATE commands
			    SET state = 'canceled', finished_at = now(),
			        error = jsonb_build_object(
			          'code', 'COMMAND_ABORTED',
			          'message', 'Команда прервана по запросу оператора',
			          'details', jsonb_build_object('by', $2::text, 'note', $3::text))
			  WHERE id = $1 AND state = 'dispatched'
			  RETURNING agent_id, base_key`,
			[id, by, note],
		);
		const row = r.rows[0];
		if (!row) return false;
		this.bell.emit("result:" + id);
		// Место освободилось — будим опрос агента: следующая команда уходит сразу, а не по сроку.
		this.bell.emit(row.agent_id);
		return true;
	}

	private async dispatchQueued(agentId: string, instanceId: string | null = null): Promise<WireCommand[]> {
		// Просроченные — в expired, чтобы агент не выполнял то, чего уже никто не ждёт.
		// Причина пишется тут же (см. expireOverdue): здесь это всегда «не забрал».
		await this.db.query(
			`UPDATE commands
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(error, jsonb_build_object('code', 'COMMAND_QUEUE_TIMEOUT', 'message', $2::text))
			  WHERE agent_id = $1 AND state = 'queued' AND expires_at < now()`,
			[agentId, QUEUE_TIMEOUT_MESSAGE],
		);
		/*
		 * ПО ОДНОЙ КОМАНДЕ НА БАЗУ ЗА РАЗ.
		 *
		 * Команды одной базы не независимы: переименовать пользователя и тут же выдать ему
		 * роли — это две операции над ОДНИМ объектом, и порядок здесь не деталь. Агент
		 * выполняет полученное параллельно (max_parallel), поэтому выданные вместе команды
		 * шли гонкой: роли ложились на старое имя или приходило «в базе нет пользователя».
		 * Вдобавок два COM-соединения к одной базе занимают два сеанса и две лицензии там,
		 * где хватает одного.
		 *
		 * Поэтому выдаём по одной команде на базу и не выдаём следующую, пока предыдущая по
		 * этой базе не завершилась. Команды кластера (base_key IS NULL) друг другу не
		 * мешают — у каждой своя «партиция», и они по-прежнему уходят пачкой.
		 */
		/*
		 * И НЕ БОЛЬШЕ N КОМАНД ВНУТРЬ БАЗ ОДНОВРЕМЕННО — на всего агента.
		 *
		 * Прежнее правило разводило по одной команде на базу, но между базами не
		 * ограничивало ничего. Измерено 2026-09-11: две параллельные команды
		 * `IB_LIST_EXTENSIONS` по разным базам заклинили агента больше чем на двенадцать
		 * минут — ни ответа, ни heartbeat; та же команда в одиночку честно отвечала через
		 * 186 с. Внутри агента у них общий ресурс, и выдавать ему больше, чем он способен
		 * выполнить, значит менять «медленно» на «никак».
		 *
		 * Команды КЛАСТЕРА (base_key IS NULL) под ограничение не попадают: они идут через
		 * rac, в базы не заходят и друг другу не мешают.
		 */
		const busy = await this.db.query<{ n: string }>(
			`SELECT count(*) AS n FROM commands d
			  WHERE d.agent_id = $1 AND ${IN_BASE("d")} AND ${OCCUPIES("d", "$2")}`,
			[agentId, this.lateGraceSecs],
		);
		const slots = Math.max(0, this.ibParallel - Number(busy.rows[0]?.n ?? 0));

		const r = await this.db.query<CommandRow>(
			`WITH candidates AS (
			      SELECT c.id, c.priority, c.created_at, c.base_key, ${IN_BASE("c")} AS ib,
			             row_number() OVER (
			               -- Очередь базы — только у команд внутрь базы; кластерные независимы (С1).
			               PARTITION BY CASE WHEN ${IN_BASE("c")} THEN c.base_key ELSE c.id END
			               -- Внутри базы порядок ТОЛЬКО по времени: приоритет не должен
			               -- переставлять зависимые операции над одним объектом местами.
			               ORDER BY c.created_at
			             ) AS rn
			        FROM commands c
			       WHERE c.agent_id = $1 AND c.state = 'queued'
			         -- Повтор с паузой ещё не созрел (С19).
			         AND (c.available_at IS NULL OR c.available_at <= now())
			         AND (NOT ${IN_BASE("c")} OR NOT EXISTS (
			               SELECT 1 FROM commands d
			                WHERE d.agent_id = c.agent_id AND d.base_key = c.base_key
			                  AND ${IN_BASE("d")} AND ${OCCUPIES("d", "$4")}))
			 ), ranked AS (
			      SELECT id, priority, created_at, base_key,
			             -- Очередь ВНУТРИБАЗОВЫХ между собой: приоритет, затем время.
			             row_number() OVER (ORDER BY priority, created_at) AS ib_rank
			        FROM candidates
			       WHERE rn = 1 AND ib
			 )
			 -- Запоминаем ПРОЦЕСС, который забрал команду: по нему при регистрации нового
			 -- процесса видно, чей ответ уже не придёт (см. failLostByRestart).
			 -- Срок выполнения — от ВЫДАЧИ (С2): ожидание очереди в него не входит.
			 UPDATE commands SET state = 'dispatched', dispatched_at = now(), dispatched_instance = $3,
			        expires_at = CASE WHEN ttl_seconds IS NOT NULL
			                          THEN now() + make_interval(secs => ttl_seconds) ELSE expires_at END
			  WHERE id IN (
			    -- Кластерные — все, они дешёвые и независимые.
			    SELECT id FROM candidates WHERE rn = 1 AND NOT ib
			    UNION ALL
			    -- Внутрибазовые — только сколько осталось свободных мест у агента.
			    SELECT id FROM ranked WHERE ib_rank <= $2
			  )
			  RETURNING *`,
			[agentId, slots, instanceId, this.lateGraceSecs],
		);
		const wire = r.rows.map((c) => ({
			id: c.id,
			...(c.request_id ? { requestId: c.request_id } : {}),
			...(c.base_key ? { baseKey: c.base_key } : {}),
			type: c.type,
			payload: c.payload ?? {},
			...(c.expires_at ? { expiresAt: new Date(c.expires_at).toISOString() } : {}),
		}));

		// Учётные данные баз — только в выдаче, по одному запросу на пачку команд.
		if (this.authResolver) {
			const keys = [...new Set(wire.map((c) => c.baseKey).filter((k): k is string => !!k))];
			if (keys.length) {
				const auth = await this.authResolver(agentId, keys);
				if (auth.size) {
					for (const c of wire) {
						const a = c.baseKey ? auth.get(c.baseKey) : undefined;
						// `auth` в payload = «если свой администратор не прошёл, войди этим».
						// Порядок попыток задаёт агент, см. контракт.
						if (a) c.payload = { ...c.payload, auth: a };
					}
				}
			}
		}
		return wire;
	}

	private waitForBell(agentId: string, ms: number): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.bell.off(agentId, done);
				resolve();
			};
			const timer = setTimeout(done, ms);
			this.bell.once(agentId, done);
		});
	}

	/** Результат от агента. Повторная доставка того же результата (spool) — не ошибка. */
	/**
	 * Принять результат команды.
	 *
	 * ОТМЕНЁННУЮ НЕ ПЕРЕТИРАЕМ (S2). Поздний результат (агент досылает при остановке службы или
	 * прерванная команда всё-таки ответила) заменил бы итог отмены на «выполнено» — и оператор
	 * увидел бы, что отменённое прошло. По ИСТЁКШИМ результаты принимаем и дальше: агент
	 * досылает их из своей очереди, когда связь вернулась, и это правда о выполненной работе.
	 */
	async complete(agentId: string, res: WireResult): Promise<CommandRow | null> {
		const ok = res.status === "SUCCESS";
		const r = await this.db.query<CommandRow>(
			`UPDATE commands
			    SET state = $3, result_status = $4, result = $5::jsonb, error = $6::jsonb,
			        onec_http_status = $7, finished_at = COALESCE(finished_at, now()),
			        -- Пришёл после истечения срока (С21): итог правдив, но его надо назвать поздним.
			        late = late OR state = 'expired'
			  WHERE id = $1 AND agent_id = $2 AND state <> 'canceled'
			  RETURNING *`,
			[res.commandId, agentId, ok ? "done" : "failed", res.status,
				res.result === undefined ? null : JSON.stringify(res.result),
				res.error === undefined ? null : JSON.stringify(res.error),
				res.onecHttpStatus ?? null],
		);
		const row = r.rows[0] ?? null;
		if (row) {
			this.bell.emit("result:" + row.id);
			// База освободилась — будим опрос агента, чтобы следующая команда по ней ушла
			// сразу, а не через цикл long-poll: последовательность не должна стоить времени.
			if (row.base_key) this.bell.emit(agentId);
		}
		return row;
	}

	/**
	 * ПОВТОРИТЬ КОМАНДУ ЗАДАНИЯ, КОГДА БАЗА ЗАНЯТА (IB_BUSY, С10).
	 *
	 * Агент прямо советует повторить такие базы, а задание и обслуживание по расписанию этого не
	 * делали: ночная выгрузка пропускала базу, в которую кто-то зашёл в ту же минуту. Копия встаёт в
	 * конец очереди того же задания; у исходной отмечается, кем она повторена — отчёт задания и
	 * «Повторить неуспешные» видят только последнюю попытку. Не больше BUSY_MAX_ATTEMPTS попыток.
	 * Копия выдаётся не сразу, а после паузы BUSY_RETRY_DELAYS_SECS (С19): ожидание очереди считается
	 * от конца паузы.
	 *
	 * Возвращает номер новой команды или `null`, если повторять нечего.
	 */
	async retryBusy(id: string, queueWaitSeconds: number): Promise<string | null> {
		const next = "cmd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
		const r = await this.db.query<{ id: string; agent_id: string }>(
			`WITH src AS (
			    SELECT * FROM commands
			     WHERE id = $1 AND state = 'failed' AND batch_id IS NOT NULL
			       AND retried_by IS NULL AND attempt < $3
			 ), ins AS (
			    INSERT INTO commands (id, agent_id, organization_uuid, base_key, request_id, type, payload,
			                          user_uuid, conversation_id, expires_at, priority, batch_id,
			                          in_base, ttl_seconds, attempt, available_at)
			    SELECT $2, agent_id, organization_uuid, base_key, NULL, type, payload,
			           user_uuid, conversation_id,
			           now() + make_interval(secs => $4::int + (ARRAY[$5::int, $6::int])[LEAST(attempt, 2)]),
			           priority, batch_id, in_base, ttl_seconds, attempt + 1,
			           now() + make_interval(secs => (ARRAY[$5::int, $6::int])[LEAST(attempt, 2)])
			      FROM src
			    RETURNING id, agent_id
			 ), mark AS (
			    UPDATE commands SET retried_by = $2 WHERE id IN (SELECT id FROM src) AND EXISTS (SELECT 1 FROM ins)
			 )
			 SELECT id, agent_id FROM ins`,
			[id, next, BUSY_MAX_ATTEMPTS, Math.max(30, queueWaitSeconds), BUSY_RETRY_DELAYS_SECS[0], BUSY_RETRY_DELAYS_SECS[1]],
		);
		const row = r.rows[0];
		if (!row) return null;
		this.bell.emit(row.agent_id);
		return row.id;
	}

	/**
	 * ПРОДЛИТЬ СРОК ВЫПОЛНЯЕМЫХ КОМАНД (С33, решение В2 по С24). Агент в heartbeat перечисляет команды, по которым
	 * работает; срок каждой выданной ЭТОМУ агенту продлевается до «сейчас + запас», но не дальше потолка от
	 * выдачи. Не перечислена или heartbeat не пришёл — не продлевается: зависший или остановленный агент
	 * выявляется истечением срока, как прежде. Возвращает, сколько команд продлено.
	 */
	async extendRunning(
		agentId: string, running: { commandId: string; startedAt?: string | null }[], leaseSecs: number,
	): Promise<number> {
		if (!running.length) return 0;
		const ids = running.map((x) => x.commandId);
		const started = running.map((x) => {
			const t = x.startedAt ? Date.parse(x.startedAt) : NaN;
			return Number.isFinite(t) ? new Date(t).toISOString() : null;
		});
		const r = await this.db.query<{ id: string }>(
			`UPDATE commands c
			    SET expires_at = LEAST(GREATEST(c.expires_at, now() + make_interval(secs => $3::int)),
			                           c.dispatched_at + make_interval(secs => $4::int)),
			        running_seen_at = now(),
			        started_at = COALESCE(c.started_at, x.started_at)
			   FROM unnest($2::text[], $5::timestamptz[]) AS x(id, started_at)
			  WHERE c.id = x.id AND c.agent_id = $1 AND c.state = 'dispatched' AND c.dispatched_at IS NOT NULL
			  RETURNING c.id`,
			[agentId, ids, Math.max(90, Math.round(leaseSecs)), RUNNING_LEASE_CAP_SECS, started],
		);
		return r.rows.length;
	}

	/**
	 * НЕЗАВЕРШЁННЫЕ ОДИНОЧНЫЕ КОМАНДЫ ПОЛЬЗОВАТЕЛЯ (без задания). Реестр операций панели живёт в памяти вкладки:
	 * после перезагрузки страницы «Прогресс» пустел, хотя команды шли дальше. По этому списку панель восстанавливает
	 * их и дослеживает до конца. Служебные чтения сервиса (без пользователя) сюда не попадают.
	 */
	async activeOfUser(userUuid: string): Promise<CommandRow[]> {
		const r = await this.db.query<CommandRow>(
			`SELECT * FROM commands
			  WHERE user_uuid = $1 AND batch_id IS NULL AND state IN ('queued', 'dispatched')
			    AND created_at > now() - interval '1 day'
			  ORDER BY created_at LIMIT 50`,
			[userUuid],
		);
		return r.rows;
	}

	async get(id: string): Promise<CommandRow | null> {
		const r = await this.db.query<CommandRow>(`SELECT * FROM commands WHERE id = $1`, [id]);
		return r.rows[0] ?? null;
	}

	/** Ждёт завершения команды до timeoutMs — для синхронных вызовов из диалога. */
	async waitResult(id: string, timeoutMs: number): Promise<CommandRow | null> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const row = await this.get(id);
			if (!row) return null;
			// Отменённая и прерванная — тоже конец: ждать дальше нечего (С11).
			if (row.state === "done" || row.state === "failed" || row.state === "expired" || row.state === "canceled") return row;
			const remaining = deadline - Date.now();
			if (remaining <= 0) return row;
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(t);
					this.bell.off("result:" + id, done);
					resolve();
				};
				const t = setTimeout(done, Math.min(remaining, 2000));
				this.bell.once("result:" + id, done);
			});
		}
	}

	static toView(c: CommandRow) {
		return {
			id: c.id,
			agentId: c.agent_id,
			baseKey: c.base_key,
			type: c.type,
			requestId: c.request_id,
			state: c.state,
			payload: c.payload,
			result: c.result ?? null,
			error: c.error ?? null,
			onecHttpStatus: c.onec_http_status,
			createdAt: c.created_at.toISOString(),
			dispatchedAt: c.dispatched_at?.toISOString() ?? null,
			finishedAt: c.finished_at?.toISOString() ?? null,
		};
	}
	/**
	 * ЧТО СЕЙЧАС В ОЧЕРЕДИ И СКОЛЬКО ОБЫЧНО ИДЁТ РАБОТА.
	 *
	 * Два вопроса, на которые панель раньше не умела отвечать: «сколько ждать» и «чего ждёт
	 * эта команда». Человек видел счётчик «сделано 7 из 110» — и не знал, сорок это минут
	 * или три; а команда в состоянии `queued` выглядела так же, как выполняющаяся.
	 *
	 * Средняя длительность считается по ВЫПОЛНЕННЫМ командам за неделю и по времени от
	 * выдачи до ответа — «сколько идёт сама работа», а не «сколько провисело в очереди».
	 * По каждому типу отдельно: чтение расширений из базы и команда кластера отличаются на
	 * два порядка, и общее среднее не значило бы ничего.
	 */
	/**
	 * КТО ДЕРЖИТ ОЧЕРЕДЬ (R5): выданные агентам и ещё не ответившие команды — сколько идут.
	 * Раньше экран очереди говорил «идёт 1», но не что именно и сколько: зависшее чтение и
	 * четырёхчасовая загрузка выглядели одинаково.
	 */
	async runningCommands(limit = 50): Promise<{
		commandId: string; type: string; baseKey: string | null; agentId: string; ageSecs: number;
		payload: Record<string, unknown>; canCancel: boolean; canCancelCheck: boolean;
	}[]> {
		const r = await this.db.query<{
			id: string; type: string; base_key: string | null; agent_id: string; age_secs: string | null;
			payload: Record<string, unknown> | null; can_cancel: boolean | null; can_cancel_check: boolean | null;
		}>(
			`SELECT c.id, c.type, c.base_key, c.agent_id, c.payload,
			        round(extract(epoch FROM (now() - c.dispatched_at)))::text AS age_secs,
			        COALESCE(a.capabilities ? 'agent.cancel', false) AS can_cancel,
			        COALESCE(a.capabilities ? 'agent.cancel.check', false) AS can_cancel_check
			   FROM commands c LEFT JOIN agents a ON a.id = c.agent_id
			  WHERE c.state = 'dispatched'
			  ORDER BY c.dispatched_at
			  LIMIT $1`,
			[limit],
		);
		return r.rows.map((x) => ({
			commandId: x.id, type: x.type, baseKey: x.base_key, agentId: x.agent_id, ageSecs: Number(x.age_secs) || 0,
			payload: x.payload ?? {}, canCancel: x.can_cancel === true, canCancelCheck: x.can_cancel_check === true,
		}));
	}

	async stats(): Promise<{
		types: { type: string; avgSecs: number; samples: number }[];
		queued: number;
		running: number;
		oldestQueuedSecs: number;
	}> {
		const durations = await this.db.query<{ type: string; avg_secs: string; samples: string }>(
			`SELECT type,
			        round(avg(extract(epoch FROM (finished_at - dispatched_at))))::text AS avg_secs,
			        count(*)::text AS samples
			   FROM commands
			  WHERE state = 'done' AND dispatched_at IS NOT NULL AND finished_at IS NOT NULL
			    AND finished_at > now() - interval '7 days'
			  GROUP BY type`,
		);
		const queue = await this.db.query<{ queued: string; running: string; oldest_secs: string | null }>(
			`SELECT count(*) FILTER (WHERE state = 'queued')::text AS queued,
			        count(*) FILTER (WHERE state = 'dispatched')::text AS running,
			        round(extract(epoch FROM (now() - min(created_at) FILTER (WHERE state = 'queued'))))::text AS oldest_secs
			   FROM commands
			  WHERE state IN ('queued', 'dispatched')`,
		);
		const q = queue.rows[0];
		return {
			types: durations.rows.map((r) => ({
				type: r.type, avgSecs: Number(r.avg_secs) || 0, samples: Number(r.samples) || 0,
			})),
			queued: Number(q?.queued ?? 0),
			running: Number(q?.running ?? 0),
			oldestQueuedSecs: q?.oldest_secs ? Number(q.oldest_secs) : 0,
		};
	}

}
