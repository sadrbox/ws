// Администрирование 1С: базы, сеансы, соединения (E15/A5).
//
// Все вызовы идут в AI Service (`/v1/onec/*`), а он ставит команду админ-агенту, который
// работает с кластером через `rac`. Здесь только транспорт и типы — решения о правах,
// маршрутизации и подтверждениях принимает сервис.

import { AiServiceError, aiFetch } from "src/services/ai/endpoint";

export type OnecBase = {
	id: string;
	serverId: string;
	serverName: string;
	/** Имя базы в кластере — им она адресуется в командах. */
	key: string;
	name: string;
	/** Статус для показа: у скрытой базы — `DISABLED`. */
	status: string;
	/**
	 * Что знает о базе кластер (ONLINE, MISSING…) — независимо от скрытия (С44). Сервис старее С44 его не отдаёт.
	 * По нему карточка отличает «скрыта» от «скрыта и удалена из кластера»: второй удалять регистрацию нечего.
	 */
	clusterStatus?: string;
	onecVersion: string | null;
	/** Версия расширения buhprof_api по данным heartbeat бизнес-агента; null — неизвестно. */
	extVersion: string | null;
	/** UUID базы в кластере — по нему сеансы ссылаются на базу. */
	infobaseId: string | null;
	/** Сколько расширений видели в базе; null — базу ещё ни разу не проверяли. */
	extensionsCount: number | null;
	extensionsSeenAt: string | null;
	/** Когда у базы проверяли наличие базы данных в СУБД (миграция 032); null — ни разу. */
	dbCheckedAt?: string | null;
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
	/**
	 * Запрещены ли регламентные и фоновые задания базы (С39): именно они держат базу разделённым доступом и
	 * срывают монопольные операции. Блокировка входа на них не действует. null — не знаем.
	 */
	scheduledJobsDenied?: boolean | null;
	scheduledJobsSeenAt?: string | null;
	/** `cluster` — прочитано у кластера (со временем), `command` — записано по команде, не прочитано (С40). */
	scheduledJobsSource?: "cluster" | "command" | null;
	/** Задан ли код разрешения входа в закрытую базу (С26); null — не сообщал. */
	sessionsDeniedCodeSet?: boolean | null;
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
export type CommandPending = {
	pending: true; commandId: string;
	/** Ждёт очереди или уже выполняется (С20). Нет — сервис старее панели. */
	state?: "queued" | "dispatched";
	/** С какого времени выполняется. */
	dispatchedAt?: string | null;
	/** Можно прервать: чтение или проверка без «Исправлять» у агента, который это умеет (С23). */
	abortable?: boolean;
	/** Агент на связи (С20); нет — сервис старее панели. */
	agentOnline?: boolean;
	/** Сколько секунд агент молчит, если не на связи; null — не выходил на связь вовсе. */
	agentSilentSecs?: number | null;
	/** Когда агент начал работу по команде (С33). */
	startedAt?: string | null;
	/** Когда агент последний раз подтвердил, что команда выполняется (С33). */
	runningConfirmedAt?: string | null;
};
type Pending = CommandPending;
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
	// 30 минут (П18): сервис даёт команде до 900 с очереди и ещё до 900 с выполнения — при 15 минутах живая
	// команда объявлялась «выполняется слишком долго».
	first: T | Pending, limitMs = 30 * 60_000, keepWaiting?: () => boolean,
	/** Каждый ответ «ещё идёт» — что происходит с командой сейчас (П15). */
	onPending?: (p: Pending) => void,
	/** Слежение за долгой операцией: молчание агента — не отказ, а «ещё идёт, агент не на связи» (С20). */
	follow = false,
): Promise<T> {
	let data = first;
	let pauseMs = 1000;
	const until = Date.now() + limitMs;
	while (isPending(data)) {
		onPending?.(data);
		if (Date.now() > until) throw new Error("Команда 1С выполняется слишком долго");
		// Наблюдение сняли («Скрыть» у операции) — ждать дальше некому.
		if (keepWaiting && !keepWaiting()) throw new Error("Наблюдение за командой прекращено");
		await new Promise((r) => setTimeout(r, pauseMs));
		pauseMs = Math.min(10_000, Math.round(pauseMs * 1.5));
		data = await aiFetch<T | Pending>(`/v1/onec/commands/${encodeURIComponent(data.commandId)}${follow ? "?follow=1" : ""}`);
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
 * «Обновить» списка баз (17.09): список баз из кластера И публикации — одним запросом к сервису.
 *
 * Сервис ставит обе команды кластера сразу и отвечает реестром, в котором уже учтены обе. Публикации не решают
 * судьбу обновления: список обновлён, а по ним — разбор среза, «ещё идёт» (`pending`) или отказ (`error`).
 * Сервис старее этой правки поле `publications` не отдаёт — тогда обновляется только список, как раньше.
 */
/** Итог выборочной проверки баз данных внутри «Обновить» (18.09). */
export type DbCheckRefresh =
	| { checked: number; missing: number }
	| { pending: true; commandId: string | null }
	| { error: { code?: string; message?: string } };

export type PublicationsRefresh =
	| { report: PublicationReport }
	| { pending: true; commandId: string | null }
	| { error: { code?: string; message?: string } };

export const refreshBasesAndPublications = () =>
	aiFetch<{ items: OnecBase[]; publications?: PublicationsRefresh; dbCheck?: DbCheckRefresh } | Pending>(
		"/v1/onec/bases/refresh", { method: "POST", body: JSON.stringify({ publications: true, checkDb: true }) },
	).then(async (d) => (isPending(d)
		// Список не успел за время запроса: дожидаемся, срез применит сервис при приёме; публикации — тоже там.
		? { items: (await awaitCommand<{ items: unknown[] }>(d).then(() => fetchBases())).items, publications: undefined, dbCheck: undefined }
		: d));

/** Дождаться проверки публикаций, которая не успела за время запроса «Обновить». */
export const awaitPublicationsCheck = (commandId: string) =>
	awaitCommand<{ report?: PublicationReport } | null>({ pending: true, commandId } as Pending);

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

/** `alreadyGone` — сеанса уже не было: повтор после 202 или двойное нажатие (агент, С30). */
export type TerminateResult = { ok: boolean; alreadyGone?: boolean; state?: { sessions?: ClusterListEcho } };
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
	/** Кластер не отдал состояние после записи (агент 23:45): `["enabled"]` — «не проверено», а не «применено» (П30). */
	unverified?: string[];
	/** Оговорки успеха, собранные сервисом (С41). */
	caveat?: string | null;
};

/** Запрет регламентных и фоновых заданий базы (С39). `was` — как было до команды: по нему предлагаем вернуть. */
export type ScheduledJobsResult = {
	ok?: boolean; baseKey?: string;
	/** Что просили. */
	requested?: boolean;
	/** ФАКТ после записи (агент 23:45); нет — прочитать не удалось, см. `unverified`. */
	denied?: boolean;
	/** Как было до команды — по нему «Вернуть как было» (П27). */
	was?: boolean;
	unverified?: string[];
	warning?: string;
	/** Оговорки успеха, собранные сервисом (С41). */
	caveat?: string | null;
};

export const setScheduledJobs = (baseKey: string, denied: boolean) =>
	aiFetch<ScheduledJobsResult | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/scheduled-jobs`, {
		method: "POST",
		body: JSON.stringify({ denied }),
	}).then((d) => awaitCommand<ScheduledJobsResult>(d));

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

/** Конфигурация базы, как прочитана (С35): `version: null` — в конфигурации версия не задана. */
export type IbConfigInfo = { name: string | null; version: string | null; synonym?: string | null; readAt?: string | null };

/**
 * Сведения о базе (`IB_INFO`, С35): конфигурация, расширения и блокировка одним входом. Реестр сервис обновляет
 * сам — после ответа карточка перечитывает базы; расширения из ответа вырезаны (они уже в реестре).
 */
export const fetchBaseInfo = (baseKey: string) =>
	aiFetch<{ config?: IbConfigInfo | null } | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/ib-info`)
		.then((d) => awaitCommand<{ config?: IbConfigInfo | null }>(d));

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
	/** `busy` — не проверялась: по базе идёт операция агента (агент 17:30, А34); это не ошибка. */
	items?: { key: string; dbMissing?: boolean; reason?: string; busy?: boolean }[];
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
	// «Операции» списка баз: сведения о базе (чтение) и запрет/разрешение регламентных заданий (команда кластера).
	| "IB_INFO" | "CLUSTER_SET_SCHEDULED_JOBS"
	// Удалить регистрацию базы-фантома — «опасная команда» того же меню; тело обязано нести `confirm: true`.
	| "CLUSTER_DROP_INFOBASE"
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
		/** Номер попытки (повтор «база занята», С19). */
		/** Сколько ждала очереди и сколько работала (С40): «20 минут» без этого не объяснить. */
		queuedSecs?: number | null;
		runSecs?: number | null;
		/** Время по этапам успешной команды (агент 12:37, П28). */
		stages?: { name: string; ms: number }[] | null;
		attempt?: number;
		/** Повтор стоит на паузе до этого времени (С19). */
		retryAt?: string | null;
		/** Результат пришёл после истечения срока (С21). */
		late?: boolean;
		/** Срок истёк, но агент мог продолжать работу — результат ещё может прийти (С21). */
		lateWait?: boolean;
		/** Агент перестал ждать (TIMEOUT), а процесс команды ещё работает (С18). */
		stillRunning?: boolean;
	}[];
};

export const fetchBatch = (id: string) => aiFetch<BatchProgress>(`/v1/onec/batches/${encodeURIComponent(id)}`);
export const fetchBatches = () => aiFetch<{ items: BatchProgress[] }>("/v1/onec/batches");

/** Текущая работа пользователя: одиночные команды и задания, которые ещё идут (восстановление «Прогресса»). */
export type MyWork = {
	commands: { commandId: string; type: string; title: string; operation: string | null; baseKey: string | null;
		state: string; createdAt: string; dispatchedAt: string | null }[];
	batches: { batchId: string; type: string; title: string; total: number; createdAt: string }[];
};
export const fetchMyWork = () => aiFetch<MyWork>("/v1/onec/my-work");

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
export type Started<T> = { done: T } | { commandId: string; pending?: CommandPending };

const startJob = <T>(path: string, body: unknown): Promise<Started<T>> =>
	aiFetch<T | Pending>(path, { method: "POST", body: JSON.stringify(body) })
		.then((d) => (isPending(d) ? { commandId: d.commandId, pending: d } : { done: d }));

/** Следить за командой по номеру, пока `keepWaiting()` — без предела по времени. */
export const followCommand = <T>(
	commandId: string, keepWaiting: () => boolean, onPending?: (p: CommandPending) => void,
): Promise<T> =>
	awaitCommand<T>({ pending: true, commandId }, Number.POSITIVE_INFINITY, keepWaiting, onPending, true);

/**
 * ПОЗДНИЙ РЕЗУЛЬТАТ ОДИНОЧНОЙ ОПЕРАЦИИ (П16). Срок истёк, а агент мог работать дольше: 10 мин (столько сервис
 * держит место истёкшей команды) раз в 15 с спрашиваем, не пришёл ли итог. `null` — не пришёл или наблюдение
 * сняли; отказ агента, пришедший поздно, — исключением.
 */
export async function awaitLateResult<T>(commandId: string, keepWaiting: () => boolean, windowMs = 10 * 60_000): Promise<T | null> {
	const until = Date.now() + windowMs;
	while (Date.now() < until && keepWaiting()) {
		await new Promise((r) => setTimeout(r, 15_000));
		if (!keepWaiting()) return null;
		try {
			const d = await aiFetch<T | Pending>(`/v1/onec/commands/${encodeURIComponent(commandId)}?follow=1`);
			if (!isPending(d)) return d;
		} catch (e) {
			if (e instanceof AiServiceError && e.code === "COMMAND_EXPIRED") continue;
			throw e;
		}
	}
	return null;
}

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

export type IbRestoreResult = {
	ok?: boolean; path?: string; transport?: string; plan?: IbPlan;
	/** Блокировку входа снять не удалось — база закрыта для входа (П13). */
	warning?: string;
};

export const restoreBase = (baseKey: string, p: { path: string; lockSessions?: boolean; dryRun?: boolean }) =>
	aiFetch<IbRestoreResult | Pending>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/restore`, {
		method: "POST", body: JSON.stringify(p),
	}).then((d) => awaitCommand<IbRestoreResult>(d));

export type IbApplyUpdateResult = {
	ok?: boolean; versionFrom?: string; versionTo?: string; backupPath?: string;
	transport?: string; plan?: IbPlan;
	/** Блокировку входа снять не удалось — база закрыта для входа (П13). */
	warning?: string;
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
	/** Номер команды сервиса, запустившей процесс (агент 01:06, С30). */
	commandId?: string;
	agentId?: string;
	agentName?: string;
	seenAt?: string | null;
};

/**
 * `live` — спросить агентов живьём. `agentId` — адресно того, чьи процессы смотрят: без него сервис опрашивает
 * всех на связи, кто это умеет (обе роли), и склеивает ответы.
 */
export const fetchAgentProcesses = (live?: boolean, agentId?: string) =>
	aiFetch<{ items: AgentProcess[]; failed?: { agentId: string; agentName: string; status: number }[] } | Pending>(
		`/v1/onec/agent-processes${live ? `?live=1${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""}` : ""}`)
		.then((d) => awaitCommand<{ items: AgentProcess[]; failed?: { agentId: string; agentName: string; status: number }[] }>(d));

/** Снять процесс. `force` — согласие снять конфигуратор: он этого не переживёт безболезненно. */
/** Ответ на снятие: `state.processes` — список после снятия (агент E5), сервис его уже сохранил. */
export type KillProcessResult = {
	ok: boolean; note?: string;
	state?: { processes?: { items: AgentProcess[]; stillRunning?: boolean } };
};

/** `agentId` — агент, на чьей машине процесс (п. 7): без него снятие ушло бы первому агенту кластера. */
export const killAgentProcess = (pid: number, force?: boolean, agentId?: string) =>
	aiFetch<KillProcessResult | Pending>(`/v1/onec/agent-processes/${pid}/kill`, {
		method: "POST", body: JSON.stringify({ force: !!force, ...(agentId ? { agentId } : {}) }),
	}).then((d) => awaitCommand<KillProcessResult>(d));

// ── Агенты, которых видит панель ────────────────────────────────────────────
// Способности решают, что вообще возможно: без `ib.admin` операции ВНУТРИ баз
// (пользователи, расширения) не выполнит никто, и знать это нужно заранее.

export type OnecAgent = {
	id: string; name: string; role: "business" | "admin";
	online: boolean; capabilities: string[]; lastSeenAt: string | null; disabled: boolean;
	/** Что сервис знает об агенте (п. 6): ОС, состояние, доступность 1С, регистрация, организация, счётчики. */
	os?: string | null; status?: string | null; onecReachable?: boolean; registeredAt?: string | null;
	organizationUuid?: string; commandsDone?: number | null; commandsFailed?: number | null;
	/** Бизнес-агент: сколько баз в его срезе. */
	basesCount?: number;
	/** Ход обновления службы (heartbeat агента): downloading | installing | restarting | failed | done. */
	update?: { state?: string; build?: string; error?: string | null; at?: string } | null;
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
	/** Функции панели, которых нет в этой сборке (R3): abort, roles, commandStats, health, log, selftest, info. */
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
	/** Лимит тарифа бизнес-агента (СВ3): null в поле — без ограничения; у админ-агента поля нет. */
	limits?: AgentLimits;
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
		/** Вход в базу подтверждён пробой (агент 16:23, А27). */
		ibConfirmed?: boolean;
		/** Последний отказ сервиса принять heartbeat: пока он есть, процессы и базы не обновляются (А25). */
		heartbeatRejected?: { at?: string; message?: string } | null;
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
/**
 * Сводка бизнес-агента (п. 1) — ответ его команды HEALTH: состояние баз, лимиты, версия. Форма ответа — агента,
 * поэтому тип открытый: панель показывает известные поля и перечисляет остальные.
 */
export type BusinessHealth = Record<string, unknown> & {
	/** Сама служба: сборка, время работы, экземпляр (агент с выпуска 2026-09-21). */
	agent?: { version?: string; build?: string; instanceId?: string; startedAt?: string; uptimeSecs?: number; os?: string };
	bases?: {
		/** `baseKey` — основное имя (выпуск 21.09), `key` — прежнее: агент шлёт оба. */
		baseKey?: string; key?: string;
		status?: string; transport?: string; extVersion?: string; overLimit?: boolean; error?: string;
		/** `reachable` — отвечала ли база при последней попытке; `probed` — пробовали ли вообще. */
		reachable?: boolean; probed?: boolean; organizations?: number;
		/** Когда база отвечала в последний раз и когда последний раз отказала. */
		lastOkAt?: string | null; lastError?: { message?: string; at?: string } | null;
	}[];
	limits?: { maxBases?: number | null; maxBins?: number | null; activeBins?: string[] };
};

export const fetchBusinessHealth = (agentId: string) =>
	aiFetch<BusinessHealth | Pending>(`/v1/onec/agents/${encodeURIComponent(agentId)}/health`)
		.then((d) => (isPending(d) ? awaitCommand<BusinessHealth>(d, 2 * 60_000) : d));

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
		limits: {
			checkParallel: number; clusterPerMin?: number; clusterRemaining?: number;
			/** Сроки команд сервиса — для сравнения с пределами агента (С24). */
			commandTtlSecs?: number; longCommandTtlSecs?: number;
			/** Эталон сборки и откуда её брать при обновлении из панели; нет — адрес и хэш вводят руками. */
			latestBuild?: string | null; updateUrl?: string | null; updateSha256?: string | null;
		};
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

/** Лимит тарифа бизнес-агента: сколько баз и разных БИНов он обслуживает; null — без ограничения. */
export type AgentLimits = {
	maxBases: number | null; maxBins: number | null;
	/** Активные БИНы (СВ4): есть — обслуживаются ровно они; null — правило «первые maxBins по порядку». */
	activeBins?: string[] | null;
};

/** Организация базы бизнес-агента с пометками лимита. */
export type AgentBaseOrg = {
	id: string | null; name: string | null; bin: string | null;
	/** Сверх лимита: база сверх лимита баз или БИН сверх лимита БИНов. */
	overLimit: boolean;
	/** Другие базы агента с тем же БИН. */
	alsoIn: string[];
	/** База, в которую уходят команды по этому БИН (первая обслуживаемая по порядку); null — ни в какую. */
	usedBase: string | null;
	/** Активирован ли БИН; null — списка активных нет. */
	active?: boolean | null;
};

/** База в срезе бизнес-агента — как её прислал агент, плюс решение сервиса по лимиту. */
export type AgentBaseRow = {
	key: string; pos: number; status: string | null; transport: "http" | "com" | null;
	extVersion: string | null;
	/** Сверх лимита по мнению самого агента; null — агент лимитов не применял. */
	overLimit: boolean | null;
	/** Сверх лимита по правилу сервиса: команды в неё сервис отвергает, не ставя в очередь. */
	overLimitService: boolean;
	/** Агент и сервис считают лимит по-разному (после смены лимита — до следующего heartbeat это нормально). */
	limitMismatch?: boolean;
	/** null — агент организаций не сообщил (сборка старше 19.09). */
	organizations: AgentBaseOrg[] | null;
	seenAt: string | null;
};

export type AgentBasesView = {
	limits: AgentLimits;
	/** Подключено: баз и разных БИНов во всём срезе. */
	usage: { bases: number; bins: number };
	bases: AgentBaseRow[];
	role?: "business" | "admin";
	/** Менять лимит может только администратор BuhProf. */
	canEditLimits?: boolean;
};

/** Базы бизнес-агента и лимит тарифа — из среза, который агент прислал сам (без команды агенту). */
export const fetchAgentBases = (id: string) =>
	aiFetch<AgentBasesView>(`/v1/onec/agents/${encodeURIComponent(id)}/bases`);

/** Лимит тарифа агента (только администратор BuhProf). Действует со следующего heartbeat агента. */
export const setAgentLimits = (id: string, limits: AgentLimits) =>
	aiFetch<AgentBasesView>(`/v1/onec/agents/${encodeURIComponent(id)}/limits`, {
		method: "PUT", body: JSON.stringify(limits),
	});

/**
 * Активные БИНы агента целиком: список, `null` — вернуться к правилу «первые N», `fixCurrent` — записать то, что
 * агент обслуживает сейчас. Только администратор BuhProf.
 */
export const setAgentActiveBins = (id: string, body: { bins: string[] | null } | { fixCurrent: true }) =>
	aiFetch<AgentBasesView>(`/v1/onec/agents/${encodeURIComponent(id)}/active-bins`, {
		method: "PUT", body: JSON.stringify(body),
	});

/** Всем бизнес-агентам без списка — записать активными то, что они обслуживают сейчас (C15). */
export const fixAllActiveBins = () =>
	aiFetch<{ fixed: { agentId: string; name: string; bins: number }[]; skipped: number }>("/v1/onec/active-bins/fix-all", { method: "POST", body: "{}" });

// ── Управление самой службой агента (задача агенту, выпуск 2026-09-20) ───────────────────────────────

/** Настройки службы, как их отдаёт агент. Секретов здесь нет — только признак «задан». */
export type AgentConfig = {
	configPath?: string; role?: string; serviceName?: string; serverName?: string;
	bases?: {
		key: string; transport?: string; address?: string; user?: string; enabled?: boolean; order?: number; main?: boolean;
		password?: { set?: boolean }; token?: { set?: boolean };
	}[];
	ibParallel?: number; commandTimeoutSecs?: number; longCommandTimeoutSecs?: number;
	orphanSweepSecs?: number; persistentBridge?: boolean; idleCloseSecs?: number;
	logLevel?: string; heartbeatSecs?: number; pollWaitSecs?: number;
	cloudUrl?: string; updateHosts?: string[];
	secrets?: Record<string, { set?: boolean }>;
	/** Какие поля агент разрешает менять из панели. */
	editable?: string[];
	changed?: string[];
	restartRequired?: boolean;
};

/** Что панель вправе менять: порядок и включение баз, параллельность, пределы времени, уровень журнала. */
export type AgentConfigPatch = {
	bases?: { key: string; order?: number; enabled?: boolean }[];
	ibParallel?: number;
	commandTimeoutSecs?: number;
	longCommandTimeoutSecs?: number;
	logLevel?: string;
};

export const fetchAgentConfig = (id: string) =>
	aiFetch<AgentConfig | Pending>(`/v1/onec/agents/${encodeURIComponent(id)}/config`)
		.then((d) => (isPending(d) ? awaitCommand<AgentConfig>(d, 2 * 60_000) : d));

export const setAgentConfig = (id: string, patch: AgentConfigPatch) =>
	aiFetch<AgentConfig | Pending>(`/v1/onec/agents/${encodeURIComponent(id)}/config`, { method: "PUT", body: JSON.stringify({ patch }) })
		.then((d) => (isPending(d) ? awaitCommand<AgentConfig>(d, 2 * 60_000) : d));

/** Перезапуск службы: агент отвечает сразу и перезапускается сам; занятый изменяющей командой — AGENT_BUSY. */
export const restartAgent = (id: string, reason?: string) =>
	aiFetch<{ ok: boolean; restartingAt?: string; service?: string } | Pending>(`/v1/onec/agents/${encodeURIComponent(id)}/restart`, {
		method: "POST", body: JSON.stringify(reason ? { reason } : {}),
	}).then((d) => (isPending(d) ? awaitCommand<{ ok: boolean }>(d, 2 * 60_000) : d));

/** Обновление службы: сборка, адрес и хэш — из настроек сервиса, если не переданы. Ход виден в карточке агента. */
export const updateAgent = (id: string, body: { build?: string; url?: string; sha256?: string } = {}) =>
	aiFetch<{ ok: boolean; accepted?: boolean; build?: string } | Pending>(`/v1/onec/agents/${encodeURIComponent(id)}/update`, {
		method: "POST", body: JSON.stringify(body),
	}).then((d) => (isPending(d) ? awaitCommand<{ ok: boolean }>(d, 2 * 60_000) : d));

// ── Команды и журнал агента (карточка агента) ────────────────────────────────────────────────────────

export type AgentCommand = {
	id: string; type: string; baseKey: string | null; state: string; requestId: string | null;
	error: { code: string | null; message: string | null } | null;
	createdAt: string; dispatchedAt: string | null; finishedAt: string | null;
};

export const fetchAgentCommands = (id: string, limit = 50) =>
	aiFetch<{ items: AgentCommand[] }>(`/v1/onec/agents/${encodeURIComponent(id)}/commands?limit=${limit}`);

export type AgentAuditItem = { at: string; event: string; userUuid: string | null; userName: string | null; details: Record<string, unknown> };

export const fetchAgentAudit = (id: string) =>
	aiFetch<{ items: AgentAuditItem[] }>(`/v1/onec/agents/${encodeURIComponent(id)}/audit`);

// ── Подключение агентов по коду (СВ5) ────────────────────────────────────────────────────────────────

export type EnrollmentState = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export type AgentEnrollment = {
	id: string; code: string; computer: string; serviceName: string; name: string; role: "business" | "admin";
	serverName: string | null; version: string | null; ip: string | null; repeats: number; state: EnrollmentState;
	note: string | null; decidedBy: string | null; decidedAt: string | null; organizationUuid: string | null;
	agentId: string | null; tokenDeliveredAt: string | null; createdAt: string; expiresAt: string;
	/** Та же служба уже подключалась — одобрение отдаст ей того же агента с новым токеном. */
	previousAgentId: string | null;
};

export const fetchEnrollments = (params: { state?: EnrollmentState | ""; q?: string } = {}) => {
	const qs = new URLSearchParams();
	if (params.state) qs.set("state", params.state);
	if (params.q) qs.set("q", params.q);
	return aiFetch<{ items: AgentEnrollment[]; canDecide: boolean }>(`/v1/onec/enrollments${qs.toString() ? `?${qs.toString()}` : ""}`);
};

/** Организация нужна бизнес-агенту; агент кластера обслуживает весь сервер — ему её не задают. */
export const approveEnrollment = (id: string, body: { organizationUuid?: string; name?: string; agentId?: string | null; note?: string }) =>
	aiFetch<{ ok: boolean; agentId: string; created: boolean }>(`/v1/onec/enrollments/${encodeURIComponent(id)}/approve`, {
		method: "POST", body: JSON.stringify(body),
	});

export const rejectEnrollment = (id: string, note: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/enrollments/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ note }) });

// ── Заявки на подключение баз (СВ4, часть 1) ────────────────────────────────────────────────────────────

export type RegistrationState = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export type ErpOrganization = { uuid: string; name: string; bin: string | null };

export type BaseRegistration = {
	id: string; code: string; state: RegistrationState; note: string | null;
	base: {
		id: string; name: string; kind?: "server" | "file"; server?: string | null;
		configuration?: { name?: string; synonym?: string; version?: string } | null;
		platform?: string | null; extensionVersion?: string | null; computer?: string | null;
	};
	user: { id?: string | null; name?: string | null } | null;
	contact: string | null; comment: string | null;
	/** Организации базы; `erp` — организация ERP с тем же БИН, если есть. */
	organizations: { id?: string | null; name?: string | null; bin?: string | null; erp: ErpOrganization | null }[];
	ip: string | null; repeats: number; createdAt: string; expiresAt: string;
	decidedBy: string | null; decidedAt: string | null; organizationUuid: string | null; baseKey: string | null;
	tokenDelivered: boolean;
	/** Что предложить при одобрении: организация по БИН, ключ базы, базы реестра с тем же ключом. */
	suggestion: { organizationUuid: string | null; baseKey: string; candidates: { baseId: string; key: string; server: string }[] };
};

export const fetchRegistrations = (params: { state?: RegistrationState | ""; q?: string } = {}) => {
	const qs = new URLSearchParams();
	if (params.state) qs.set("state", params.state);
	if (params.q) qs.set("q", params.q);
	return aiFetch<{ items: BaseRegistration[]; canDecide: boolean }>(`/v1/onec/registrations${qs.toString() ? `?${qs.toString()}` : ""}`);
};

export const fetchErpOrganizations = () => aiFetch<{ items: ErpOrganization[] }>("/v1/onec/erp-organizations");

export const approveRegistration = (id: string, body: { organizationUuid: string; baseKey: string; baseId?: string | null; note?: string }) =>
	aiFetch<{ ok: boolean; baseKey: string; server: string }>(`/v1/onec/registrations/${encodeURIComponent(id)}/approve`, {
		method: "POST", body: JSON.stringify(body),
	});

export const rejectRegistration = (id: string, note: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/registrations/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ note }) });

/*
 * ОТКАЗЫ ЧАТА ОТДЕЛЬНОЙ ФУНКЦИЕЙ БОЛЬШЕ НЕ ЧИТАЮТСЯ (23.09). Их показывала таблица под токенами базы, а с
 * появлением журнала вызовов (ниже) это стало вторым рассказом об одном событии: журнал отдаёт и отказы, и
 * успешные вызовы, по одной базе и по всем сразу. Маршрут `/v1/onec/chat-failures` в сервисе остался — как
 * точка разбора для поддержки, а панель ходит в журнал.
 */

/**
 * ЖУРНАЛ ВЫЗОВОВ ЧАТА (ПН8): что вызывали из чата в 1С, по какой базе и чем кончилось.
 *
 * Дополняет отказы выше: там только неудачи задач и заметок, здесь — весь след канала, включая
 * вызовы в саму 1С. `state` различает четыре исхода, и каждый лечится по-своему: `sent` — ушло в
 * 1С, ответа пока нет (форма могла закрыться); `ok`; `failed` — 1С или ERP ответили отказом;
 * `rejected` — сервис не выпустил вызов (модель сослалась на объект, которого в диалоге не было).
 */
export type ChatCall = {
	at: string; conversationId: string | null; target: "1c" | "erp";
	tool: string; commandType: string; callId: string | null;
	state: "sent" | "ok" | "failed" | "rejected";
	code: string | null; message: string | null;
	baseId: string | null; organizationUuid: string | null; organizationName: string | null; userUuid: string | null;
};

/**
 * БАЗЫ С РАСШИРЕНИЕМ — сводка по источникам самого расширения: заявки, токены, срез бизнес-агентов.
 *
 * НЕ ИЗ РЕЕСТРА КЛАСТЕРА. Тот ведёт админ-агент, и панель сужает его до выбранного кластера; расширение к
 * кластеру не привязано, и у клиента без админ-агента его базы в реестре не появятся вовсе — экран был пуст
 * ровно там, где нужен (разбор 23.09).
 */
export type ExtensionBase = {
	baseKey: string;
	name: string;
	organizationUuid: string | null;
	organizationName: string | null;
	extVersion: string;
	/** Откуда версия: `agent` — сообщает агент сейчас, `registration` — со слов заявки, `none` — не знаем. */
	extVersionSource: "agent" | "registration" | "none";
	/** Доступ к чату 1С: действует, сменён (идёт перекрытие), отозван, не выдавался. */
	access: "active" | "rotating" | "revoked" | "none";
	transport: "http" | "com" | null;
	agentId: string | null;
	agentName: string | null;
	approvedAt: string | null;
	seenAt: string | null;
	/** Заявка подана, решения нет: база просится, доступа пока нет. */
	pending: boolean;
};

export const fetchExtensionBases = () =>
	aiFetch<{ items: ExtensionBase[] }>("/v1/onec/extension-bases");

export const fetchChatCalls = (baseId?: string, limit = 200) =>
	aiFetch<{ items: ChatCall[] }>(`/v1/onec/chat-calls?limit=${limit}${baseId ? `&baseId=${encodeURIComponent(baseId)}` : ""}`);

/**
 * САМОПРОВЕРКА БАЗЫ (ПН6): расширение в базе отвечает, что у него не так. Формат ответа задаёт
 * расширение; разбираем его мягко (selfCheckView), потому что набор проверок будет расти.
 */
export type SelfCheckResult = {
	ok?: boolean;
	version?: string | null;
	checks?: { id?: string; title?: string; ok?: boolean; detail?: string | null; hint?: string | null }[];
	organizations?: { name?: string | null; bin?: string | null }[];
	[k: string]: unknown;
};

export const startSelfCheck = (baseKey: string) =>
	startJob<SelfCheckResult>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/self-check`, {});

/**
 * ЧИСЛА ИЗ 1С В КАРТОЧКЕ ОРГАНИЗАЦИИ (ПН9). Читаются ПО КНОПКЕ и не кэшируются: кэш означал бы
 * третью версию правды рядом с 1С и панелью. Поэтому в ответе есть `readAt` — на какой миг числа
 * верны, и каждая половина отвечает за себя: долги могли не даться, а остатки даться.
 */
export type FinancePart<T> = { ok: true; data: T | null } | { ok: false; error: { code?: string; message?: string } };

/**
 * `TIMEOUT` в половине ответа — не поломка: 1С считает долги по регистрам, сервис ждёт её дольше обычных
 * команд панели (ORG_FINANCE_TIMEOUT_SECS) и, не дождавшись, честно говорит об этом. Команда при этом жива,
 * и повторное чтение обычно приносит ответ сразу.
 */

export type OrganizationFinance = {
	onDate: string; bin: string; baseKey: string; agentId: string; readAt: string;
	debts: FinancePart<unknown>;
	balances: FinancePart<unknown>;
};

/*
 * АДРЕС — В ПОЛЬЗОВАТЕЛЬСКОМ API, А НЕ В `/v1/onec` (аудит 22.09). Тот раздел закрыт правом
 * «Администрирование 1С», а числа смотрит бухгалтер в карточке своей организации: на прежнем адресе
 * вкладка отвечала бы 403 ровно тем, для кого сделана.
 */
export const fetchOrganizationFinance = (organizationUuid: string, onDate?: string) =>
	aiFetch<OrganizationFinance>("/v1/organization-finance", {
		method: "POST", body: JSON.stringify({ organizationUuid, ...(onDate ? { onDate } : {}) }),
	});

/**
 * Базы 1С организации (ПН4): откуда приходят её задачи, заметки и документы.
 *
 * Две разные связи, и обе видны как есть: базе выдан токен чата для этой организации (`chat`) и/или
 * база назвала её БИН в своём списке (`declaredBin`). Первое без второго — база подключена, но эту
 * организацию не ведёт; второе без первого — называет БИН, а чат ей не выдан.
 */
export type OrganizationBase = {
	baseKey: string; name: string; serverName: string | null; disabled: boolean;
	chat: "active" | "revoked" | "none";
	declaredBin: string | null; declaredAt: string | null; lastSeenAt: string | null;
};

export const fetchOrganizationBases = (organizationUuid: string) =>
	aiFetch<{ bin: string | null; items: OrganizationBase[] }>(`/v1/organization-bases?organizationUuid=${encodeURIComponent(organizationUuid)}`);

/** Токен базы для чата внутри 1С: сам токен не хранится — только кем и когда выпущен, отозван ли. */
export type BaseToken = {
	id: string; baseId: string; baseKey: string; organizationUuid: string;
	createdAt: string; createdBy: string; revokedAt: string | null; revokedBy: string | null;
	/** Смена токена: когда пора сменить, кем заменён и до какого мига принимается прежний (перекрытие). */
	rotateAfter: string | null; acceptedUntil: string | null; replacedBy: string | null;
};

/** Токены одной базы (карточка) или всех сразу (раздел «Расширение БухПроф-AI»). */
export const fetchBaseTokens = (baseId?: string) =>
	aiFetch<{ items: BaseToken[]; canRevoke: boolean }>(`/v1/onec/base-tokens${baseId ? `?baseId=${encodeURIComponent(baseId)}` : ""}`);

export const revokeBaseToken = (id: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/base-tokens/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" });

/**
 * Сменить токен базы: сервис выпускает новый и отдаёт его базе в ответе очередного хода — сама база
 * ничего не делает. Прежний токен работает, пока не кончится перекрытие. Оборвать связь немедленно —
 * это «Отозвать», а не смена.
 */
export const rotateBaseToken = (id: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/base-tokens/${encodeURIComponent(id)}/rotate`, { method: "POST", body: "{}" });

// ── Активация БИНов (СВ4, часть 2) ──────────────────────────────────────────────────────────────────────

export type ActivationState = "PENDING" | "APPROVED" | "REJECTED";

export type ActivationRequest = {
	agentId: string; agentName: string | null; agentOnline: boolean;
	bin: string; name: string | null; baseKey: string | null; comment: string | null; requestedAt: string | null;
	state: ActivationState; note: string | null; decidedBy: string | null; decidedAt: string | null;
	createdAt: string; updatedAt: string;
	/** Активен ли БИН сейчас; null — у агента нет списка активных. */
	active: boolean | null;
	limits: AgentLimits | null;
};

export const fetchActivationRequests = (params: { state?: ActivationState | ""; agentId?: string } = {}) => {
	const qs = new URLSearchParams();
	if (params.state) qs.set("state", params.state);
	if (params.agentId) qs.set("agentId", params.agentId);
	return aiFetch<{ items: ActivationRequest[]; canDecide: boolean }>(`/v1/onec/activation-requests${qs.toString() ? `?${qs.toString()}` : ""}`);
};

export const approveActivation = (agentId: string, bin: string) =>
	aiFetch<{ ok: boolean; activeBins: string[]; warning?: string }>(
		`/v1/onec/activation-requests/${encodeURIComponent(agentId)}/${encodeURIComponent(bin)}/approve`, { method: "POST", body: "{}" });

export const rejectActivation = (agentId: string, bin: string, note: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/activation-requests/${encodeURIComponent(agentId)}/${encodeURIComponent(bin)}/reject`, {
		method: "POST", body: JSON.stringify({ note }),
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
/** `state.infobases.stillListed` — удалено, но строка ещё видна кластеру (П17). */
type DropRegistrationResult = { ok: boolean; baseKey?: string; note?: string; state?: { infobases?: { stillListed?: boolean } } };

export const dropBaseRegistration = (baseKey: string) =>
	aiFetch<DropRegistrationResult | Pending>(
		`/v1/onec/bases/${encodeURIComponent(baseKey)}/drop-registration`,
		{ method: "POST", body: JSON.stringify({ confirm: true }) },
	).then((d) => awaitCommand<DropRegistrationResult>(d));

/**
 * СКРЫТЬ БАЗУ ИЗ РАБОТЫ — решение администратора о базе-фантоме.
 *
 * Базу, которая числится в кластере, но которой нет в СУБД, панель убрать из кластера не
 * может: это разрушающее действие над чужой системой, и делает его администратор на самом
 * сервере. Но пока запись жива, база каждый раз попадает в списки и групповые команды и
 * каждый раз отказывает одинаково. Скрытие — отметка в реестре сервиса, обратимая: сняли —
 * база снова в работе (например, после восстановления из копии).
 */
/**
 * УБРАТЬ ИЗ РЕЕСТРА базу, которой нет в кластере (С45).
 *
 * Сервис удаляет только строку `MISSING`: регистрации в кластере нет, данные базы не трогаются. У базы, которая
 * есть в кластере, отказ — её строку полный срез вернул бы через минуты.
 */
export const removeBaseFromRegistry = (key: string) =>
	aiFetch<{ ok: boolean; removed: boolean }>(`/v1/onec/bases/${encodeURIComponent(key)}`, { method: "DELETE" });

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
	/** Сервер 1С этих баз (C10); null — сервер не назван (одна установка, один сервер). */
	serverId: string | null;
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
	/** Сервер 1С; не задан — берётся выбранный в панели. */
	serverId?: string | null;
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

/** `cluster` — агент кластера: обслуживает весь сервер 1С, организация ERP ему не задаётся. */
export const createAgent = (name: string, cluster = false) =>
	aiFetch<{ agent: OnecAgent; token: string }>("/v1/onec/agents", {
		method: "POST", body: JSON.stringify({ name, ...(cluster ? { cluster: true } : {}) }),
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
