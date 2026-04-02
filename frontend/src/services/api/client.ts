import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

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
