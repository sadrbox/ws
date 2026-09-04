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
	/** Сколько расширений видели в базе; null — базу ещё ни разу не проверяли. */
	extensionsCount: number | null;
	extensionsSeenAt: string | null;
	sessionsCount: number | null;
	lastSeenAt: string | null;
	disabled: boolean;
};

/** Строка сеанса или соединения: состав полей задаёт `rac`, поэтому словарь, а не жёсткий тип. */
export type ClusterRow = Record<string, string>;

export const fetchBases = () => aiFetch<{ items: OnecBase[] }>("/v1/onec/bases");

/** Перечитать список баз у кластера. Возвращает уже обновлённый реестр. */
export const refreshBases = () => aiFetch<{ items: OnecBase[] }>("/v1/onec/bases/refresh", { method: "POST" });

export const fetchSessions = (baseKey?: string) =>
	aiFetch<{ items: ClusterRow[] }>(`/v1/onec/sessions${baseKey ? `?baseKey=${encodeURIComponent(baseKey)}` : ""}`);

export const fetchConnections = (baseKey?: string) =>
	aiFetch<{ items: ClusterRow[] }>(`/v1/onec/connections${baseKey ? `?baseKey=${encodeURIComponent(baseKey)}` : ""}`);

/**
 * Снятие сеанса необратимо: несохранённые данные пользователя теряются.
 * `sessionId` — UUID сеанса кластера (поле `session` в строке rac), а не его номер:
 * `rac session terminate --session=` принимает только UUID и на номер отвечает
 * «Ошибка разбора параметра: session».
 */
export const terminateSession = (sessionId: string, baseKey?: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/sessions/${encodeURIComponent(sessionId)}/terminate`, {
		method: "POST",
		body: JSON.stringify(baseKey ? { baseKey } : {}),
	});

/** Блокировка начала сеансов: пользователи не смогут войти в базу, уже вошедшие продолжат работу. */
export const setSessionsLock = (baseKey: string, enabled: boolean, message?: string) =>
	aiFetch<{ ok: boolean }>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/lock`, {
		method: "POST",
		body: JSON.stringify({ enabled, ...(message ? { message } : {}) }),
	});

// ── Содержимое базы: пользователи ИБ и расширения (E15/A3-P1) ───────────────
// Списки спрашиваются у 1С вживую (это команда агенту), сводки — из кэша сервиса.

export type IbUser = { name: string; fullName?: string; disabled?: boolean; roles?: string[] };
export type IbExtension = { name: string; version?: string | null; purpose?: string | null; safeMode?: boolean | null };

export const fetchBaseUsers = (baseKey: string) =>
	aiFetch<{ items: IbUser[] }>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/users`);

export const fetchBaseExtensions = (baseKey: string) =>
	aiFetch<{ items: IbExtension[] }>(`/v1/onec/bases/${encodeURIComponent(baseKey)}/extensions`);

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

export const fetchExtensionSummary = () =>
	aiFetch<{ items: { name: string; bases: number; versions: string[] }[] }>("/v1/onec/extensions");

// ── Пакетные операции (E15/A4) ──────────────────────────────────────────────
// Сервис отвечает СРАЗУ идентификатором задания: сто подключений к 1С в один HTTP-запрос
// не укладываются. Прогресс — опросом fetchBatch.

export type BatchType =
	| "IB_CREATE_USER" | "IB_DELETE_USER"
	| "IB_INSTALL_EXTENSION" | "IB_DELETE_EXTENSION"
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

export const fetchAgents = () => aiFetch<{ items: OnecAgent[] }>("/v1/onec/agents");

/** Есть ли на связи админ-агент с нужной способностью. */
export const hasCapability = (agents: OnecAgent[] | undefined, capability: string): boolean =>
	(agents ?? []).some((a) => a.role === "admin" && a.online && !a.disabled && a.capabilities.includes(capability));
