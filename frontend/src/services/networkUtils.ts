/**
 * networkUtils.ts — единая утилита определения сетевых ошибок.
 *
 * Ранее дублировалась в 5 файлах (offlineQueue, api/client, offlineDataService,
 * syncManager, useInfiniteModelList). Теперь — единственный источник истины.
 */

/**
 * Проверяет, является ли ошибка сетевой (нет связи / таймаут / сервер недоступен).
 *
 * Обрабатывает:
 *  - Axios: ERR_NETWORK, ECONNABORTED, "Network Error", isAxiosError без response
 *  - Offline interceptor: `data._offline === true`
 */
export function isNetworkError(error: unknown): boolean {
	if (!error) return false;
	// Сетевая ошибка приходит из разных источников (axios, offline-интерцептор),
	// поэтому описываем ровно те поля, по которым её опознаём.
	const e = error as {
		code?: string; message?: string; isAxiosError?: boolean;
		response?: unknown; data?: { _offline?: boolean };
	};
	if (["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT", "ECONNREFUSED"].includes(e.code ?? "")) return true;
	if (e.message === "Network Error") return true;
	if (e.isAxiosError && !e.response) return true;
	// Offline interceptor возвращает _offline: true
	if (e?.data?._offline) return true;
	return false;
}
