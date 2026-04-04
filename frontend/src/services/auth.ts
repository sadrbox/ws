import apiClient from "./api/client";

export interface AuthUser {
	uuid: string;
	username: string;
	email: string | null;
	employee?: {
		uuid: string;
		fullName: string | null;
		firstName: string | null;
		lastName: string | null;
		middleName: string | null;
		iin: string | null;
		avatarPath: string | null;
		organizationUuid: string | null;
		accessRights?: {
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

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_USER_KEY = "auth_user";

/**
 * Логин пользователя
 */
export async function login(
	username: string,
	password?: string,
): Promise<{ success: boolean; user?: AuthUser; message?: string }> {
	try {
		const res = await apiClient.post<LoginResponse>("/auth/login", {
			username,
			password: password || undefined,
		});
		const data = res.data;

		if (data.success && data.token) {
			localStorage.setItem(AUTH_TOKEN_KEY, data.token);
			localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
			return { success: true, user: data.user };
		}

		return { success: false, message: data.message || "Ошибка авторизации" };
	} catch (err: any) {
		const msg =
			err.response?.data?.message || err.message || "Ошибка соединения";
		return { success: false, message: msg };
	}
}

/**
 * Выход из системы
 */
export function logout(): void {
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
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
 * Проверить токен на сервере
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
		return null;
	} catch {
		localStorage.removeItem(AUTH_TOKEN_KEY);
		localStorage.removeItem(AUTH_USER_KEY);
		return null;
	}
}
