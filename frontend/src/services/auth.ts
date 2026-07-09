import apiClient from "./api/client";
import { logger } from "src/utils/logger";
import { isNetworkError } from "./networkUtils";

export interface OrgEntry {
	organizationUuid: string;
	role: string;
	organization?: {
		uuid: string;
		name: string | null;
		legalName?: string | null;
		bin?: string | null;
	} | null;
}

export interface AuthUser {
	uuid: string;
	username: string;
	email: string | null;
	organizationUuid?: string | null;
	isSuperAdmin?: boolean;
	allowedOrgUuids?: string[];
	userSettings?: OrgEntry[];
	userAccessRights?: {
		modelName: string;
		accessLevel: string;
	}[];
	employee?: {
		uuid: string;
		fullName: string | null;
		firstName: string | null;
		lastName: string | null;
		middleName: string | null;
		iin: string | null;
		avatarPath: string | null;
		organizationUuid: string | null;
		organization?: { uuid: string; name: string; bin?: string } | null;
		userAccessRights?: {
			modelName: string;
			accessLevel: string;
		}[];
	} | null;
}

export interface LoginResponse {
	success: boolean;
	token: string;
	user: AuthUser;
	message?: string;
}

export const AUTH_TOKEN_KEY = "auth_token";
export const AUTH_USER_KEY = "auth_user";
/** Ключ для хранения хэша пароля (SHA-256) для offline-входа */
const AUTH_OFFLINE_HASH_KEY = "auth_offline_hash";
/** Ключ для хранения username для offline-входа */
const AUTH_OFFLINE_USER_KEY = "auth_offline_user";

// ═══════════════════════════════════════════════════════════════════════════
// OFFLINE AUTH HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Хэшируем пароль через Web Crypto API (SHA-256).
 * Используем «salt» из username чтобы одинаковые пароли разных пользователей
 * давали разные хэши.
 */
async function hashCredentials(username: string, password: string): Promise<string> {
	const data = new TextEncoder().encode(`${username.toLowerCase()}:${password}`);
	const buf = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Сохраняет хэш credentials для будущего offline-входа */
async function cacheCredentialsForOffline(username: string, password: string): Promise<void> {
	try {
		const hash = await hashCredentials(username, password);
		localStorage.setItem(AUTH_OFFLINE_HASH_KEY, hash);
		localStorage.setItem(AUTH_OFFLINE_USER_KEY, username.toLowerCase());
	} catch {
		// Web Crypto может быть недоступен (не HTTPS и не localhost)
	}
}

/** Проверяет credentials против кэшированного хэша */
async function verifyOfflineCredentials(username: string, password: string): Promise<boolean> {
	try {
		const storedHash = localStorage.getItem(AUTH_OFFLINE_HASH_KEY);
		const storedUser = localStorage.getItem(AUTH_OFFLINE_USER_KEY);
		if (!storedHash || !storedUser) return false;
		if (storedUser !== username.toLowerCase()) return false;
		const hash = await hashCredentials(username, password);
		return hash === storedHash;
	} catch {
		return false;
	}
}

/**
 * Логин пользователя.
 * При ошибке сети — пробует offline-вход по кэшированному хэшу.
 */
export async function login(
	username: string,
	password?: string,
	code?: string,
): Promise<{ success: boolean; user?: AuthUser; message?: string; offline?: boolean; twoFactorRequired?: boolean }> {
	try {
		const res = await apiClient.post<LoginResponse>("/auth/login", {
			username,
			password: password || undefined,
			code: code || undefined,
		});
		const data = res.data;

		if (data.success && data.token) {
			localStorage.setItem(AUTH_TOKEN_KEY, data.token);
			localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
			// Кэшируем хэш для будущего offline-входа
			if (password) {
				cacheCredentialsForOffline(username, password).catch(() => {});
			}
			return { success: true, user: data.user };
		}

		return { success: false, message: data.message || "Ошибка авторизации" };
	} catch (err: any) {
		// Требуется код 2FA — сообщаем форме, чтобы показать поле ввода кода.
		if (err.response?.data?.twoFactorRequired) {
			return { success: false, twoFactorRequired: true, message: err.response.data.message || "Введите код двухфакторной аутентификации" };
		}
		// ── Offline fallback ──
		// Если ошибка сети и у нас есть кэшированные credentials — проверяем
		if (isNetworkError(err) && password) {
			const cached = getCurrentUser();
			const token = getToken();
			if (cached && token) {
				const valid = await verifyOfflineCredentials(username, password);
				if (valid) {
					return {
						success: true,
						user: cached,
						offline: true,
					};
				}
			}
			return {
				success: false,
				message: "Нет связи с сервером. Offline-вход невозможен — ранее не было успешного входа с этим паролем.",
			};
		}

		const msg =
			err.response?.data?.message || err.message || "Ошибка соединения";
		return { success: false, message: msg };
	}
}

/**
 * Выход из системы.
 * Очищаем и онлайн-токен, и offline-credentials.
 */
export function logout(): void {
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
	localStorage.removeItem(AUTH_OFFLINE_HASH_KEY);
	localStorage.removeItem(AUTH_OFFLINE_USER_KEY);
	window.dispatchEvent(new Event("auth_logout"));
}

/**
 * Получить текущего пользователя из localStorage
 */
export function getCurrentUser(): AuthUser | null {
	try {
		const json = localStorage.getItem(AUTH_USER_KEY);
		return json ? JSON.parse(json) : null;
	} catch {
		return null;
	}
}

/**
 * Получить JWT-токен
 */
export function getToken(): string | null {
	return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Проверить, авторизован ли пользователь
 */
export function isAuthenticated(): boolean {
	return !!localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Регистрация организации + первого пользователя
 */
export async function registerOrganization(data: {
	bin: string;
	name?: string;
	legalName?: string;
	username: string;
	password: string;
	email?: string;
}): Promise<{ success: boolean; user?: AuthUser; inviteCode?: string; message?: string }> {
	try {
		const res = await apiClient.post<LoginResponse & { inviteCode?: string }>("/auth/register", data);
		const d = res.data;
		if (d.success && d.token) {
			localStorage.setItem(AUTH_TOKEN_KEY, d.token);
			localStorage.setItem(AUTH_USER_KEY, JSON.stringify(d.user));
			return { success: true, user: d.user, inviteCode: (d as any).inviteCode };
		}
		return { success: false, message: d.message || "Ошибка регистрации" };
	} catch (err: any) {
		return { success: false, message: err.response?.data?.message || err.message || "Ошибка соединения" };
	}
}

/**
 * Присоединение к организации по invite-коду
 */
export async function joinOrganization(data: {
	inviteCode: string;
	username: string;
	password: string;
	email?: string;
}): Promise<{ success: boolean; user?: AuthUser; message?: string }> {
	try {
		const res = await apiClient.post<LoginResponse>("/auth/join", data);
		const d = res.data;
		if (d.success && d.token) {
			localStorage.setItem(AUTH_TOKEN_KEY, d.token);
			localStorage.setItem(AUTH_USER_KEY, JSON.stringify(d.user));
			return { success: true, user: d.user };
		}
		return { success: false, message: d.message || "Ошибка присоединения" };
	} catch (err: any) {
		return { success: false, message: err.response?.data?.message || err.message || "Ошибка соединения" };
	}
}

/**
 * Проверить токен на сервере.
 * При сетевой ошибке — НЕ удаляем токен, возвращаем кэшированного пользователя
 * (offline-режим). Удаляем credentials только при реальном 401/403.
 */
export async function verifyToken(): Promise<AuthUser | null> {
	try {
		const res = await apiClient.get<{ success: boolean; user: AuthUser }>(
			"/auth/me",
		);
		if (res.data?.success && res.data.user) {
			localStorage.setItem(AUTH_USER_KEY, JSON.stringify(res.data.user));
			return res.data.user;
		}
		// Сервер ответил, но success=false — невалидный токен
		localStorage.removeItem(AUTH_TOKEN_KEY);
		localStorage.removeItem(AUTH_USER_KEY);
		return null;
	} catch (err: any) {
		// ── Ошибка сети → offline-режим ──
		// Не удаляем токен! Пользователь сможет работать с кэшированными данными.
		if (isNetworkError(err)) {
			const cached = getCurrentUser();
			if (cached) {
				logger.info("[Auth] Offline mode — using cached user");
				return cached;
			}
		}

		// Реальная ошибка (401, 403, и т.д.) — чистим credentials
		localStorage.removeItem(AUTH_TOKEN_KEY);
		localStorage.removeItem(AUTH_USER_KEY);
		return null;
	}
}

/**
 * Переключение активной организации без перелогина.
 * Отправляет PATCH /auth/switch-org, получает новый JWT и обновлённого пользователя.
 * Диспатчит событие "auth_org_switched" для обновления контекста.
 */
export async function switchOrganization(
	organizationUuid: string | null,
): Promise<{ success: boolean; user?: AuthUser; message?: string }> {
	try {
		const res = await apiClient.patch<LoginResponse>("/auth/switch-org", { organizationUuid });
		const d = res.data;
		if (d.success && d.token && d.user) {
			localStorage.setItem(AUTH_TOKEN_KEY, d.token);
			localStorage.setItem(AUTH_USER_KEY, JSON.stringify(d.user));
			window.dispatchEvent(new CustomEvent("auth_org_switched", { detail: d.user }));
			return { success: true, user: d.user };
		}
		return { success: false, message: d.message || "Ошибка переключения организации" };
	} catch (err: any) {
		return { success: false, message: err.response?.data?.message || err.message || "Ошибка соединения" };
	}
}

// ── Двухфакторная аутентификация (TOTP) ──────────────────────────────────────
export const twoFactorStatus = () =>
	apiClient.get<{ success: boolean; enabled: boolean }>("/auth/2fa/status").then((r) => r.data);
export const twoFactorSetup = () =>
	apiClient.post<{ success: boolean; secret: string; otpauthUrl: string }>("/auth/2fa/setup").then((r) => r.data);
export const twoFactorEnable = (code: string) =>
	apiClient.post<{ success: boolean; message: string }>("/auth/2fa/enable", { code }).then((r) => r.data);
export const twoFactorDisable = (code: string) =>
	apiClient.post<{ success: boolean; message: string }>("/auth/2fa/disable", { code }).then((r) => r.data);
