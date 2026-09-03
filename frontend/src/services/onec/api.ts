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
	/** Версия расширения buhprof_api; null — не установлено или ещё не проверялось. */
	extVersion: string | null;
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

/** Снятие сеанса необратимо: несохранённые данные пользователя теряются. */
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
