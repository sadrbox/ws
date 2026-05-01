import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from "axios";
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from "../auth";
import { isNetworkError as isNetworkLikeError } from "../networkUtils";
import { showToast } from "src/components/UIToast";

const LOCAL_API_URL = "http://192.168.1.112:3000/api/v1";
const REMOTE_API_URL = "https://api.gidra.kz/api/v1";

function getApiUrl(): string {
	const { hostname } = window.location;
	const isLocal =
		hostname.includes("192.168.") ||
		hostname === "localhost" ||
		hostname === "127.0.0.1";
	return isLocal ? LOCAL_API_URL : REMOTE_API_URL;
}

export interface ApiError {
	message: string;
	statusCode: number;
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
	} catch { /* localStorage недоступен (private browsing и т.д.) */ }

	return config;
});

// Interceptor: при 401 ответе — очищаем токен и перенаправляем на логин
apiClient.interceptors.response.use(
	(response) => response,
	(error) => {
		const status = error.response?.status;

		if (status === 401) {
			// Не обрабатываем 401 при самом запросе логина
			const url = error.config?.url || "";
			if (!url.includes("/auth/login")) {
				try {
					localStorage.removeItem(AUTH_TOKEN_KEY);
					localStorage.removeItem(AUTH_USER_KEY);
				} catch { /* ignore */ }
				// Диспатчим событие чтобы App перерисовался
				window.dispatchEvent(new Event("auth_logout"));
			}
		}

		if (status === 403) {
			const serverMessage: string | undefined = error.response?.data?.message;
			const message = serverMessage && serverMessage.length < 200
				? serverMessage
				: "У вас недостаточно прав для выполнения этого действия";
			showToast(message, "error", 6000);
		}

		return Promise.reject(error);
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
	const retryAfterHeader = error.response?.headers?.["retry-after"];
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
	if ((config as any)._fromSyncEngine) {
		return Promise.reject(error);
	}

	// Health-check запросы не оборачиваем — они используются для определения статуса сети
	if ((config as any)._healthCheck) {
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
			message: "Данные сохранены локально. Синхронизация произойдёт при восстановлении связи.",
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
