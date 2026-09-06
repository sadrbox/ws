// Администрирование 1С: базы, сеансы, соединения (E15/A5).
//
// Все вызовы идут в AI Service (`/v1/onec/*`), а он ставит команду админ-агенту, который
// работает с кластером через `rac`. Здесь только транспорт и типы — решения о правах,
// маршрутизации и подтверждениях принимает сервис.

import { aiFetch } from "src/services/ai/endpoint";

export type OnecBase = {
	id: string;
	serverId: string;
	serverName: string;
	/** Имя базы в кластере — им она адресуется в командах. */
	key: string;
	name: string;
	status: string;
	onecVersion: string | null;
	/** Версия расширения buhprof_api по данным heartbeat бизнес-агента; null — неизвестно. */
	extVersion: string | null;
	/** UUID базы в кластере — по нему сеансы ссылаются на базу. */
	infobaseId: string | null;
	/** Сколько расширений видели в базе; null — базу ещё ни разу не проверяли. */
	extensionsCount: number | null;
	extensionsSeenAt: string | null;
	/** Имена расширений из кэша — по ним отбираются базы БЕЗ нужного расширения. */
	extensionNames: string[];
	sessionsCount: number | null;
	lastSeenAt: string | null;
	disabled: boolean;
	/**
	 * Публикация на веб-сервере: null — не проверялась, false — точно не опубликована.
	 * Различать важно: первое значит «спроси агента», второе — «нужно публиковать».
	 */
	published: boolean | null;
	publishUrl: string | null;
};

/** Строка сеанса или соединения: состав полей задаёт `rac`, поэтому словарь, а не жёсткий тип. */
export type ClusterRow = Record<string, string>;

/**
 * Ответ команды, которая не успела выполниться за время HTTP-запроса.
 *
 * Вход в базу занимает у агента от 20 секунд до 15 минут — держать столько открытый
 * запрос нельзя: туннель обрывает его СВОИМ ответом, без заголовков CORS, и браузер
 * показывает это как ошибку CORS (симптом, который мы ловили трижды). Поэтому сервис
 * отвечает 202 с идентификатором команды, а клиент дожидается короткими опросами.
 */
type Pending = { pending: true; commandId: string };
const isPending = (d: unknown): d is Pending =>
	!!d && typeof d === "object" && (d as Pending).pending === true;

/** Дождаться готовности команды. Пауза 2 с: операция идёт минутами, чаще спрашивать незачем. */
async function awaitCommand<T>(first: T | Pending, limitMs = 15 * 60_000): Promise<T> {
	let data = first;
	const until = Date.now() + limitMs;
	while (isPending(data)) {
		if (Date.now() > until) throw new Error("Команда 1С выполняется слишком долго");
		await new Promise((r) => setTimeout(r, 2000));
		data = await aiFetch<T | Pending>(`/v1/onec/commands/${encodeURIComponent(data.commandId)}`);
	}
	return data;
}

export const fetchBases = () => aiFetch<{ items: OnecBase[] }>("/v1/onec/bases");

/**
 * Перечитать список баз у кластера. Возвращает уже обновлённый реестр.
 * Если агент не успел ответить за отведённое запросу время — дожидаемся опросом, а затем
 * перечитываем реестр: применение среза выполняется на приёме результата, в сервисе.
 */
export const refreshBases = () =>
	aiFetch<{ items: OnecBase[] } | Pending>("/v1/onec/bases/refresh", { method: "POST" })
		.then((d) => (isPending(d) ? awaitCommand<{ items: unknown[] }>(d).then(() => fetchBases()) : d));

/**
 * Сеансы ВСЕГО кластера, одним запросом.
 *
 * По базе не фильтруем на стороне агента: у него отбор по baseKey ломается там, где сеансов
 * нет, и вместо пустого списка приходило «база не найдена в кластере». Срез кластера и так
 * приходит за доли секунды, а каждая строка несёт UUID своей базы (`infobase`) — отобрать
 * нужные дешевле и надёжнее на месте.
 */
export const fetchSessions = () =>
	aiFetch<{ items: ClusterRow[] } | Pending>("/v1/onec/sessions")
		.then((d) => awaitCommand<{ items: ClusterRow[] }>(d));

export const fetchConnections = (baseKey?: string) =>
	aiFetch<{ items: ClusterRow[] } | Pending>(`/v1/onec/connections${baseKey ? `?baseKey=${encodeURIComponent(baseKey)}` : ""}`)
		.then((d) => awaitCommand<{ items: ClusterRow[] }>(d));

/**
 * Снятие сеанса необратимо: несохранённые данные пользователя теряются.
 * `sessionId` — UUID сеанса кластера (поле `session` в строке rac), а не его номер:
 * `rac session terminate --session=` принимает только UUID и на номер отвечает
 * «Ошибка разбора параметра: session».
 */
export const terminateSession = (sessionId: string, baseKey?: string) =>
	aiFetch<{ ok: boolean } | Pending>(`/v1/onec/sessions/${encodeURIComponent(sessionId)}/terminate`, {
		method: "POST",
		body: JSON.stringify(baseKey ? { baseKey } : {}),
	}).then((d) => awaitCommand<{ ok: boolean }>(d));

/** Блокировка начала сеансов: пользователи не смогут войти в базу, уже вошедшие продолжат работу. */
export const setSessionsLock = (baseKey: string, enabled: boolean, message?: string) =>
	aiFetch<{ ok: boolean } | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/lock`, {
		method: "POST",
		body: JSON.stringify({ enabled, ...(message ? { message } : {}) }),
	}).then((d) => awaitCommand<{ ok: boolean }>(d));

// ── Содержимое базы: пользователи ИБ и расширения (E15/A3-P1) ───────────────
// Списки спрашиваются у 1С вживую (это команда агенту), сводки — из кэша сервиса.

export type IbUser = { name: string; fullName?: string; disabled?: boolean; roles?: string[] };
export type IbExtension = {
	name: string;
	/** Синоним — человеческое имя расширения; служебное Имя часто нечитаемо. */
	synonym?: string | null;
	version?: string | null; purpose?: string | null; safeMode?: boolean | null;
};

export const fetchBaseUsers = (baseKey: string) =>
	aiFetch<{ items: IbUser[] } | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/users`)
		.then((d) => awaitCommand<{ items: IbUser[] }>(d));

export const fetchBaseExtensions = (baseKey: string) =>
	aiFetch<{ items: IbExtension[] } | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/extensions`)
		.then((d) => awaitCommand<{ items: IbExtension[] }>(d));

/** Сводка «кто есть в скольких базах» — из кэша, без обращения к 1С. */
export const fetchUserSummary = () =>
	aiFetch<{ items: { name: string; bases: number; disabled: number }[] }>("/v1/onec/users");

/** Где встречается пользователь — ответ на «покажи его во всех базах». */
export type UserOccurrence = {
	baseKey: string; baseName: string; serverName: string;
	fullName: string; disabled: boolean; roles: string[]; seenAt: string;
};
export const fetchUserOccurrences = (name: string) =>
	aiFetch<{ items: UserOccurrence[] }>(`/v1/onec/users/${encodeURIComponent(name)}`);

/** Сводка расширений по всем базам: группировка по паре имя+синоним. */
export const fetchExtensionSummary = () =>
	aiFetch<{ items: { name: string; synonym: string; bases: number; versions: string[] }[] }>("/v1/onec/extensions");

// ── Пакетные операции (E15/A4) ──────────────────────────────────────────────
// Сервис отвечает СРАЗУ идентификатором задания: сто подключений к 1С в один HTTP-запрос
// не укладываются. Прогресс — опросом fetchBatch.

export type BatchType =
	| "IB_CREATE_USER" | "IB_DELETE_USER"
	| "IB_INSTALL_EXTENSION" | "IB_DELETE_EXTENSION"
	// Публикация базы на веб-сервере — первый шаг раскатки (публикация → расширение → HTTP).
	| "IB_PUBLISH"
	// Чтение тоже пакетное: наполнить сводку по ста базам поштучно нереально.
	| "IB_LIST_USERS" | "IB_LIST_EXTENSIONS";

export type BatchStart = {
	batchId: string; total: number; queued: number;
	/** Базы, до которых команда не дошла (нет агента, не та способность) — с причиной. */
	skipped: { baseKey: string; reason: string }[];
};

export const runBatch = (type: BatchType, baseKeys: string[], payload: Record<string, unknown>) =>
	aiFetch<BatchStart>("/v1/onec/batch", { method: "POST", body: JSON.stringify({ type, baseKeys, payload }) });

export type BatchProgress = {
	id: string; type: string; total: number; done: number; failed: number; pending: number;
	createdAt: string;
	items: { baseKey: string | null; state: string; error: { code: string; message: string } | null }[];
};

export const fetchBatch = (id: string) => aiFetch<BatchProgress>(`/v1/onec/batches/${encodeURIComponent(id)}`);
export const fetchBatches = () => aiFetch<{ items: BatchProgress[] }>("/v1/onec/batches");

// ── Агенты, которых видит панель ────────────────────────────────────────────
// Способности решают, что вообще возможно: без `ib.admin` операции ВНУТРИ баз
// (пользователи, расширения) не выполнит никто, и знать это нужно заранее.

export type OnecAgent = {
	id: string; name: string; role: "business" | "admin";
	online: boolean; capabilities: string[]; lastSeenAt: string | null; disabled: boolean;
};

/** Вместе с агентами приходят лимиты: число одновременных проверок задаёт сервис. */
export const fetchAgents = () =>
	aiFetch<{ items: OnecAgent[]; limits: { checkParallel: number } }>("/v1/onec/agents");

/** Есть ли на связи админ-агент с нужной способностью. */
export const hasCapability = (agents: OnecAgent[] | undefined, capability: string): boolean =>
	(agents ?? []).some((a) => a.role === "admin" && a.online && !a.disabled && a.capabilities.includes(capability));

/** Повторить только неуспешные базы задания — создаётся новое задание. */
export const retryBatch = (id: string) =>
	aiFetch<BatchStart>(`/v1/onec/batches/${encodeURIComponent(id)}/retry`, { method: "POST" });

// ── Управление агентами ─────────────────────────────────────────────────────
// Токен возвращается ОДИН раз при создании и при ротации: в БД лежит только его
// SHA-256, восстановить нельзя.

export const createAgent = (name: string) =>
	aiFetch<{ agent: OnecAgent; token: string }>("/v1/onec/agents", {
		method: "POST", body: JSON.stringify({ name }),
	});

export const rotateAgentToken = (id: string) =>
	aiFetch<{ token: string }>(`/v1/onec/agents/${encodeURIComponent(id)}/rotate-token`, { method: "POST" });

export const setAgentDisabled = (id: string, disabled: boolean) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/agents/${encodeURIComponent(id)}/${disabled ? "disable" : "enable"}`, { method: "POST" });

// ── Состояние сервера: блокировки, процессы, лицензии (E15) ─────────────────
// Всё читающее, всё идёт через rac и не заходит в базы. Форму строк задаёт rac,
// поэтому словарь строк — как у сеансов и соединений.

/** Кто кого держит. «База висит» почти всегда означает блокировку. */
export const fetchLocks = (baseKey?: string) =>
	aiFetch<{ items: ClusterRow[] } | Pending>(`/v1/onec/locks${baseKey ? `?baseKey=${encodeURIComponent(baseKey)}` : ""}`)
		.then((d) => awaitCommand<{ items: ClusterRow[] }>(d));

/** Рабочие процессы кластера: память, доступность, распределение баз. */
export const fetchProcesses = () =>
	aiFetch<{ items: ClusterRow[] } | Pending>("/v1/onec/processes")
		.then((d) => awaitCommand<{ items: ClusterRow[] }>(d));

/** Кто держит лицензии — единственный способ понять отказы при одновременной работе. */
export const fetchLicenses = () =>
	aiFetch<{ items: ClusterRow[] } | Pending>("/v1/onec/licenses")
		.then((d) => awaitCommand<{ items: ClusterRow[] }>(d));

/** Разрыв соединения необратим — как и снятие сеанса. Адресуется UUID соединения. */
export const disconnectConnection = (connectionId: string, baseKey?: string) =>
	aiFetch<{ ok: boolean } | Pending>(`/v1/onec/connections/${encodeURIComponent(connectionId)}/disconnect`, {
		method: "POST", body: JSON.stringify(baseKey ? { baseKey } : {}),
	}).then((d) => awaitCommand<{ ok: boolean }>(d));
