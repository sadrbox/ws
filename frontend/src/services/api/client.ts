import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from "axios";
import { isNetworkError, buildEntryFromAxiosConfig, enqueue } from "src/services/offlineQueue";

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
apiClient.interceptors.request.use((config) => {
	if (config.data instanceof FormData) {
		delete config.headers["Content-Type"];
	}

	const token = localStorage.getItem("auth_token");
	if (token) {
		config.headers.Authorization = `Bearer ${token}`;
	}

	return config;
});

// Interceptor: при 401 ответе — очищаем токен и перенаправляем на логин
apiClient.interceptors.response.use(
	(response) => response,
	(error) => {
		if (error.response?.status === 401) {
			// Не обрабатываем 401 при самом запросе логина
			const url = error.config?.url || "";
			if (!url.includes("/auth/login")) {
				localStorage.removeItem("auth_token");
				localStorage.removeItem("auth_user");
				// Диспатчим событие чтобы App перерисовался
				window.dispatchEvent(new Event("auth_logout"));
			}
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

	console.warn(
		`[API] 429 Too Many Requests → retry ${config._retryCount}/${MAX_RETRIES} через ${Math.round(delay)}ms: ${config.url}`,
	);

	await new Promise((r) => setTimeout(r, delay));
	return apiClient.request(config);
});

// ═══════════════════════════════════════════════════════════════════════════
// Interceptor: offline queue — при ошибке сети сохраняем мутирующие запросы
// ═══════════════════════════════════════════════════════════════════════════
apiClient.interceptors.response.use(undefined, async (error: AxiosError) => {
	// Только ошибки сети (нет response / timeout / ERR_NETWORK)
	if (!isNetworkError(error)) {
		return Promise.reject(error);
	}

	const config = error.config;
	if (!config) return Promise.reject(error);

	// Если это уже retry-запрос из sync engine — не ставим в очередь повторно
	if ((config as any)._fromSyncEngine) {
		return Promise.reject(error);
	}

	// Auth-запросы не ставим в очередь — у них своя offline-логика
	const url = config.url || "";
	if (url.includes("/auth/")) {
		return Promise.reject(error);
	}

	// Формируем запись для очереди
	const entry = buildEntryFromAxiosConfig(config);
	if (!entry) {
		// GET-запросы и FormData не сохраняем — просто отбрасываем
		return Promise.reject(error);
	}

	// Сохраняем в IndexedDB
	try {
		const id = await enqueue(entry);
		console.warn(
			`[Offline] Запрос сохранён в очередь (id=${id}): ${entry.method} ${entry.url}`,
		);

		// Возвращаем "успешный" ответ с offline-меткой,
		// чтобы форма не показывала ошибку, а показала уведомление
		return {
			data: {
				_offline: true,
				_queueId: id,
				message: "Данные сохранены локально. Синхронизация произойдёт при восстановлении связи.",
			},
			status: 202,
			statusText: "Accepted (Offline)",
			headers: {},
			config,
		};
	} catch (enqueueError) {
		console.error("[Offline] Не удалось сохранить в очередь:", enqueueError);
		return Promise.reject(error);
	}
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
