import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

const LOCAL_API_URL = "http://192.168.1.112:3000/api/v1";
const REMOTE_API_URL = "http://buhprof.ddns.me:3000/api/v1";

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
