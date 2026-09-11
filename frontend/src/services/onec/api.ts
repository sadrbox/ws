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

/**
 * Дождаться готовности команды после ответа 202 `{pending, commandId}`.
 *
 * ПОЧЕМУ ОПРОС ВООБЩЕ. Сервис ждёт агента ONEC_COMMAND_TIMEOUT_SECS и, если тот не успел,
 * отвечает 202 с идентификатором команды. Держать HTTP-запрос дольше нельзя: вход в базу
 * занимает у агента до 15 минут, а туннель обрывает такой запрос СВОИМ ответом — без
 * заголовков CORS, и браузер показывает это как ошибку CORS вместо результата.
 *
 * ПАУЗА РАСТЁТ. Первые ответы ждём часто (команда может завершиться сразу), дальше реже:
 * ровная пауза в 2 секунды на пятнадцатиминутной команде давала 450 запросов подряд — в
 * консоли это выглядит как непрерывный поток, а узнаём мы из него ровно то же самое.
 * С нарастанием до 10 секунд их остаётся около шестидесяти.
 */
async function awaitCommand<T>(first: T | Pending, limitMs = 15 * 60_000): Promise<T> {
	let data = first;
	let pauseMs = 1000;
	const until = Date.now() + limitMs;
	while (isPending(data)) {
		if (Date.now() > until) throw new Error("Команда 1С выполняется слишком долго");
		await new Promise((r) => setTimeout(r, pauseMs));
		pauseMs = Math.min(10_000, Math.round(pauseMs * 1.5));
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

/** `seenAt` — когда это читали у самой 1С: из кэша реестра либо проставлено чтением. */
export type IbUser = {
	name: string; fullName?: string; disabled?: boolean; roles?: string[];
	seenAt?: string | null;
};
export type IbExtension = {
	name: string;
	/** Синоним — человеческое имя расширения; служебное Имя часто нечитаемо. */
	synonym?: string | null;
	version?: string | null; purpose?: string | null; safeMode?: boolean | null;
	seenAt?: string | null;
};

export const fetchBaseUsers = (baseKey: string) =>
	aiFetch<{ items: IbUser[] } | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/users`)
		.then((d) => awaitCommand<{ items: IbUser[] }>(d));

export const fetchBaseExtensions = (baseKey: string) =>
	aiFetch<{ items: IbExtension[] } | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/extensions`)
		.then((d) => awaitCommand<{ items: IbExtension[] }>(d));

// ── Учётная запись администратора отдельной базы ───────────────────────────
// Агент знает одного администратора баз на всех; там, где он не подходит, база получает
// свою пару. Пароль сервис наружу не отдаёт — только признак «задан».

export type BaseCredentials = {
	baseKey: string;
	user: string;
	hasPassword: boolean;
	updatedAt: string | null;
	updatedBy: string | null;
};

export const fetchBaseCredentials = (baseKey: string) =>
	aiFetch<BaseCredentials>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/credentials`);

/** Пароль без изменения — не передавать поле вовсе: пустая строка значит «стереть». */
export const saveBaseCredentials = (baseKey: string, body: { user: string; password?: string }) =>
	aiFetch<BaseCredentials>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/credentials`, {
		method: "PUT", body: JSON.stringify(body),
	});

export const clearBaseCredentials = (baseKey: string) =>
	aiFetch<{ removed: boolean }>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/credentials`, { method: "DELETE" });

/** Сводка «кто есть в скольких базах» — из кэша, без обращения к 1С. */
export const fetchUserSummary = () =>
	aiFetch<{ items: { name: string; bases: number; disabled: number; roles: string[] }[] }>("/v1/onec/users");

/** Что делали с пользователем из панели: команды по его имени. */
export const fetchUserHistory = (name: string) =>
	aiFetch<{ items: { type: string; baseKey: string | null; state: string; createdAt: string; error: string | null }[] }>(
		`/v1/onec/users/${encodeURIComponent(name)}/history`);

/** Где встречается пользователь — ответ на «покажи его во всех базах». */
export type UserOccurrence = {
	baseKey: string; baseName: string; serverName: string;
	fullName: string; disabled: boolean; roles: string[]; seenAt: string;
};
export const fetchUserOccurrences = (name: string) =>
	aiFetch<{ items: UserOccurrence[] }>(`/v1/onec/users/${encodeURIComponent(name)}`);

/**
 * Обновить состояние публикаций: агент читает веб-сервер и отдаёт список опубликованных
 * баз. Без этого признак публикации у сотни баз оставался «не проверялся» до тех пор,
 * пока публикацию не сделают из панели.
 */
export const refreshPublications = () =>
	aiFetch<{ items: OnecBase[]; found: number }>("/v1/onec/publications/refresh", { method: "POST" });

/**
 * Роли для выбора при создании и изменении пользователя.
 *
 * Без `baseKey` — те, что уже встречались в базах (кэш реестра, без обращения к 1С).
 * С `live` — справочник конфигурации у самой базы: полный, но это команда агенту.
 */
export const fetchRoles = (baseKey?: string, live?: boolean) =>
	aiFetch<{ items: { name: string; users?: number; synonym?: string }[] } | Pending>(
		`/v1/onec/roles${baseKey ? `?baseKey=${encodeURIComponent(baseKey)}${live ? "&live=1" : ""}` : ""}`,
	).then((d) => awaitCommand<{ items: { name: string; users?: number; synonym?: string }[] }>(d));

/**
 * Пользователи базы ИЗ КЭША реестра — без обращения к 1С.
 * Тем и отличается от `fetchBaseUsers`: та читает живую базу и стоит десятки секунд.
 */
export const fetchBaseUsersCached = (baseKey: string) =>
	aiFetch<{ items: IbUser[] }>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/users/cached`);

/**
 * Расширения базы ИЗ КЭША реестра — без обращения к 1С.
 * Тем и отличается от `fetchBaseExtensions`: та входит в базу и стоит минуты.
 * `seenAt` — когда расширения этой базы читали у 1С в последний раз.
 */
export const fetchBaseExtensionsCached = (baseKey: string) =>
	aiFetch<{ items: IbExtension[] }>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/extensions/cached`);

/**
 * Сколько держателей роли в каждой базе — для защиты «последний администратор».
 * Кэш реестра, в 1С не ходит.
 */
export const fetchRoleHolders = (role: string) =>
	aiFetch<{ items: { baseKey: string; users: number }[] }>(
		`/v1/onec/roles/${encodeURIComponent(role)}/holders`);

/** Сводка расширений по всем базам: группировка по паре имя+синоним. */
export const fetchExtensionSummary = () =>
	aiFetch<{ items: { name: string; synonym: string; bases: number; versions: string[] }[] }>("/v1/onec/extensions");

// ── Пакетные операции (E15/A4) ──────────────────────────────────────────────
// Сервис отвечает СРАЗУ идентификатором задания: сто подключений к 1С в один HTTP-запрос
// не укладываются. Прогресс — опросом fetchBatch.

export type BatchType =
	| "IB_CREATE_USER" | "IB_DELETE_USER"
	| "IB_INSTALL_EXTENSION" | "IB_DELETE_EXTENSION"
	// Публикация базы на веб-сервере — первый шаг раскатки (публикация → расширение → HTTP);
	// снятие — обратная ей операция.
	| "IB_PUBLISH" | "IB_UNPUBLISH"
	// Изменение пользователя: незаполненное поле значит «не трогать», а не «очистить».
	| "IB_UPDATE_USER"
	// Выгрузка .dt: агент делает её ibcmd (без клиентской лицензии), запасной путь — конфигуратор.
	| "IB_BACKUP"
	// Проверка базы — единственная из обслуживания, которую имеет смысл гнать группой:
	// она ничего не меняет без флага «Исправлять».
	| "IB_CHECK"
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
	items: {
		baseKey: string | null; state: string; error: { code: string; message: string } | null;
		/** Итог одной строкой: путь к выгрузке или адрес публикации. */
		outcome: string | null;
	}[];
};

export const fetchBatch = (id: string) => aiFetch<BatchProgress>(`/v1/onec/batches/${encodeURIComponent(id)}`);
export const fetchBatches = () => aiFetch<{ items: BatchProgress[] }>("/v1/onec/batches");

// ── Обслуживание базы: проверка, загрузка, обновление конфигурации ──────────
// Все три долгие (часы) и все три понимают dryRun: агент возвращает план и базу не
// трогает. Для разрушающих это и есть текст подтверждения — точнее сочинённого нами.

export type IbCheckPayload = {
	reindex?: boolean; logicalIntegrity?: boolean; recalcTotals?: boolean;
	repair?: boolean; dryRun?: boolean;
};
/** План агента приходит списком строк («проверить базу без изменений»), иногда строкой. */
export type IbPlan = string | string[];

export type IbCheckResult = {
	ok?: boolean; issues?: number; repaired?: number; repairMode?: boolean;
	report?: string; plan?: IbPlan;
};

/** План к показу человеку: строки с новой строки, как их прислал агент. */
export const planText = (plan: IbPlan | undefined): string =>
	Array.isArray(plan) ? plan.join("\n") : (plan ?? "");

export const checkBase = (baseKey: string, p: IbCheckPayload) =>
	aiFetch<IbCheckResult | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/check`, {
		method: "POST", body: JSON.stringify(p),
	}).then((d) => awaitCommand<IbCheckResult>(d));

export type IbRestoreResult = { ok?: boolean; path?: string; transport?: string; plan?: IbPlan };

export const restoreBase = (baseKey: string, p: { path: string; lockSessions?: boolean; dryRun?: boolean }) =>
	aiFetch<IbRestoreResult | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/restore`, {
		method: "POST", body: JSON.stringify(p),
	}).then((d) => awaitCommand<IbRestoreResult>(d));

export type IbApplyUpdateResult = {
	ok?: boolean; versionFrom?: string; versionTo?: string; backupPath?: string;
	transport?: string; plan?: IbPlan;
};

export const applyBaseUpdate = (
	baseKey: string,
	p: { path: string; backup?: boolean; lockSessions?: boolean; dryRun?: boolean },
) =>
	aiFetch<IbApplyUpdateResult | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/apply-update`, {
		method: "POST", body: JSON.stringify(p),
	}).then((d) => awaitCommand<IbApplyUpdateResult>(d));

// ── Процессы, запущенные агентом на сервере 1С ──────────────────────────────
// Агент работает чужими руками (rac, ibcmd, конфигуратор, webinst), и часть этих
// процессов живёт дольше команды. Список приходит со снимком heartbeat — читать его
// дёшево; живой опрос нужен только кнопке «Обновить сейчас».

export type AgentProcess = {
	pid: number;
	tool: string;
	what?: string;
	base?: string | null;
	ageSecs?: number;
	/** Остался с прошлого запуска агента: за ним уже никто не следит. */
	orphan?: boolean;
	agentId?: string;
	agentName?: string;
	seenAt?: string | null;
};

export const fetchAgentProcesses = (live?: boolean) =>
	aiFetch<{ items: AgentProcess[] } | Pending>(`/v1/onec/agent-processes${live ? "?live=1" : ""}`)
		.then((d) => awaitCommand<{ items: AgentProcess[] }>(d));

/** Снять процесс. `force` — согласие снять конфигуратор: он этого не переживёт безболезненно. */
export const killAgentProcess = (pid: number, force?: boolean) =>
	aiFetch<{ ok: boolean; note?: string } | Pending>(`/v1/onec/agent-processes/${pid}/kill`, {
		method: "POST", body: JSON.stringify({ force: !!force }),
	}).then((d) => awaitCommand<{ ok: boolean; note?: string }>(d));

// ── Агенты, которых видит панель ────────────────────────────────────────────
// Способности решают, что вообще возможно: без `ib.admin` операции ВНУТРИ баз
// (пользователи, расширения) не выполнит никто, и знать это нужно заранее.

export type OnecAgent = {
	id: string; name: string; role: "business" | "admin";
	online: boolean; capabilities: string[]; lastSeenAt: string | null; disabled: boolean;
	/** Сервер, за который отвечает агент: по нему база находит свою платформу. */
	serverId: string | null;
	/** Версия платформы 1С на сервере агента; null — агент её не сообщает. */
	platform: string | null;
	/**
	 * Экземпляры (процессы) агента, отзывавшиеся за последнее время. Больше одного — авария:
	 * два процесса под одним токеном разбирают одну очередь команд, и стоит их настройкам
	 * разойтись, как одна и та же команда начинает отказывать через раз.
	 */
	/**
	 * Экземпляры за сутки. `live` — работает СЕЙЧАС; остальные строки — прежние запуски
	 * (идентификатор меняется при каждом старте службы), они нужны лишь для того, чтобы
	 * назначить владельцем молчащий процесс.
	 */
	instances: {
		instanceId: string; version: string | null; remoteAddr: string | null;
		lastSeenAt: string; live: boolean;
	}[];
	/**
	 * Владелец токена — единственный экземпляр, которому разрешено работать. Остальные
	 * получают отказ и не выполняют ни одной команды.
	 */
	owner: { instanceId: string | null; seenAt: string | null };
};

/**
 * Вместе с агентами приходят лимиты сервиса: сколько баз опрашивать одновременно и сколько
 * обращений к кластеру ещё осталось в текущей минуте. Квота общая на всю установку, поэтому
 * её остаток — это состояние среды, а не свойство нажавшего.
 */
export const fetchAgents = () =>
	aiFetch<{
		items: OnecAgent[];
		limits: { checkParallel: number; clusterPerMin?: number; clusterRemaining?: number };
	}>("/v1/onec/agents");

/** Назначить владельцем конкретный экземпляр: аренду мог занять не тот компьютер. */
export const setAgentOwner = (id: string, instanceId: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/agents/${encodeURIComponent(id)}/owner`, {
		method: "POST", body: JSON.stringify({ instanceId }),
	});

/** Переименовать агента: имя — подпись для человека, а не то, как назвалась служба. */
export const renameAgent = (id: string, name: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/agents/${encodeURIComponent(id)}`, {
		method: "PATCH", body: JSON.stringify({ name }),
	});

/** Удалить агента вместе с историей его команд. Работающего сервис удалить не даст. */
export const deleteAgent = (id: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/agents/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Снять владение токеном: следующий запустившийся экземпляр займёт его место. */
export const releaseAgentInstance = (id: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/agents/${encodeURIComponent(id)}/release-instance`, { method: "POST" });

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
