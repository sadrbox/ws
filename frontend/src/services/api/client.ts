import axios, {
	type AxiosInstance,
	type AxiosRequestConfig,
	type AxiosError,
} from "axios";
import { getOnecServer } from "src/services/onec/serverScope";
import { isGroupScope } from "src/services/orgScope";
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from "../auth";
import { isNetworkError as isNetworkLikeError } from "../networkUtils";
import { notify } from "src/components/TechMessages/store";
import { translate } from "src/i18";

/*
 * АДРЕС API — ИЗ НАСТРОЙКИ УСТАНОВКИ, А НЕ ИЗ ДОГАДКИ (У2 плана PLAN_INSTALL_MODES_2026-09-24.md).
 *
 * Раньше адрес ВЫВОДИЛСЯ из имени хоста браузера: «192.168.* или localhost → локальный, иначе →
 * api.aleppo.kz». На нашем единственном сервере это работало, на чужом домене угадывает неверно
 * — и фронт клиента стучится к нам. Это не настройка, а совпадение.
 *
 * Теперь по убыванию явности:
 *   1. VITE_API_URL — адрес, заданный при сборке установки. Единственный правильный способ;
 *   2. тот же источник, что и страница (`/api/v1`), когда фронт и бэкенд за одним прокси, —
 *      типовая установка за nginx или туннелем;
 *   3. прежнее угадывание — только для нашей исторической раскладки (фронт 5173, бэкенд 3000)
 *      и для Tauri, где страница грузится с tauri.localhost и об установке ничего не говорит.
 *
 * ⚠ ПРОВЕРИТЬ ПОТОМ: на каждой новой установке задавать VITE_API_URL при сборке; шаг 3 — костыль
 * совместимости и должен уйти, когда установщик начнёт писать .env сам.
 */
const CONFIGURED_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || "";
const LOCAL_API_URL = (import.meta.env.VITE_LOCAL_API_URL as string | undefined) || "http://192.168.1.112:3000/api/v1";
const REMOTE_API_URL = (import.meta.env.VITE_REMOTE_API_URL as string | undefined) || "https://api.aleppo.kz/api/v1";
/** Порт исторической раскладки: фронт отдаётся отдельно от бэкенда. */
const LEGACY_SPLIT_PORTS = ["5173", "4173"];

/** Десктоп-клиент (Tauri): фронт зашит в бинарник, страница грузится с tauri.localhost. */
const isTauri = (): boolean =>
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function getApiUrl(): string {
	if (CONFIGURED_API_URL) return CONFIGURED_API_URL;

	// В Tauri сервер API — всегда удалённый: локального dev-хоста рядом нет, а полагаться
	// на hostname нельзя (там tauri.localhost — совпадение, а не намерение).
	if (isTauri()) return REMOTE_API_URL;

	const { hostname, port, origin } = window.location;
	const isLocal =
		hostname.includes("192.168.") ||
		hostname === "localhost" ||
		hostname === "127.0.0.1";
	// Историческая раскладка «фронт на своём порту»: бэкенд рядом не живёт. Сюда же — любой
	// dev-сервер Vite: /api он не проксирует, а через туннель (aleppo.kz) порта в адресе нет.
	if (import.meta.env.DEV || LEGACY_SPLIT_PORTS.includes(port)) return isLocal ? LOCAL_API_URL : REMOTE_API_URL;
	// Обычная установка: фронт и API за одним адресом.
	return `${origin}/api/v1`;
}

/** Базовый URL API (…/api/v1). Нужен для EventSource (SSE): axios его не обслуживает. */
export const API_BASE_URL = getApiUrl();

export interface ApiError {
	message: string;
	statusCode: number;
}

/**
 * Форма ОШИБКИ запроса (axios-подобная) — для сужения `unknown` в catch без `any`.
 * Отличается от ApiError выше: та описывает полезную нагрузку, эта — сам объект
 * исключения, который приходит в catch.
 */
export interface RequestError {
	response?: { status?: number; data?: { message?: string } };
	message?: string;
}

export const apiClient: AxiosInstance = axios.create({
	baseURL: getApiUrl(),
	timeout: 15000,
	headers: {
		"Content-Type": "application/json",
		Accept: "application/json",
	},
});

// Interceptor: при отправке FormData удаляем Content-Type,
// чтобы браузер сам выставил multipart/form-data с правильным boundary
// + добавляем JWT-токен из localStorage
// + добавляем X-Organization-ID для multi-tenant изоляции
apiClient.interceptors.request.use((config) => {
	if (config.data instanceof FormData) {
		delete config.headers["Content-Type"];
	}

	try {
		const token = localStorage.getItem(AUTH_TOKEN_KEY);
		if (token) {
			config.headers.Authorization = `Bearer ${token}`;
		}

		// Читаем organizationUuid из кэшированного пользователя и добавляем как заголовок
		// Бэкенд ДОВЕРЯЕТ только JWT-токену, заголовок — для аудита и дополнительного контроля
		const userJson = localStorage.getItem(AUTH_USER_KEY);
		if (userJson) {
			const user = JSON.parse(userJson) as { organizationUuid?: string | null };
			if (user.organizationUuid) {
				config.headers["X-Organization-ID"] = user.organizationUuid;
			}
		}
	} catch {
		/* localStorage недоступен (private browsing и т.д.) */
	}

	/*
	 * ВЫБРАННЫЙ КЛАСТЕР 1С — и в запросах к ERP (аудит 21.09). Список баз идёт через прокси бэкенда
	 * (`onec-bases`), и без этого заголовка он отдавал базы всех серверов, хотя в панели выбран один.
	 * Прочих запросов ERP заголовок не касается — бэкенд его просто не читает.
	 */
	const onecServer = getOnecServer();
	// Только прокси-эндпойнты панели 1С: лишний заголовок в остальных запросах — лишняя предварительная проверка.
	if (onecServer && typeof config.url === "string" && /(^|\/)onec-/.test(config.url)) {
		config.headers["X-Onec-Server"] = onecServer;
	}

	// Сводный вид по группе организаций (Г2): выбор зрителя, а не свойство запроса, — поэтому
	// заголовком, как и выбранный сервер 1С. Сервер сам ограничит сводку доступными орг.
	if (isGroupScope()) {
		config.headers = config.headers ?? {};
		config.headers["X-Org-Scope"] = "group";
	}

	return config;
});

// Interceptor: при 401 ответе — очищаем токен и перенаправляем на логин
apiClient.interceptors.response.use(
	(response) => response,
	(error: AxiosError) => {
		const status = error.response?.status;

		if (status === 401) {
			// Не обрабатываем 401 при самом запросе логина
			const url = error.config?.url || "";
			if (!url.includes("/auth/login")) {
				try {
					localStorage.removeItem(AUTH_TOKEN_KEY);
					localStorage.removeItem(AUTH_USER_KEY);
				} catch {
					/* ignore */
				}
				// Диспатчим событие чтобы App перерисовался
				window.dispatchEvent(new Event("auth_logout"));
			}
		}

		if (status === 403) {
			const serverMessage: string | undefined = (error.response?.data as { message?: string } | undefined)?.message;
			const message =
				serverMessage && serverMessage.length < 200
					? serverMessage
					: "У вас недостаточно прав для выполнения этого действия";
			// Тост «сейчас» и след в журнале. Ключ склеивает очередь 403 от одного экрана
			// (десяток запросов разом) в одну запись; routeError этот отказ не повторяет.
			notify({
				severity: "error", text: message, source: translate("system"),
				key: "http-403", toastDuration: 6000,
			});
		}

		return Promise.reject(
			error instanceof Error ? error : new Error(String(error)),
		);
	},
);

// ═══════════════════════════════════════════════════════════════════════════
// Interceptor: retry с exponential backoff при 429 (Too Many Requests)
// ═══════════════════════════════════════════════════════════════════════════
const MAX_RETRIES = 3;

apiClient.interceptors.response.use(undefined, async (error: AxiosError) => {
	const config = error.config as AxiosRequestConfig & { _retryCount?: number };
	if (!config || error.response?.status !== 429) {
		return Promise.reject(error);
	}

	config._retryCount = (config._retryCount ?? 0) + 1;
	if (config._retryCount > MAX_RETRIES) {
		return Promise.reject(error);
	}

	// Retry-After header или экспоненциальный backoff
	const retryAfterHeader = error.response?.headers?.["retry-after"] as string | undefined;
	const baseDelay = retryAfterHeader
		? Number(retryAfterHeader) * 1000
		: 1000 * Math.pow(2, config._retryCount - 1); // 1s, 2s, 4s
	// Добавляем jitter ±25%
	const jitter = baseDelay * (0.75 + Math.random() * 0.5);
	const delay = Math.min(jitter, 10_000); // не более 10 сек

	// silent retry — no user notification needed

	await new Promise((r) => setTimeout(r, delay));
	return apiClient.request(config);
});

// ═══════════════════════════════════════════════════════════════════════════
// Interceptor: offline — при ошибке сети мутирующие запросы получают _offline заглушку
// Фактическое сохранение в IndexedDB делает useFormStore / offlineDataService
// ═══════════════════════════════════════════════════════════════════════════
apiClient.interceptors.response.use(undefined, async (error: AxiosError) => {
	// Определяем ошибку сети
	if (!isNetworkLikeError(error)) {
		return Promise.reject(error);
	}

	const config = error.config;
	if (!config) return Promise.reject(error);

	// Если это retry-запрос из sync engine — не оборачиваем
	if ((config as { _fromSyncEngine?: boolean })._fromSyncEngine) {
		return Promise.reject(error);
	}

	// Health-check запросы не оборачиваем — они используются для определения статуса сети
	if ((config as { _healthCheck?: boolean })._healthCheck) {
		return Promise.reject(error);
	}

	// Auth-запросы не оборачиваем
	const url = config.url || "";
	if (url.includes("/auth/") || url.includes("/sync/")) {
		return Promise.reject(error);
	}

	const method = (config.method || "").toUpperCase();
	// Только мутирующие запросы (POST, PUT, DELETE)
	if (!["POST", "PUT", "DELETE"].includes(method)) {
		return Promise.reject(error);
	}

	// FormData не сериализуем
	if (config.data instanceof FormData) {
		return Promise.reject(error);
	}

	// Возвращаем "успешный" ответ с offline-меткой,
	// чтобы вызывающий код (useFormStore) обработал offline-сохранение
	return {
		data: {
			_offline: true,
			message:
				"Данные сохранены локально. Синхронизация произойдёт при восстановлении связи.",
		},
		status: 202,
		statusText: "Accepted (Offline)",
		headers: {},
		config,
	};
});

/** Типизированные сокращения для удобства */
export const api = {
	get: <T>(url: string, config?: AxiosRequestConfig) =>
		apiClient.get<T>(url, config).then((r) => r.data),

	post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
		apiClient.post<T>(url, data, config).then((r) => r.data),

	put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
		apiClient.put<T>(url, data, config).then((r) => r.data),

	patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
		apiClient.patch<T>(url, data, config).then((r) => r.data),

	delete: <T>(url: string, config?: AxiosRequestConfig) =>
		apiClient.delete<T>(url, config).then((r) => r.data),
};

export default apiClient;
