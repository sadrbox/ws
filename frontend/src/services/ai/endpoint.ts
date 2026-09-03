// Адрес BuhProf AI Service и запросы к нему.
//
// Сервис живёт на отдельном хосте (ai.buhprof.kz / LAN :3100) и проверяет ТОТ ЖЕ JWT, что и
// бэкенд ERP, — поэтому запросы идут обычным fetch с Bearer-токеном, а не через apiClient,
// у которого baseURL зашит на бэкенд. Логика выбора адреса вынесена сюда из
// models/AiAssistant: её понадобилось повторить для панели администрирования 1С, а две копии
// разошлись бы при первом же переезде сервиса.

import { getToken } from "src/services/auth";

const LOCAL_AI_URL = (import.meta.env.VITE_LOCAL_AI_URL as string | undefined) || "http://192.168.1.112:3100";
const REMOTE_AI_URL = (import.meta.env.VITE_AI_URL as string | undefined) || "https://ai.buhprof.kz";

/** Локальная сеть — локальный сервис; десктоп (Tauri) и внешний доступ — публичный. */
export function getAiUrl(): string {
	if (typeof window === "undefined") return REMOTE_AI_URL;
	if ("__TAURI_INTERNALS__" in window) return REMOTE_AI_URL;
	const { hostname } = window.location;
	const isLocal = hostname.includes("192.168.") || hostname === "localhost" || hostname === "127.0.0.1";
	return isLocal ? LOCAL_AI_URL : REMOTE_AI_URL;
}

export type Envelope<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

/**
 * Запрос к AI Service в общем конверте {success, data|error}.
 *
 * Ошибку не глотаем и не подменяем: текст из поля error осмысленный и написан для
 * пользователя («нет админ-агента на связи», «агент не умеет…»), а придуманное на его месте
 * «Ошибка сервера» стоило бы часа разбирательств.
 */
export async function aiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${getAiUrl()}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${getToken() ?? ""}`,
			...(init?.headers ?? {}),
		},
	});

	let body: Envelope<T> | null = null;
	try {
		body = (await res.json()) as Envelope<T>;
	} catch {
		body = null;
	}
	if (!res.ok || !body?.success) {
		throw new Error(body?.error?.message || `HTTP ${res.status}`);
	}
	return body.data as T;
}
