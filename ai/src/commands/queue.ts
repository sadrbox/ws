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
import type { Logger } from "../logger.ts";
import {
	CONTENT_SCRUB_BATCH, EXPORT_CONTENT_KEEP_SECS, EXPORT_EXTENSION_TYPE, INSTALL_CONTENT_KEEP_FAILED_SECS, INSTALL_EXTENSION_TYPE,
	contentDigest, digestsById,
} from "./contentDigest.ts";

// `canceled` пишет queue.cancel — тип обязан его знать: иначе проверка «команда отменена»
// (S2) выглядит для компилятора невозможной.
export type CommandState = "queued" | "dispatched" | "done" | "failed" | "expired" | "canceled";

export type EnqueueInput = {
	agentId: string;
	/**
	 * ЧЬИ ДАННЫЕ ЗАТРОНУТЫ (В4, модель без владельца 28.09): у бизнес-команды — организация запроса, у пакетной и
	 * монопольной внутри базы — организация базы, у команды кластера и о самой службе — null. Не организация агента:
	 * её нет. По ней решается, кто видит результат (`commandVisible`).
	 */
	organizationUuid: string | null;
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
	/**
	 * Раньше этого времени агенту не выдавать (С19). Команда стоит в очереди и видна в задании, но её
	 * место занимает подготовка: монопольная операция (установка расширения) выпускается `release()`
	 * после того, как сервис закрыл базу и снял сеансы (exclusiveOps.ts, 27.09).
	 */
	availableAt?: Date | null;
	/**
	 * НЕ ВЫДАВАТЬ ДО `release()` (КР-12 аудита 27.09): монопольная операция ждёт, пока её раннер закроет базу.
	 * Раньше это была дата «через 12 ч» — на миллисекунды (у копии повтора — на минуты) раньше срока ожидания, и в
	 * это окно команда уходила агенту без подготовки. Теперь `available_at` на сутки ПОЗЖЕ `expires_at`: такая
	 * команда может только истечь или быть выпущенной, но не уйти агенту сама.
	 */
	hold?: boolean;
};

/**
 * Состояние подготовки монопольной операции в payload команды (`exclusive`, exclusiveOps.ts). Пустой объект —
 * операция поставлена под подготовку, шагов ещё не было (пишется вместе с самой командой, КР-12).
 */
export type ExclusiveStateRow = {
	/** Прежний запрет регламентных заданий: нет поля — запрет не ставился; null — ставился, прежнее неизвестно. */
	jobsWas?: boolean | null;
	/** requestId команды запрета: поставлена, ответа ещё нет — итог восстановление узнает по ней. */
	jobsReq?: string;
	locked?: boolean;
	/** requestId команды закрытия входа — как `jobsReq`. */
	lockReq?: string;
	restored?: boolean;
	problems?: string[];
	/** false — у агента нет кластерных команд: операция выпущена без подготовки, повтор «база занята» обычный. */
	prepared?: boolean;
	/** Операцию продолжила копия-повтор того же раннера — состояние живёт в ней. */
	movedTo?: string;
	/** Когда раннер выпустит удержанную копию-повтор (для строки задания «повтор в …»). */
	releaseAt?: string;
};

/** Строка для восстановления монопольной операции (listExclusivePending). */
export type ExclusivePendingRow = {
	id: string; agent_id: string; organization_uuid: string | null; base_key: string | null; state: CommandState; ttl_seconds: number | null;
	exclusive: ExclusiveStateRow | null;
};

export type CommandRow = {
	id: string;
	agent_id: string;
	/** Чьи данные затронуты (В4); null — команда кластера или о самой службе. */
	organization_uuid: string | null;
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

/**
 * «Не выдавать до release» (КР-12 аудита 27.09): `available_at` на сутки позже срока ожидания `expires_at` —
 * команда может только истечь или быть выпущенной раннером, но не уйти агенту сама.
 */
const HELD_AFTER_EXPIRY = "interval '1 day'";

/**
 * КАКУЮ ДОЛЮ СВОЕГО ОЖИДАНИЯ КОМАНДА ПЕРЕЖИДАЕТ МОЛЧАНИЕ АГЕНТА (КР-20 аудита 27.09). Таймер (`sweep`) закрывал
 * все команды в очереди молчащего агента через `AGENT_OFFLINE_AFTER_SECS × 2` (3 мин) — и ночное задание на сто баз
 * с ожиданием 12 ч гибло от обновления службы или её перезапуска. Теперь порог — не меньше этой доли ожидания самой
 * команды: у задания 12 ч × 0,2 ≈ 2,4 ч, а у одиночной команды (ожидание 15 мин) — те же 3 мин, что и прежде.
 */
export const ORPHAN_WAIT_SHARE = 0.2;

/**
 * КОМАНДЫ ОБСЛУЖИВАНИЯ БАЗЫ (КР-12 п. 5 аудита 27.09): надолго занимают базу, меняют её конфигурацию или
 * закрывают вход. Ночные проверки учёта в такую базу не идут (basesUnderMaintenance). Чтения и правки
 * пользователей базу не занимают.
 */
export const MAINTENANCE_TYPES: readonly string[] = [
	"IB_BACKUP", "IB_RESTORE", "IB_CHECK", "IB_APPLY_UPDATE", "IB_INSTALL_EXTENSION", "IB_DELETE_EXTENSION",
	"CLUSTER_SET_SESSIONS_LOCK",
];

/** Внутрь базы: явный признак, а у старых команд — как прежде, по наличию базы (С1). */
const IN_BASE = (a: string) => `COALESCE(${a}.in_base, ${a}.base_key IS NOT NULL)`;

/**
 * TIMEOUT АГЕНТА НЕ ЗНАЧИТ «РАБОТА ОКОНЧЕНА» (С18). Агент перестаёт ждать команду, а конфигуратор `1cv8`
 * работает дальше; пока он жив, агент держит базу (IB_BUSY) и снимает блокировку входа только после него.
 * Раньше такая команда сразу освобождала место: следующая команда задания или «Повторить неуспешные» уходили
 * агенту и получали отказ, сжигая повторы. Место держится, пока в снимке процессов агента есть процесс этой
 * команды (`commandId`, агент 01:06), и ещё 90 с после отказа — на задержку heartbeat.
 */
/*
 * Не старше суток (аудит 26.09): без предела условие проверялось по ВСЕЙ истории агента на каждом цикле опроса
 * (выборка росла линейно). Процесс команды, живой спустя сутки после TIMEOUT, место уже не держит — тот же потолок,
 * что у продления выполняемых команд (RUNNING_LEASE_CAP_SECS); по пределу работает индекс commands_agent_finished_idx.
 */
export const TIMEOUT_STILL_RUNNING = (a: string) => `(${a}.state = 'failed' AND ${a}.error->>'code' = 'TIMEOUT'
	AND ${a}.finished_at > now() - interval '24 hours' AND (
	${a}.finished_at > now() - interval '90 seconds'
	OR EXISTS (SELECT 1 FROM agents ag, jsonb_array_elements(ag.processes) pr
	            WHERE ag.id = ${a}.agent_id AND pr->>'commandId' = ${a}.id)))`;

/**
 * ЗАНИМАЕТ ЛИ КОМАНДА МЕСТО (С3). Выданная — да. Истёкшая по сроку, но выданная и без ответа —
 * тоже, ещё `grace` секунд: агент мог продолжать работу, и выдать ему вторую команду внутрь базы
 * поверх первой значит повторить заклинивание, от которого место и защищает.
 */
/*
 * ВЫДАННАЯ С ИСТЁКШИМ СРОКОМ — КАК ИСТЁКШАЯ (Н4 аудита 26.09). Просрочку в `expired` переводит таймер, но пока он
 * не дошёл (или не работал вовсе, как было до 26.09 — только из опросов панели), выданная команда без ответа
 * держала место базы вечно: потерянный ответ закрывал базу для чата и ночных проверок, пока кто-то не открывал
 * панель. Теперь она держит место ровно столько же, сколько истёкшая: срок + `grace`.
 */
const OCCUPIES = (a: string, graceParam: string) => `((${a}.state = 'dispatched' AND ${a}.expires_at > now() - make_interval(secs => ${graceParam}::int)) OR (
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
// «Ошибка исключительной блокировки информационной базы. Активны сеансы: …» (С9 задачи агента 28.09): так платформа
// отказывает, если установка или удаление расширения меняет структуру данных, а в базе есть чужой сеанс. С агента
// 2026-09-28 13:57 это `IB_BUSY` с держателями, у агентов старше — `IB_ERROR` с этим текстом.
// Окончания — `[а-яё]*`, а не `\w*`: в JS `\w` кириллицу не ловит, и «разделен\w* доступ» молчал на «разделенного
// доступа» (случай 16.09 спасало только «база данных заблокирована» рядом).
const BUSY_TEXT = /разделен[а-яё]* доступ|разделённ[а-яё]* доступ|база данных заблокирована|монопольн|исключительн[а-яё]* блокировк|exclusive (?:access|mode)/i;

/**
 * КОНФЛИКТ БЛОКИРОВОК — тоже «база занята», только не целиком, а по данным.
 *
 * Живой случай 17.09 на `_transition`: групповое изменение пользователя ответило «Конфликт блокировок при
 * выполнении транзакции: Превышено максимальное время ожидания предоставления блокировки» (вход 7 с, до отказа
 * 20 с — ровно таймаут управляемой блокировки платформы) с общим кодом `IB_ERROR`. Задание объявило «Не выполнено»,
 * а та же правка минутой позже прошла с первого раза: запись ждала чужую транзакцию над теми же данными.
 *
 * Повторять безопасно: транзакция, не дождавшаяся блокировки, откатывается целиком — записано ничего не было, а
 * внутрибазовые команды по контракту идемпотентны. Взаимоблокировка — тот же класс отказа.
 */
const LOCK_CONFLICT_TEXT = /конфликт блокировок|время ожидания предоставления блокировки|взаимоблокировк|lock conflict|lock request time\s*-?out|deadlocked/i;

/**
 * ВХОД ЗАКРЫТ БЛОКИРОВКОЙ НАЧАЛА СЕАНСОВ, И КОД РАЗРЕШЕНИЯ НЕ ПОМОГ (С2 задачи агента 28.09, агент с 2026-09-27 22:42).
 * Обычно агент входит в закрытую базу сам — с кодом блокировки из кластера или своим на время операции; этот код
 * приходит, только когда блокировку поставили изнутри 1С (её кода кластер не знает), у служебного администратора нет
 * прав на `rac infobase update` или код не подошёл. Повтор с той же блокировкой даст тот же отказ, а подготовка
 * (закрыть вход, снять сеансы) её только усилит, — поэтому это НЕ «база занята», даже если в тексте найдётся похожее.
 */
export const SESSIONS_DENIED_CODE = "IB_SESSIONS_DENIED";

/** Отказ означает «база занята» — команду задания стоит повторить. */
export const isBusyFailure = (code: string | undefined | null, message: string | undefined | null): boolean =>
	code !== SESSIONS_DENIED_CODE
	&& (RETRY_LATER_CODES.has(code ?? "") || BUSY_TEXT.test(message ?? "") || LOCK_CONFLICT_TEXT.test(message ?? ""));

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
	 * значение по умолчанию — единица, и это защита, а не политика. Открыто для цепочки монопольных операций
	 * (exclusiveOps.ts, КР-12): готовить базу больше, чем агент выполнит, незачем.
	 */
	readonly ibParallel: number;

	/**
	 * Срок ОЖИДАНИЯ очереди выданных команд — до выдачи (I8 аудита 27.09): выдача перезаписывает `expires_at`
	 * сроком выполнения, а команде, возвращённой в очередь оборванным опросом (`requeue`), нужен прежний.
	 * WeakMap — запись живёт, пока жив ответ агенту.
	 */
	private readonly queueDeadlines = new WeakMap<WireCommand, Date>();

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
	 * Журнал для сбоев, которые очередь переживает сама (28.09): очистка файла выполненной установки не удалась —
	 * команда всё равно закрыта, а файл уберёт ежечасный проход. Без журнала — молча, как в тестах.
	 */
	private log: Pick<Logger, "warn"> | null = null;

	setLog(log: Pick<Logger, "warn"> | null): void {
		this.log = log;
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
			// Удержанная до release (КР-12): available_at позже собственного срока ожидания.
			`INSERT INTO commands (id, agent_id, organization_uuid, base_key, request_id, type, payload, user_uuid, conversation_id, expires_at, priority, in_base, ttl_seconds, available_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now() + ($10 || ' seconds')::interval, $11, $12, $13,
			         CASE WHEN $15::boolean THEN now() + ($10 || ' seconds')::interval + ${HELD_AFTER_EXPIRY} ELSE $14::timestamptz END)
			 ON CONFLICT (agent_id, COALESCE(base_key, ''), request_id)
			     WHERE request_id IS NOT NULL AND state IN ('queued', 'dispatched') DO NOTHING
			 RETURNING *`,
			[id, input.agentId, input.organizationUuid, baseKey, input.requestId ?? null, input.type,
				JSON.stringify(input.payload ?? {}), input.userUuid ?? null, input.conversationId ?? null, String(queueWait),
				input.priority ?? 0, inBase, ttl, input.availableAt ?? null, input.hold === true],
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
	/** `parallel` — предел внутрибазовых команд этого агента (по роли); не задан — общий `ibParallel`. */
	async take(agentId: string, waitSecs: number, instanceId?: string | null, parallel?: number): Promise<WireCommand[]> {
		const deadline = Date.now() + waitSecs * 1000;
		for (;;) {
			if (this.closed) return [];
			const batch = await this.dispatchQueued(agentId, instanceId ?? null, parallel);
			if (batch.length) return batch;
			const remaining = deadline - Date.now();
			if (remaining <= 0 || this.closed) return [];
			await this.waitForBell(agentId, Math.min(remaining, 5000));
		}
	}

	/**
	 * ВЕРНУТЬ В ОЧЕРЕДЬ ВЫДАННОЕ, НО НЕ ПОЛУЧЕННОЕ: агент закрыл опрос, пока команды выдавались (обрыв long-poll).
	 *
	 * Срок — прежний срок ОЖИДАНИЯ очереди (I8 аудита 27.09). Раньше команда возвращалась с «выдача + срок
	 * выполнения»: команда задания, ждущая очереди до 12 ч, истекала в очереди через 15 мин. Прежний срок
	 * запомнен при выдаче (`queueDeadlines`); не запомнен (чужой объект) — срок не трогаем, как было.
	 */
	async requeue(cmds: readonly WireCommand[]): Promise<number> {
		if (!cmds.length) return 0;
		const until = cmds.map((c) => this.queueDeadlines.get(c)?.toISOString() ?? null);
		const r = await this.db.query(
			`UPDATE commands c
			    SET state = 'queued', dispatched_at = NULL, dispatched_instance = NULL,
			        expires_at = COALESCE(x.until, c.expires_at)
			   FROM unnest($1::text[], $2::timestamptz[]) AS x(id, until)
			  WHERE c.id = x.id AND c.state = 'dispatched'`,
			[cmds.map((c) => c.id), until],
		);
		return r.rowCount ?? 0;
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
	 *
	 * ДОЛГОЕ ОЖИДАНИЕ — ДОЛЬШЕ ТЕРПИМ (КР-20 аудита 27.09). С таймера (Н4) это закрывало ВСЕ команды в очереди через
	 * 3 мин молчания, в том числе ночное задание на сто баз, законно ждущее очереди до утра: обновление службы или её
	 * перезапуск губили всю ночь. Порог команды — не меньше `ORPHAN_WAIT_SHARE` её собственного ожидания
	 * (`expires_at − created_at`): у задания это часы, у одиночной команды — прежние минуты.
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
			   AND (a.last_seen_at IS NULL OR a.last_seen_at < now() - make_interval(secs => GREATEST(
			         $1::double precision,
			         $2::double precision * EXTRACT(EPOCH FROM (c.expires_at - c.created_at)))))`,
			[silentSecs, ORPHAN_WAIT_SHARE],
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
			  WHERE state IN ('queued', 'dispatched') AND expires_at < now()
			  RETURNING id, agent_id`,
			[QUEUE_TIMEOUT_MESSAGE],
		);
		// Ждущие результата узнают сразу, а место базы освободилось — будим опрос агента.
		for (const x of r.rows as { id: string; agent_id: string }[]) {
			this.bell.emit("result:" + x.id);
			this.bell.emit(x.agent_id);
		}
		return r.rowCount ?? 0;
	}

	/** Когда последний раз снималась просрочка — чтобы опросы панели не делали это чаще, чем нужно. */
	private lastSweepAt = 0;

	/**
	 * СНЯТЬ ПРОСРОЧЕННОЕ И «НЕКОМУ ЗАБРАТЬ» — ПО ТАЙМЕРУ (Н4 аудита 26.09).
	 *
	 * Раньше это делали только опросы панели (`GET /commands/:id`, `/batches`): никто не открыл панель — потерянная
	 * выданная команда навсегда занимала место базы, и чат с ночными проверками получали «база занята». Теперь
	 * сервис зовёт это раз в полминуты сам, а опросы панели — не чаще `minIntervalMs` (каждый вызов — два UPDATE).
	 */
	async sweep(silentSecs: number, minIntervalMs = 0): Promise<{ overdue: number; orphaned: number }> {
		const now = Date.now();
		if (minIntervalMs > 0 && now - this.lastSweepAt < minIntervalMs) return { overdue: 0, orphaned: 0 };
		this.lastSweepAt = now;
		const overdue = await this.expireOverdue();
		const orphaned = await this.expireOrphaned(silentSecs);
		return { overdue, orphaned };
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
	/**
	 * ВЫПУСТИТЬ ОТЛОЖЕННУЮ КОМАНДУ (exclusiveOps.ts): подготовка базы закончена — снять `available_at`, чтобы
	 * ближайший опрос агента её забрал. Только для ещё не выданной; иначе `false`.
	 */
	async release(id: string): Promise<boolean> {
		const r = await this.db.query<{ agent_id: string }>(
			`UPDATE commands SET available_at = NULL WHERE id = $1 AND state = 'queued' RETURNING agent_id`,
			[id],
		);
		const row = r.rows[0];
		if (!row) return false;
		this.bell.emit(row.agent_id);
		return true;
	}

	/**
	 * ЗАВЕРШИТЬ ОТКАЗОМ КОМАНДУ, КОТОРУЮ АГЕНТУ НЕ ОТДАВАЛИ: подготовка базы не удалась (не закрылся вход, не снялись
	 * сеансы) — задание должно показать причину у этой базы, а не «отменена» без объяснения и не вечное «в очереди».
	 */
	async failQueued(id: string, error: { code: string; message: string; details?: unknown }): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE commands
			    SET state = 'failed', result_status = 'ERROR', error = $2::jsonb, finished_at = now()
			  WHERE id = $1 AND state = 'queued'`,
			[id, JSON.stringify(error)],
		);
		const ok = (r.rowCount ?? 0) > 0;
		if (ok) this.bell.emit("result:" + id);
		return ok;
	}

	/**
	 * Последняя команда агента с этим requestId — итог шага подготовки монопольной операции, ответа на который
	 * раннер не дождался (перезапуск сервиса, молчание агента): ставился ли запрет заданий, закрывался ли вход.
	 */
	async getByRequestId(agentId: string, requestId: string): Promise<CommandRow | null> {
		const r = await this.db.query<CommandRow>(
			`SELECT * FROM commands WHERE agent_id = $1 AND request_id = $2 ORDER BY created_at DESC LIMIT 1`,
			[agentId, requestId],
		);
		return r.rows[0] ?? null;
	}

	/** Дописать ключи в payload команды (состояние монопольной операции — exclusiveOps.ts): верхний уровень сливается. */
	async patchPayload(id: string, patch: Record<string, unknown>): Promise<void> {
		await this.db.query(`UPDATE commands SET payload = payload || $2::jsonb WHERE id = $1`, [id, JSON.stringify(patch)]);
	}

	/**
	 * Монопольные операции, у которых база ещё не возвращена в прежнее состояние (`payload.exclusive` без
	 * `restored`) — для восстановления после перезапуска сервиса. Не старше двух суток: дальше вернуть уже нечего.
	 * Переданная копии-повтору (`movedTo`, КР-12) — не в списке: её состояние живёт в копии.
	 */
	async listExclusivePending(types: readonly string[]): Promise<ExclusivePendingRow[]> {
		const r = await this.db.query<ExclusivePendingRow>(
			`SELECT id, agent_id, organization_uuid, base_key, state, ttl_seconds, payload->'exclusive' AS exclusive
			   FROM commands
			  WHERE type = ANY($1::text[]) AND payload ? 'exclusive'
			    AND COALESCE((payload->'exclusive'->>'restored')::boolean, false) = false
			    AND NOT (payload->'exclusive' ? 'movedTo')
			    AND created_at > now() - interval '2 days'
			  ORDER BY created_at`,
			[[...types]],
		);
		return r.rows;
	}

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
		// Отметка остановки (аудит 26.09): выданная команда задания, вернувшая «база занята», больше не повторяется
		// (retryBusy) — раньше остановленное задание продолжалось своими повторами.
		await this.db.query(`UPDATE command_batches SET canceled_at = COALESCE(canceled_at, now()) WHERE id = $1`, [batchId]);
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

	private async dispatchQueued(agentId: string, instanceId: string | null = null, parallel?: number): Promise<WireCommand[]> {
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
		/*
		 * ВЫДАЧА — ПОД ЗАМКОМ НА АГЕНТА (А1, аудит 21.09). Места считались одним запросом, а команды выдавались
		 * другим: два одновременных опроса одного агента (два его процесса, переоткрытие опроса) видели одинаковое
		 * число занятых мест и получали по полному пределу каждый — в базу уходили две внутрибазовые команды, и
		 * вторая падала с «база занята». Консультативная блокировка на время выдачи стоит доли миллисекунды и
		 * сериализует только опросы ОДНОГО агента.
		 */
		const client = await this.db.connect();
		let batch: WireCommand[];
		try {
			await client.query("BEGIN");
			await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agent-dispatch:${agentId}`]);
			batch = await this.dispatchLocked(client, agentId, instanceId, parallel);
			await client.query("COMMIT");
		} catch (e) {
			await client.query("ROLLBACK").catch(() => {});
			throw e;
		} finally {
			client.release();
		}
		/*
		 * УЧЁТНЫЕ ДАННЫЕ — ПОСЛЕ ТРАНЗАКЦИИ (аудит 26.09). Раньше они подставлялись внутри неё, а authResolver брал
		 * СВОИ соединения из того же пула: десять одновременных выдач держали все десять соединений и ждали
		 * одиннадцатое — взаимная блокировка без срока. Выдача уже записана; пароль нужен только ответу агенту.
		 */
		return this.withAuth(agentId, batch);
	}

	/** Подставить учётные записи баз в выданные команды (только в ответ агенту — в БД пароль не пишется). */
	private async withAuth(agentId: string, wire: WireCommand[]): Promise<WireCommand[]> {
		if (!this.authResolver || !wire.length) return wire;
		const keys = [...new Set(wire.map((c) => c.baseKey).filter((k): k is string => !!k))];
		if (!keys.length) return wire;
		const auth = await this.authResolver(agentId, keys);
		if (!auth.size) return wire;
		for (const c of wire) {
			const a = c.baseKey ? auth.get(c.baseKey) : undefined;
			// `auth` в payload = «если свой администратор не прошёл, войди этим».
			// Порядок попыток задаёт агент, см. контракт.
			if (a) c.payload = { ...c.payload, auth: a };
		}
		return wire;
	}

	/** Сама выдача: считает свободные места и забирает команды. Вызывается внутри транзакции с замком на агента. */
	private async dispatchLocked(
		db: Pick<Db, "query">, agentId: string, instanceId: string | null, parallel?: number,
	): Promise<WireCommand[]> {
		const busy = await db.query<{ n: string }>(
			`SELECT count(*) AS n FROM commands d
			  WHERE d.agent_id = $1 AND ${IN_BASE("d")} AND ${OCCUPIES("d", "$2")}`,
			[agentId, this.lateGraceSecs],
		);
		const limit = parallel && parallel > 0 ? parallel : this.ibParallel;
		const slots = Math.max(0, limit - Number(busy.rows[0]?.n ?? 0));

		const r = await db.query<CommandRow>(
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
			 -- Срок выполнения — от ВЫДАЧИ (С2): ожидание очереди в него не входит. Прежний срок ожидания
			 -- (prev) возвращается рядом — команде, которую вернёт в очередь оборванный опрос (requeue, I8).
			 -- state = 'queued' в самом UPDATE: отменённая между выборкой и записью не выдаётся (КР-12 п. 4).
			 UPDATE commands u SET state = 'dispatched', dispatched_at = now(), dispatched_instance = $3,
			        expires_at = CASE WHEN ttl_seconds IS NOT NULL
			                          THEN now() + make_interval(secs => ttl_seconds) ELSE u.expires_at END
			   FROM (SELECT id, expires_at AS queue_expires_at FROM commands WHERE id IN (
			    -- Кластерные — все, они дешёвые и независимые.
			    SELECT id FROM candidates WHERE rn = 1 AND NOT ib
			    UNION ALL
			    -- Внутрибазовые — только сколько осталось свободных мест у агента.
			    SELECT id FROM ranked WHERE ib_rank <= $2
			  )) prev
			  WHERE u.id = prev.id AND u.state = 'queued'
			  RETURNING u.*, prev.queue_expires_at`,
			[agentId, slots, instanceId, this.lateGraceSecs],
		);
		const wire = (r.rows as (CommandRow & { queue_expires_at?: Date | null })[]).map((c) => {
			// Состояние подготовки монопольной операции (КР-12) — дело сервиса, агенту оно ни к чему.
			const { exclusive: _state, ...payload } = c.payload ?? {};
			const w: WireCommand = {
				id: c.id,
				...(c.request_id ? { requestId: c.request_id } : {}),
				...(c.base_key ? { baseKey: c.base_key } : {}),
				type: c.type,
				payload,
				...(c.expires_at ? { expiresAt: new Date(c.expires_at).toISOString() } : {}),
			};
			if (c.queue_expires_at) this.queueDeadlines.set(w, new Date(c.queue_expires_at));
			return w;
		});

		// Учётные данные баз подставляются после транзакции — см. dispatchQueued/withAuth.
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
			// Файл выполненной установки больше не нужен никому (С3, 28.09): повторяют только неуспешные.
			if (row.state === "done" && row.type === INSTALL_EXTENSION_TYPE) return this.scrubInstalled(row);
		}
		return row;
	}

	/**
	 * ФАЙЛ ВЫПОЛНЕННОЙ УСТАНОВКИ — СРАЗУ В СВОДКУ (С3, 28.09). Отдельным запросом ПОСЛЕ закрытия: результат агента уже
	 * принят, и сбой очистки его не отменяет — пишем в журнал, файл уберёт ежечасный проход (scrubStoredContent).
	 * Меняются только два ключа (`payload - … || …`), а не payload целиком: раннер монопольной операции в это же время
	 * дописывает своё состояние (`patchPayload`), и запись целиком затёрла бы его.
	 */
	private async scrubInstalled(row: CommandRow): Promise<CommandRow> {
		const content = row.payload?.contentBase64;
		if (typeof content !== "string") return row;
		try {
			const digest = contentDigest(content);
			await this.db.query(
				`UPDATE commands SET payload = (payload - 'contentBase64') || jsonb_build_object('contentDigest', $2::jsonb)
				  WHERE id = $1 AND payload ? 'contentBase64'`,
				[row.id, JSON.stringify(digest)],
			);
			const { contentBase64: _file, ...rest } = row.payload;
			return { ...row, payload: { ...rest, contentDigest: digest } };
		} catch (e) {
			this.log?.warn({ commandId: row.id, err: e instanceof Error ? e.message : String(e) },
				"установка расширения: файл в журнале команд не заменён сводкой — уберёт ежечасная очистка");
			return row;
		}
	}

	/**
	 * ФАЙЛЫ .cfe, КОТОРЫЕ БОЛЬШЕ НЕ НУЖНЫ, — В СВОДКУ `{size, sha256}` (С3, 28.09). Ежечасно (server.ts):
	 *  - установка, закрытая неуспехом (failed, canceled, expired), — через сутки после закрытия: до того файл берут
	 *    «Повторить неуспешные» и повтор «база занята» (retryBusy) — из самой команды, в задании его нет;
	 *  - выполненная установка, чей файл не убрал `complete` (сбой очистки, строки до 28.09), — сразу;
	 *  - выгрузка (done) — через час: панель забирает файл по /commands/:id, как только команда выполнена.
	 * Порциями по `batch` строк, каждая — свой запрос: файл весит полмегабайта, и проход не держит весь журнал в
	 * одном ответе базы и одной транзакции. Идемпотентно: берутся только строки, где файл ещё лежит.
	 */
	async scrubStoredContent(opts: { batch?: number; maxPasses?: number } = {}): Promise<{ installs: number; exports: number }> {
		const batch = Math.max(1, Math.floor(opts.batch ?? CONTENT_SCRUB_BATCH));
		// Первый проход после выкладки разбирает накопленное за полгода; предел — чтобы и он кончался за разумное время.
		const maxPasses = Math.max(1, Math.floor(opts.maxPasses ?? 100));
		const total = { installs: 0, exports: 0 };
		for (let pass = 0; pass < maxPasses; pass++) {
			const inst = await this.scrubInstallPass(batch);
			const exp = await this.scrubExportPass(batch);
			total.installs += inst.scrubbed;
			total.exports += exp.scrubbed;
			// Обе порции неполные — старше срока больше нечего. Строки нашлись, а не очищена ни одна (их успели
			// изменить между выборкой и записью) — следующий проход дал бы тот же ответ: до следующего часа.
			if ((inst.found < batch && exp.found < batch) || inst.scrubbed + exp.scrubbed === 0) break;
		}
		return total;
	}

	private async scrubInstallPass(batch: number): Promise<{ found: number; scrubbed: number }> {
		const r = await this.db.query<{ id: string; content: string | null }>(
			`SELECT id, payload->>'contentBase64' AS content FROM commands
			  WHERE type = $1 AND payload ? 'contentBase64'
			    AND (state = 'done'
			         OR (state IN ('failed', 'canceled', 'expired')
			             AND COALESCE(finished_at, created_at) < now() - make_interval(secs => $2::int)))
			  ORDER BY created_at LIMIT $3`,
			[INSTALL_EXTENSION_TYPE, INSTALL_CONTENT_KEEP_FAILED_SECS, batch],
		);
		if (!r.rows.length) return { found: 0, scrubbed: 0 };
		const u = await this.db.query(
			`UPDATE commands c
			    SET payload = (c.payload - 'contentBase64') || jsonb_build_object('contentDigest', x.digest)
			   FROM jsonb_each($1::jsonb) AS x(id, digest)
			  WHERE c.id = x.id AND c.payload ? 'contentBase64'`,
			[JSON.stringify(digestsById(r.rows))],
		);
		return { found: r.rows.length, scrubbed: u.rowCount ?? 0 };
	}

	/**
	 * Файл выгрузки лежит в корне результата (`{ok, name, fileName, size, contentBase64, via}`); сборка, положившая
	 * конверт шлюза целиком, держит его в `data` (unwrapData, accountingChecks.ts) — чистим там, где лежит. `size`
	 * агента остаётся как есть, сводка — рядом.
	 */
	private async scrubExportPass(batch: number): Promise<{ found: number; scrubbed: number }> {
		const holds = (a: string) => `jsonb_typeof(${a}.result) = 'object'
			AND (${a}.result ? 'contentBase64' OR (jsonb_typeof(${a}.result->'data') = 'object' AND ${a}.result->'data' ? 'contentBase64'))`;
		const r = await this.db.query<{ id: string; content: string | null }>(
			`SELECT c.id, CASE WHEN c.result ? 'contentBase64' THEN c.result->>'contentBase64'
			                   ELSE c.result->'data'->>'contentBase64' END AS content
			   FROM commands c
			  WHERE c.type = $1 AND c.state = 'done' AND ${holds("c")}
			    AND COALESCE(c.finished_at, c.created_at) < now() - make_interval(secs => $2::int)
			  ORDER BY c.created_at LIMIT $3`,
			[EXPORT_EXTENSION_TYPE, EXPORT_CONTENT_KEEP_SECS, batch],
		);
		if (!r.rows.length) return { found: 0, scrubbed: 0 };
		// Скобки вокруг `result->'data'` обязательны: `-` в Postgres связывает сильнее `->`, и без них выходит
		// `result -> ('data' - 'contentBase64')` — «operator is not unique: unknown - unknown».
		const u = await this.db.query(
			`UPDATE commands c
			    SET result = CASE WHEN c.result ? 'contentBase64'
			                      THEN (c.result - 'contentBase64') || jsonb_build_object('contentDigest', x.digest)
			                      ELSE jsonb_set(c.result, '{data}',
			                                     ((c.result->'data') - 'contentBase64') || jsonb_build_object('contentDigest', x.digest)) END
			   FROM jsonb_each($1::jsonb) AS x(id, digest)
			  WHERE c.id = x.id AND ${holds("c")}`,
			[JSON.stringify(digestsById(r.rows))],
		);
		return { found: r.rows.length, scrubbed: u.rowCount ?? 0 };
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
	 *
	 * `hold` — ПОВТОР МОНОПОЛЬНОЙ ОПЕРАЦИИ ЕЁ ЖЕ РАННЕРОМ (КР-12 п. 1 аудита 27.09): копия удержана до `release()`
	 * (раннер снова снимет сеансы и выпустит её сам) и получает состояние подготовки (`exclusive`), а у исходной
	 * отмечается `movedTo` — восстановление после перезапуска видит одну команду операции, а не две. Всё — одним
	 * запросом: состояние не теряется между копией и отметкой.
	 */
	async retryBusy(id: string, queueWaitSeconds: number, opts: { hold?: boolean } = {}): Promise<string | null> {
		const next = "cmd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
		const r = await this.db.query<{ id: string; agent_id: string }>(
			`WITH src AS (
			    SELECT * FROM commands
			     WHERE id = $1 AND state = 'failed' AND batch_id IS NOT NULL
			       AND retried_by IS NULL AND attempt < $3
			       -- Остановленное задание не продолжается повторами (аудит 26.09).
			       AND NOT EXISTS (SELECT 1 FROM command_batches b WHERE b.id = commands.batch_id AND b.canceled_at IS NOT NULL)
			 ), ins AS (
			    INSERT INTO commands (id, agent_id, organization_uuid, base_key, request_id, type, payload,
			                          user_uuid, conversation_id, expires_at, priority, batch_id,
			                          in_base, ttl_seconds, attempt, available_at)
			    SELECT $2, agent_id, organization_uuid, base_key, NULL, type,
			           CASE WHEN $7::boolean THEN payload ELSE payload - 'exclusive' END,
			           user_uuid, conversation_id,
			           now() + make_interval(secs => $4::int + (ARRAY[$5::int, $6::int])[LEAST(attempt, 2)]),
			           priority, batch_id, in_base, ttl_seconds, attempt + 1,
			           CASE WHEN $7::boolean
			                THEN now() + make_interval(secs => $4::int + (ARRAY[$5::int, $6::int])[LEAST(attempt, 2)]) + ${HELD_AFTER_EXPIRY}
			                ELSE now() + make_interval(secs => (ARRAY[$5::int, $6::int])[LEAST(attempt, 2)]) END
			      FROM src
			    RETURNING id, agent_id
			 ), mark AS (
			    UPDATE commands SET retried_by = $2,
			           payload = CASE WHEN $7::boolean AND jsonb_typeof(payload->'exclusive') = 'object'
			                          THEN jsonb_set(payload, '{exclusive,movedTo}', to_jsonb($2::text)) ELSE payload END
			     WHERE id IN (SELECT id FROM src) AND EXISTS (SELECT 1 FROM ins)
			 )
			 SELECT id, agent_id FROM ins`,
			[id, next, BUSY_MAX_ATTEMPTS, Math.max(30, queueWaitSeconds), BUSY_RETRY_DELAYS_SECS[0], BUSY_RETRY_DELAYS_SECS[1],
				opts.hold === true],
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
			// Продление НЕ СОКРАЩАЕТ срок (аудит 21.09): у команды, идущей дольше суток (выгрузка, загрузка), потолок
			// «выдача + 24 ч» оказывался в прошлом, и подтверждение работы объявляло её просроченной.
			`UPDATE commands c
			    SET expires_at = GREATEST(c.expires_at,
			                              LEAST(now() + make_interval(secs => $3::int),
			                                    c.dispatched_at + make_interval(secs => $4::int))),
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

	/**
	 * Команды агента для его карточки (п. 2): всё незавершённое и последние завершённые — что стоит в очереди, что
	 * выполняется и чем кончилось. Без тела payload: в нём бывают выписки и пароли (auth подставляется при выдаче,
	 * но и прочее — не для списка).
	 */
	async listForAgent(agentId: string, limit = 50): Promise<CommandRow[]> {
		const r = await this.db.query<CommandRow>(
			`(SELECT * FROM commands WHERE agent_id = $1 AND state IN ('queued', 'dispatched') ORDER BY created_at LIMIT 200)
			 UNION ALL
			 (SELECT * FROM commands WHERE agent_id = $1 AND state NOT IN ('queued', 'dispatched') ORDER BY created_at DESC LIMIT $2)`,
			[agentId, Math.min(Math.max(limit, 1), 200)],
		);
		return r.rows;
	}

	async get(id: string): Promise<CommandRow | null> {
		const r = await this.db.query<CommandRow>(`SELECT * FROM commands WHERE id = $1`, [id]);
		return r.rows[0] ?? null;
	}

	/**
	 * БАЗЫ, В КОТОРЫХ СЕЙЧАС ИДЁТ ОБСЛУЖИВАНИЕ (P2 отчёта очереди, аудит 26.09): незавершённые команды агентов
	 * кластера — выгрузка, загрузка, проверка, обновление, блокировка входа. Очередь выстраивает команды одной базы
	 * только в пределах ОДНОГО агента, а ночные проверки учёта идут через бизнес-агента: без этой выборки проверка
	 * и выгрузка шли в одну базу одновременно — отказы проверок и IB_BUSY у выгрузки. Ключи — в нижнем регистре.
	 */
	/*
	 * ТОЛЬКО ОБСЛУЖИВАНИЕ И ТОЛЬКО ТО, ЧТО ИДЁТ СЕЙЧАС (КР-12 п. 5 аудита 27.09). Раньше считалась любая незавершённая
	 * команда агента кластера: отложенная на 12 ч монопольная операция и любое чтение (IB_LIST_*) выбрасывали базу из
	 * ночных проверок на всю ночь. Теперь — типы обслуживания (MAINTENANCE_TYPES), уже доступные к выдаче, и база,
	 * которую монопольная операция держит закрытой (вход закрыт, база ещё не возвращена).
	 */
	async basesUnderMaintenance(): Promise<Set<string>> {
		const r = await this.db.query<{ key: string }>(
			`SELECT DISTINCT lower(c.base_key) AS key
			   FROM commands c JOIN agents a ON a.id = c.agent_id
			  WHERE c.base_key IS NOT NULL AND a.role = 'admin' AND (
			        (c.state IN ('queued', 'dispatched') AND c.type = ANY($1::text[])
			         AND (c.available_at IS NULL OR c.available_at <= now()))
			     OR (c.payload->'exclusive'->>'locked' = 'true'
			         AND COALESCE(c.payload->'exclusive'->>'restored', 'false') <> 'true'
			         AND NOT (c.payload->'exclusive' ? 'movedTo')
			         AND c.created_at > now() - interval '2 days'))`,
			[[...MAINTENANCE_TYPES]],
		);
		return new Set(r.rows.map((x) => x.key));
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
		/** Чьи данные (В4): по ней панель решает, показывать ли команду. */
		organizationUuid: string | null;
	}[]> {
		const r = await this.db.query<{
			id: string; type: string; base_key: string | null; agent_id: string; age_secs: string | null;
			payload: Record<string, unknown> | null; can_cancel: boolean | null; can_cancel_check: boolean | null;
			organization_uuid: string | null;
		}>(
			`SELECT c.id, c.type, c.base_key, c.agent_id, c.payload, c.organization_uuid,
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
			organizationUuid: x.organization_uuid,
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
