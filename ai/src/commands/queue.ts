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
	ttlSeconds?: number;
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
};

/** Команда в формате протокола агента. */
export type WireCommand = { id: string; requestId?: string; baseKey?: string; type: string; payload: Record<string, unknown> };

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

	constructor(db: Db, ibParallel = 1) {
		this.db = db;
		this.ibParallel = Math.max(1, ibParallel);
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
		const baseKey = input.baseKey ?? null;
		// ON CONFLICT — по частичному уникальному индексу (agent_id, base_key, request_id) среди
		// НЕЗАВЕРШЁННЫХ команд: повторная постановка той же команды (двойное нажатие, ретрай HTTP)
		// возвращает уже стоящую в очереди, а не создаёт вторую. Идемпотентность самой операции
		// в 1С обеспечивает requestId — здесь мы защищаем только очередь.
		const r = await this.db.query<CommandRow>(
			`INSERT INTO commands (id, agent_id, organization_uuid, base_key, request_id, type, payload, user_uuid, conversation_id, expires_at, priority)
			 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now() + ($10 || ' seconds')::interval, $11)
			 ON CONFLICT (agent_id, COALESCE(base_key, ''), request_id)
			     WHERE request_id IS NOT NULL AND state IN ('queued', 'dispatched') DO NOTHING
			 RETURNING *`,
			[id, input.agentId, input.organizationUuid, baseKey, input.requestId ?? null, input.type,
				JSON.stringify(input.payload ?? {}), input.userUuid ?? null, input.conversationId ?? null, String(ttl),
				input.priority ?? 0],
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
			`UPDATE commands
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(error, jsonb_build_object(
			          'code', 'COMMAND_EXPIRED',
			          'message', CASE WHEN state = 'queued'
			            THEN 'Агент не забрал команду до истечения срока — служба 1С-агента не на связи.'
			            ELSE 'Агент забрал команду, но не ответил за отведённое ей время. Связь тут ни при чём: проверьте базу и журнал агента — операция могла идти дольше своего срока.'
			          END))
			  WHERE state IN ('queued', 'dispatched') AND expires_at < now()`,
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

	private async dispatchQueued(agentId: string, instanceId: string | null = null): Promise<WireCommand[]> {
		// Просроченные — в expired, чтобы агент не выполнял то, чего уже никто не ждёт.
		// Причина пишется тут же (см. expireOverdue): здесь это всегда «не забрал».
		await this.db.query(
			`UPDATE commands
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(error, jsonb_build_object(
			          'code', 'COMMAND_EXPIRED',
			          'message', 'Агент не забрал команду до истечения срока — служба 1С-агента не на связи.'))
			  WHERE agent_id = $1 AND state = 'queued' AND expires_at < now()`,
			[agentId],
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
			`SELECT count(*) AS n FROM commands
			  WHERE agent_id = $1 AND state = 'dispatched' AND base_key IS NOT NULL`,
			[agentId],
		);
		const slots = Math.max(0, this.ibParallel - Number(busy.rows[0]?.n ?? 0));

		const r = await this.db.query<CommandRow>(
			`WITH candidates AS (
			      SELECT c.id, c.priority, c.created_at, c.base_key,
			             row_number() OVER (
			               PARTITION BY COALESCE(c.base_key, c.id)
			               -- Внутри базы порядок ТОЛЬКО по времени: приоритет не должен
			               -- переставлять зависимые операции над одним объектом местами.
			               ORDER BY c.created_at
			             ) AS rn
			        FROM commands c
			       WHERE c.agent_id = $1 AND c.state = 'queued'
			         AND (c.base_key IS NULL OR NOT EXISTS (
			               SELECT 1 FROM commands d
			                WHERE d.agent_id = c.agent_id AND d.state = 'dispatched'
			                  AND d.base_key = c.base_key))
			 ), ranked AS (
			      SELECT id, priority, created_at, base_key,
			             -- Очередь ВНУТРИБАЗОВЫХ между собой: приоритет, затем время.
			             row_number() OVER (ORDER BY priority, created_at) AS ib_rank
			        FROM candidates
			       WHERE rn = 1 AND base_key IS NOT NULL
			 )
			 -- Запоминаем ПРОЦЕСС, который забрал команду: по нему при регистрации нового
			 -- процесса видно, чей ответ уже не придёт (см. failLostByRestart).
			 UPDATE commands SET state = 'dispatched', dispatched_at = now(), dispatched_instance = $3
			  WHERE id IN (
			    -- Кластерные — все, они дешёвые и независимые.
			    SELECT id FROM candidates WHERE rn = 1 AND base_key IS NULL
			    UNION ALL
			    -- Внутрибазовые — только сколько осталось свободных мест у агента.
			    SELECT id FROM ranked WHERE ib_rank <= $2
			  )
			  RETURNING *`,
			[agentId, slots, instanceId],
		);
		const wire = r.rows.map((c) => ({
			id: c.id,
			...(c.request_id ? { requestId: c.request_id } : {}),
			...(c.base_key ? { baseKey: c.base_key } : {}),
			type: c.type,
			payload: c.payload ?? {},
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
			        onec_http_status = $7, finished_at = COALESCE(finished_at, now())
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
			if (row.state === "done" || row.state === "failed" || row.state === "expired") return row;
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
