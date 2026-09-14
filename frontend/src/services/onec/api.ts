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
	/**
	 * Адрес публикации ДЛЯ ПОКАЗА: тот же путь под публичным именем сервера, если оно
	 * задано в параметрах агента. Отдельно от `publishUrl` — там ответ агента, и подменять его
	 * догадкой значит лишиться возможности заметить ошибку в привязке сайта.
	 */
	publishUrlPublic: string | null;
	/** Когда состояние публикации проверяли; null — не проверяли никогда. */
	publishSeenAt: string | null;
	/**
	 * Блокировка начала сеансов: null — не знаем. Источник `cluster` — прочитано у кластера,
	 * `command` — записано по последней команде панели, когда кластер состояние не сообщил.
	 */
	sessionsDenied?: boolean | null;
	sessionsDeniedMessage?: string | null;
	sessionsDeniedFrom?: string | null;
	sessionsDeniedTo?: string | null;
	sessionsDeniedSeenAt?: string | null;
	sessionsDeniedSource?: "cluster" | "command" | null;
	/**
	 * Включена, но действует ли СЕЙЧАС (агент 23:16): окно прошлой блокировки может оставить вход
	 * открытым. null — не сообщал.
	 */
	sessionsDeniedActive?: boolean | null;
	/** Конфигурация базы (имя и версия); onecVersion — версия платформы. */
	configName?: string | null;
	configVersion?: string | null;
	configSeenAt?: string | null;
	/**
	 * База ЧИСЛИТСЯ в кластере, но войти в неё нельзя: последняя команда внутрь ответила
	 * «база не найдена». Отдельно от `status`: тот отвечает на вопрос «зарегистрирована ли
	 * она», а это — «можно ли с ней работать», и знают их разные источники.
	 */
	ibUnreachableAt: string | null;
	/**
	 * ПОЧЕМУ не войти — кодом от сервиса: NO_DB (базы нет в СУБД), NO_INFOBASE (нет и в
	 * кластере), NO_ACCESS (не пускают), UNKNOWN. Разные беды лечатся по-разному, а общее
	 * «недоступна» заставляет выяснять это заново по тексту ошибки.
	 */
	ibUnreachableReason: string | null;
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
async function awaitCommand<T>(
	first: T | Pending, limitMs = 15 * 60_000, keepWaiting?: () => boolean,
): Promise<T> {
	let data = first;
	let pauseMs = 1000;
	const until = Date.now() + limitMs;
	while (isPending(data)) {
		if (Date.now() > until) throw new Error("Команда 1С выполняется слишком долго");
		// Наблюдение сняли («Скрыть» у операции) — ждать дальше некому.
		if (keepWaiting && !keepWaiting()) throw new Error("Наблюдение за командой прекращено");
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
	aiFetch<TerminateResult | Pending>(`/v1/onec/sessions/${encodeURIComponent(sessionId)}/terminate`, {
		method: "POST",
		body: JSON.stringify(baseKey ? { baseKey } : {}),
	}).then((d) => awaitCommand<TerminateResult>(d));

/**
 * Список кластера, приложенный агентом к ответу на снятие сеанса или разрыв соединения
 * (docs/TASK_PANEL_SESSIONS_ECHO.md). Весь кластер, форма строк — как у fetchSessions /
 * fetchConnections: им замещается таблица без второй команды.
 */
export type ClusterListEcho = {
	items: ClusterRow[];
	/** true — ответили все кластеры сервера; иначе агент state не прикладывает вовсе. */
	complete: boolean;
	readAt?: string;
	/** Снятие прошло, но строка на момент readAt ещё в списке кластера. */
	stillListed?: boolean;
};

export type TerminateResult = { ok: boolean; state?: { sessions?: ClusterListEcho } };
/** `state.locks` — блокировки всего кластера после разрыва (агент R7-А3). */
export type DisconnectResult = { ok: boolean; state?: { connections?: ClusterListEcho; locks?: ClusterListEcho } };

/** Блокировка начала сеансов: пользователи не смогут войти в базу, уже вошедшие продолжат работу. */
/** Ответ на блокировку: `state.lock` — состояние, прочитанное у кластера после команды (агент E1). */
export type SessionsLockResult = {
	ok: boolean;
	state?: { lock?: { enabled: boolean; active?: boolean; message?: string | null } };
	/** Включили, а вход не закрыт: агент называет оставшееся окно прошлой блокировки (23:16). */
	warning?: string;
	/**
	 * Что агент сбросил при включении (23:52): `all` — прежние окно, сообщение и код; `dates` — только
	 * окно; `none` — ничего (rac не принял пустые значения). Не `all` — в `note` сказано, что осталось.
	 */
	reset?: "all" | "dates" | "none";
	note?: string;
};

export const setSessionsLock = (baseKey: string, enabled: boolean, message?: string) =>
	aiFetch<SessionsLockResult | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/lock`, {
		method: "POST",
		body: JSON.stringify({ enabled, ...(message ? { message } : {}) }),
	}).then((d) => awaitCommand<SessionsLockResult>(d));

// ── Содержимое базы: пользователи ИБ и расширения (E15/A3-P1) ───────────────
// Списки спрашиваются у 1С вживую (это команда агенту), сводки — из кэша сервиса.

/** `seenAt` — когда это читали у самой 1С: из кэша реестра либо проставлено чтением. */
export type IbUser = {
	name: string; fullName?: string; disabled?: boolean; roles?: string[];
	/**
	 * Показывать в списке выбора при входе. ТРЁХЗНАЧНО: `null`/отсутствие — «агент не
	 * сообщил», и это не «выключено». Панель умеет признак записывать, но читает его только
	 * у тех сборок агента, которые возвращают его в списке пользователей.
	 */
	showInList?: boolean | null;
	/** Откуда известно showInList (кэш реестра): 'base' — прочитано у 1С, 'panel' — по записи панели. */
	showInListSource?: "base" | "panel" | null;
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
export type PublicationReport = {
	/** Сколько баз в срезе и сколько из них опубликованы. */
	total: number;
	published: number;
	/** Агент объявил список полным (просмотрены все веб-серверы). */
	complete: boolean;
	/** Агент сказал, где смотрел: без этого «не нашёл» неотличимо от «не сумел». */
	evidence: boolean;
	/** Срез принят и применён к реестру (см. publicationReport в сервисе). */
	accepted: boolean;
	/** Чем собран срез и сколько каталогов просмотрено — диагностика для человека. */
	source: string | null;
	lookedIn: number;
};

/**
 * Обновить состояние публикаций: агент читает веб-сервер, сервис применяет срез.
 *
 * ЖДЁМ КОМАНДУ. Раньше ответ брали как есть — а сервис отдаёт 202 `{pending}`, если агент
 * не уложился в отведённое время. Тогда `items` оказывался `undefined`, панель клала его
 * в кэш списка баз, и СПИСОК БАЗ СТАНОВИЛСЯ ПУСТЫМ, а в сообщении появлялось «Проверено
 * публикаций: undefined».
 */
/**
 * `report` ПОМЕЧЕН НЕОБЯЗАТЕЛЬНЫМ НАМЕРЕННО.
 *
 * Панель и сервис обновляются по отдельности: фронт подхватывает правки сразу, сервис —
 * только после перезапуска. Пока он старый, ответ приходит в прежней форме (без разбора
 * среза), и обращение к `report.accepted` роняло обработчик прямо в лицо пользователю:
 * «Cannot read properties of undefined». Отсутствие поля — не ошибка, а известное
 * состояние: мы не знаем, что нашлось, и говорим именно это.
 */
export const refreshPublications = () =>
	aiFetch<{ items: OnecBase[]; report?: PublicationReport } | Pending>(
		"/v1/onec/publications/refresh", { method: "POST" },
	).then(async (d) => {
		if (!isPending(d)) return d;
		// Долгая проверка (П7): результат команды — строки ПУБЛИКАЦИЙ, а не баз, и класть их в
		// список баз нельзя. Срез сервис применил при приёме ответа — перечитываем реестр.
		const r = await awaitCommand<{ items?: OnecBase[]; report?: PublicationReport } | null>(d);
		// Сервис с С7 отвечает после ожидания реестром и разбором — берём их; старый — сырыми строками.
		if (r && Array.isArray(r.items) && r.report) return { items: r.items, report: r.report };
		const bases = await fetchBases();
		return { items: bases.items, report: undefined as PublicationReport | undefined };
	});

/**
 * Ответ агента на проверку наличия баз данных (`CLUSTER_CHECK_BASES`). Поля `dbMissing` у
 * строки нет — проверить не удалось; `note` — почему проверка не проведена (например, у
 * агента нет пароля СУБД).
 */
export type CheckBasesResult = {
	/** `reason` — почему базу не проверили (агент 22:05); признака `dbMissing` у неё нет. */
	items?: { key: string; dbMissing?: boolean; reason?: string }[];
	checked?: number;
	skipped?: number;
	note?: string;
};

/**
 * Проверить, есть ли у баз их база данных в СУБД (P2). Без ключей — все базы кластера.
 * На сотне баз ответ дольше, чем сервис держит запрос, — поэтому дожидаемся команды.
 * Отметки в реестре сервис ставит сам при приёме ответа.
 */
export const checkBasesDb = (baseKeys?: string[]) =>
	aiFetch<CheckBasesResult | Pending>("/v1/onec/bases/check-db", {
		method: "POST",
		body: JSON.stringify(baseKeys?.length ? { baseKeys } : {}),
	}).then((d) => awaitCommand<CheckBasesResult>(d));

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
	// Типов чтения здесь нет (П8): `/batch` их не принимает (сервис, BATCHABLE).
	| "IB_CHECK";

export type BatchStart = {
	batchId: string; total: number; queued: number;
	/** Базы, до которых команда не дошла (нет агента, не та способность) — с причиной. */
	skipped: { baseKey: string; reason: string }[];
};

/**
 * Отменить команды, которые ещё НЕ НАЧАТЫ.
 *
 * Команду, которую агент уже забрал, панель отменить не может: она выполняется на сервере
 * 1С. Назвать отменой прекращение ожидания значило бы соврать о состоянии чужой системы —
 * человек прочитал бы «отменено» как «не выполнено».
 */
export const cancelCommands = (ids: string[]) =>
	aiFetch<{ canceled: number; asked: number }>("/v1/onec/commands/cancel", {
		method: "POST", body: JSON.stringify({ ids }),
	});

/**
 * ПРЕРВАТЬ НАЧАТУЮ команду (P3) — это делает агент, а не очередь.
 *
 * Только чтения и только у агента с `agent.cancel`: сервис откажет в остальном. Ответ
 * `aborted: false` с `reason: "NOT_RUNNING"` — команда успела закончиться сама, это не ошибка.
 */
export type AbortAnswer = { aborted: boolean; killed?: boolean; note?: string | null; reason?: string };

/**
 * Прервать начатую команду. Агент не ответил за время запроса (202) — ДОЖИДАЕМСЯ его ответа
 * (П5): раньше 202 читалось как «прерывать нечего», хотя прерывание ещё шло.
 */
export const abortCommand = (id: string, force?: boolean) =>
	aiFetch<AbortAnswer | Pending>(
		`/v1/onec/commands/${encodeURIComponent(id)}/abort`,
		{ method: "POST", body: JSON.stringify(force ? { force: true } : {}) },
	).then(async (d): Promise<AbortAnswer> => {
		if (!isPending(d)) return d;
		const a = await awaitCommand<{ ok?: boolean; killed?: boolean; note?: string; reason?: string } | null>(d, 2 * 60_000);
		return a?.ok === true
			? { aborted: true, killed: a.killed === true, note: a.note ?? null }
			: { aborted: false, reason: a?.reason ?? "NOT_RUNNING" };
	});

/** Остановить групповую операцию: отменяются все её команды, которые ещё не начаты. */
export const cancelBatch = (batchId: string) =>
	aiFetch<{ canceled: number }>(`/v1/onec/batches/${encodeURIComponent(batchId)}/cancel`, {
		method: "POST",
	});

export const runBatch = (type: BatchType, baseKeys: string[], payload: Record<string, unknown>) =>
	aiFetch<BatchStart>("/v1/onec/batch", { method: "POST", body: JSON.stringify({ type, baseKeys, payload }) });

export type BatchProgress = {
	id: string; type: string; total: number; done: number; failed: number; pending: number;
	/** Сколько команд задания ещё можно отменить: их никто не начинал. */
	cancelable: number;
	/** Сколько начатых команд можно прервать (S4). Нет — сервис старее панели. */
	abortable?: number;
	createdAt: string;
	items: {
		/** Идентификатор команды — по нему её отменяют, пока она не начата. */
		commandId: string | null;
		baseKey: string | null; state: string; error: { code: string; message: string } | null;
		/** Итог одной строкой: путь к выгрузке или адрес публикации. */
		outcome: string | null;
		/** Начатую команду можно прервать: это чтение, и агент умеет отмену (S4). */
		abortable?: boolean;
		/** Выполнено с оговоркой: признак не перечитан или свойства не приняты платформой (П12). */
		warning?: string | null;
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
	/** Что агент не выполнил без «Исправлять» (агент 22:05): `reindex`, `recalcTotals`. */
	skipped?: string[];
	/** С какими ключами шёл конфигуратор. */
	keys?: string[];
};

/** План к показу человеку: строки с новой строки, как их прислал агент. */
export const planText = (plan: IbPlan | undefined): string =>
	Array.isArray(plan) ? plan.join("\n") : (plan ?? "");

/**
 * ДОЛГАЯ КОМАНДА ПО БАЗЕ — НЕ ЖДАТЬ В ЗАПРОСЕ (П2, аудит 14.09).
 *
 * Загрузка, обновление и проверка базы идут до четырёх часов, а ожидание `awaitCommand`
 * ограничено 15 минутами: операция показывалась упавшей, номер команды терялся, повтор ставил
 * вторую. Теперь ответ «ещё идёт» возвращается номером — операцию дальше ведёт «Прогресс»
 * (`followCommand`), без предела.
 */
export type Started<T> = { done: T } | { commandId: string };

const startJob = <T>(path: string, body: unknown): Promise<Started<T>> =>
	aiFetch<T | Pending>(path, { method: "POST", body: JSON.stringify(body) })
		.then((d) => (isPending(d) ? { commandId: d.commandId } : { done: d }));

/** Следить за командой по номеру, пока `keepWaiting()` — без предела по времени. */
export const followCommand = <T>(commandId: string, keepWaiting: () => boolean): Promise<T> =>
	awaitCommand<T>({ pending: true, commandId }, Number.POSITIVE_INFINITY, keepWaiting);

export const startCheckBase = (baseKey: string, p: IbCheckPayload) =>
	startJob<IbCheckResult>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/check`, p);

export const startRestoreBase = (baseKey: string, p: { path: string; lockSessions?: boolean }) =>
	startJob<IbRestoreResult>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/restore`, p);

export const startApplyUpdate = (baseKey: string, p: { path: string; backup?: boolean; lockSessions?: boolean }) =>
	startJob<IbApplyUpdateResult>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/apply-update`, p);

/** Итог самопроверки (R4): `ok: false` — есть неудачные шаги, а не отказ команды. */
export type SelftestResult = { ok: boolean; steps?: { name: string; ok: boolean; note?: string }[] };

/** Самопроверка операций агента в базе (R4): минута и дольше — ведётся по номеру команды. */
export const startSelftest = (baseKey: string) =>
	startJob<SelftestResult>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/selftest`, {});

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
/** Ответ на снятие: `state.processes` — список после снятия (агент E5), сервис его уже сохранил. */
export type KillProcessResult = {
	ok: boolean; note?: string;
	state?: { processes?: { items: AgentProcess[]; stillRunning?: boolean } };
};

export const killAgentProcess = (pid: number, force?: boolean) =>
	aiFetch<KillProcessResult | Pending>(`/v1/onec/agent-processes/${pid}/kill`, {
		method: "POST", body: JSON.stringify({ force: !!force }),
	}).then((d) => awaitCommand<KillProcessResult>(d));

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
	 * Агент забрал команду и ещё не ответил. Отдельно от `online`: там «откликается», а
	 * здесь он как раз молчит — и молчание ожидаемо, пока идёт взятая им работа.
	 */
	busy: boolean;
	/** Версия агента со сборкой: «0.1.0+2026-09-14 23:16 (+05)». Нет — сервис старее панели. */
	version?: string | null;
	/** Сборка «ГГГГ-ММ-ДД чч:мм» (R3); null — не разобрана. */
	build?: string | null;
	/** Старше эталона сервиса (R3); null — сравнивать не с чем. */
	buildOutdated?: boolean | null;
	/** Функции панели, которых нет в этой сборке (R3): abort, roles, commandStats, health, log, selftest. */
	missingFeatures?: string[];
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
	/**
	 * Отказы по кодам и время команд с последнего запуска службы агента (S5). null — агент
	 * снимка не присылал (сборка старше 13.09 15:21); поля нет — сервис старее панели.
	 */
	commandStats?: {
		failuresByCode: Record<string, number>;
		durationsByType: Record<string, {
			count: number; avgMs: number; maxMs: number; p95LeSecs: number | null;
			buckets?: Record<string, number>;
		}>;
		seenAt: string | null;
	} | null;
};

/**
 * Вместе с агентами приходят лимиты сервиса: сколько баз опрашивать одновременно и сколько
 * обращений к кластеру ещё осталось в текущей минуте. Квота общая на всю установку, поэтому
 * её остаток — это состояние среды, а не свойство нажавшего.
 */
/**
 * Настраиваемые параметры сервера 1С — вкладка «Параметры» карточки агента.
 * Всё это человек задаёт сам: агент публичного имени не знает и знать не обязан, а адрес
 * RAS знает не всегда.
 */
export type OnecServer = {
	id: string;
	name: string;
	/** Под каким именем сервер виден снаружи — для ссылок на опубликованные базы. */
	publicHost: string | null;
	/** Адрес службы RAS, через которую агент ходит в кластер. */
	rasHost: string | null;
	rasPort: number | null;
	bases: number;
};

export const fetchServers = () => aiFetch<{ items: OnecServer[] }>("/v1/onec/servers");

/**
 * Поле, которого НЕТ в запросе, не меняется; присланное пустым — СТИРАЕТСЯ. «Оставить как
 * было» и «убрать» — разные намерения, и различать их обязательно.
 */
export const updateServer = (id: string, patch: {
	name?: string; publicHost?: string; rasHost?: string; rasPort?: number | null;
}) =>
	aiFetch<{ items: OnecServer[] }>(`/v1/onec/servers/${encodeURIComponent(id)}`, {
		method: "PATCH", body: JSON.stringify(patch),
	});

/**
 * Ответ `AGENT_HEALTH` — «Состояние сервера 1С» (R1, контракт агента 23:16). Все поля необязательны:
 * у бизнес-агента нет кластера, у старой сборки — части признаков.
 */
export type AgentHealth = {
	collectedAt?: string;
	agent?: {
		version?: string; build?: string; instance?: string; role?: string; server?: string;
		serviceName?: string; state?: string; lastError?: string | null; uptimeSecs?: number;
		ibReady?: boolean; maxParallel?: number; persistentBridge?: boolean;
		commandTimeoutSecs?: number; longCommandTimeoutSecs?: number;
	};
	capabilities?: string[];
	readiness?: { items?: { key: string; ok: boolean; note?: string }[] };
	commands?: { done?: number; failed?: number; failuresByCode?: Record<string, number> };
	processes?: { pid: number; tool?: string; what?: string; base?: string | null; ageSecs?: number; orphan?: boolean }[];
	cluster?: null | {
		platform?: string | null;
		clusters?: { name?: string; host?: string; port?: string }[] | { error: string };
		bases?: { known?: number; dbChecked?: number; dbMissing?: string[] };
		publications?: null | { found?: number; complete?: boolean; ageSecs?: number };
		/**
		 * Фоновое чтение блокировок (П11, агент 00:12): баз в кластере, прочитано за 30 мин, из них с
		 * включённой блокировкой, на паузе 6 ч после отказа, последний отказ.
		 */
		locks?: null | {
			known?: number; fresh?: number; enabled?: number; paused?: number;
			lastRefusal?: { base?: string; at?: string; reason?: string } | null;
		};
		dbPassword?: boolean;
		dbLoginFailure?: unknown;
		queryLoginFailure?: unknown;
		dbmsClients?: { name: string; path: string | null }[];
	};
	logProblems?: string[];
};

/** Состояние сервера 1С — командой ЭТОМУ агенту (R1). */
export const fetchAgentHealth = (agentId: string) =>
	aiFetch<AgentHealth | Pending>(`/v1/onec/agents/${encodeURIComponent(agentId)}/health`)
		.then((d) => (isPending(d) ? awaitCommand<AgentHealth>(d, 2 * 60_000) : d));

/** Ответ `AGENT_LOG_TAIL` (R2); файлов журнала ещё нет — `{file: null, lines: [], note}`. */
export type AgentLogTail = { file: string | null; lines: string[]; matched?: number; truncated?: boolean; note?: string };

/** Хвост журнала агента (R2): отбирает агент, пароли и токены вырезаны до отбора. */
export const fetchAgentLog = (agentId: string, p: { lines?: number; level?: "all" | "problems"; contains?: string }) => {
	const q = new URLSearchParams();
	if (p.lines) q.set("lines", String(p.lines));
	if (p.level) q.set("level", p.level);
	if (p.contains) q.set("contains", p.contains);
	return aiFetch<AgentLogTail | Pending>(`/v1/onec/agents/${encodeURIComponent(agentId)}/log?${q.toString()}`)
		.then((d) => (isPending(d) ? awaitCommand<AgentLogTail>(d, 2 * 60_000) : d));
};

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

/**
 * УДАЛИТЬ МЁРТВУЮ РЕГИСТРАЦИЮ БАЗЫ ИЗ КЛАСТЕРА.
 *
 * Регистрация переживает свою базу данных: `rac` перечисляет базу, которой на СУБД уже нет,
 * и каждое обращение внутрь отвечает «База данных отсутствует в сервере баз данных».
 * Команда убирает именно ЗАПИСЬ — данные не трогаются, их и нет.
 *
 * Защита на стороне агента, а не панели: перед удалением он сам проверяет через СУБД, что
 * базы данных действительно нет. У живой базы команда отказывает («база РАБОТАЕТ»), и
 * «проверить не удалось» — тоже отказ, а не молчаливое удаление. Поэтому опечатка в имени
 * не может увести из кластера рабочую базу.
 */
export const dropBaseRegistration = (baseKey: string) =>
	aiFetch<{ ok: boolean; baseKey?: string; note?: string } | Pending>(
		`/v1/onec/bases/${encodeURIComponent(baseKey)}/drop-registration`,
		{ method: "POST", body: JSON.stringify({ confirm: true }) },
	).then((d) => awaitCommand<{ ok: boolean; baseKey?: string; note?: string }>(d));

/**
 * СКРЫТЬ БАЗУ ИЗ РАБОТЫ — решение администратора о базе-фантоме.
 *
 * Базу, которая числится в кластере, но которой нет в СУБД, панель убрать из кластера не
 * может: это разрушающее действие над чужой системой, и делает его администратор на самом
 * сервере. Но пока запись жива, база каждый раз попадает в списки и групповые команды и
 * каждый раз отказывает одинаково. Скрытие — отметка в реестре сервиса, обратимая: сняли —
 * база снова в работе (например, после восстановления из копии).
 */
export const setBaseHidden = (key: string, hidden: boolean) =>
	aiFetch<{ ok: boolean; hidden: boolean }>(`/v1/onec/bases/${encodeURIComponent(key)}/hidden`, {
		method: "POST", body: JSON.stringify({ hidden }),
	});

/**
 * Состояние очереди и измеренные длительности команд.
 *
 * Отвечает на два вопроса, которые панель раньше не умела задать: «сколько ждать» (среднее
 * по типу команды за неделю) и «чего ждёт очередь» (сколько команд стоит, есть ли живой
 * агент и занят ли он).
 */
export type OnecQueueStats = {
	types: { type: string; avgSecs: number; samples: number }[];
	queued: number;
	running: number;
	oldestQueuedSecs: number;
	agentsOnline: number;
	agentsBusy: number;
	/** Сколько команд внутрь базы агент получает одновременно — делитель в оценке времени. */
	ibParallel: number;
	/** Кто держит очередь (R5): выданные и не ответившие команды. Нет — сервис старее панели. */
	runningCommands?: {
		commandId: string; type: string; baseKey: string | null; agentId: string; ageSecs: number;
		/** Прервать можно только чтение. */
		abortable: boolean;
	}[];
	/** Время по типам команд — сводно по снимкам живых агентов (R5). */
	agentDurations?: Record<string, { count: number; avgMs: number; maxMs: number; p95LeSecs: number | null }>;
};

export const fetchQueueStats = () => aiFetch<OnecQueueStats>("/v1/onec/queue-stats");

// ── Обслуживание по расписанию (F2) ─────────────────────────────────────────
// Расписание — НАСТРОЙКА: что делать, по каким базам и в каком окне. Его прогоны
// становятся обычными заданиями, поэтому своей истории у него нет — последний прогон
// смотрят в «Заданиях» по `lastBatchId`.

export type OnecSchedule = {
	id: string;
	name: string;
	/** Тип команды 1С: IB_BACKUP (выгрузка) или IB_CHECK (проверка). */
	type: string;
	baseKeys: string[];
	payload: Record<string, unknown>;
	/** Время запуска «ЧЧ:ММ» в зоне сервера 1С. */
	atTime: string;
	/** Дни недели (0 — воскресенье). Пустой массив — каждый день. */
	weekdays: number[];
	enabled: boolean;
	lastRunAt: string | null;
	lastBatchId: string | null;
	/** Окно наступило прямо сейчас — считает сервис тем же правилом, что и ночной тик. */
	due?: boolean;
};

export type ScheduleInput = {
	name: string;
	type: string;
	baseKeys: string[];
	atTime: string;
	weekdays?: number[];
	payload?: Record<string, unknown>;
	enabled?: boolean;
};

export const fetchSchedules = () => aiFetch<{ items: OnecSchedule[] }>("/v1/onec/schedules");

export const createSchedule = (input: ScheduleInput) =>
	aiFetch<OnecSchedule>("/v1/onec/schedules", { method: "POST", body: JSON.stringify(input) });

export const updateSchedule = (id: string, patch: Partial<ScheduleInput>) =>
	aiFetch<OnecSchedule>(`/v1/onec/schedules/${encodeURIComponent(id)}`, {
		method: "PATCH", body: JSON.stringify(patch),
	});

export const deleteSchedule = (id: string) =>
	aiFetch<{ id: string }>(`/v1/onec/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Запустить расписание сейчас — проверка того, что ночью пойдёт то же самое. */
export const runSchedule = (id: string) =>
	aiFetch<BatchStart>(`/v1/onec/schedules/${encodeURIComponent(id)}/run`, { method: "POST" });

/** Есть ли на связи админ-агент с нужной способностью. */
export const hasCapability = (agents: OnecAgent[] | undefined, capability: string): boolean =>
	(agents ?? []).some((a) => a.role === "admin" && a.online && !a.disabled && a.capabilities.includes(capability));

/**
 * Повторить неуспешные базы задания — создаётся новое задание.
 *
 * `baseKeys` сужает повтор до отмеченных баз: в «Заданиях» отмечают конкретные строки, и
 * повтор обязан касаться их. Без списка повторяются все неуспешные базы задания.
 */
export const retryBatch = (id: string, baseKeys?: string[]) =>
	aiFetch<BatchStart>(`/v1/onec/batches/${encodeURIComponent(id)}/retry`, {
		method: "POST",
		body: JSON.stringify({ ...(baseKeys?.length ? { baseKeys } : {}) }),
	});

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
	aiFetch<DisconnectResult | Pending>(`/v1/onec/connections/${encodeURIComponent(connectionId)}/disconnect`, {
		method: "POST", body: JSON.stringify(baseKey ? { baseKey } : {}),
	}).then((d) => awaitCommand<DisconnectResult>(d));
