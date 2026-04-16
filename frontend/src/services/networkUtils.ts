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
export function isNetworkError(error: any): boolean {
	if (!error) return false;
	if (["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT", "ECONNREFUSED"].includes(error.code)) return true;
	if (error.message === "Network Error") return true;
	if (error.isAxiosError && !error.response) return true;
	// Offline interceptor возвращает _offline: true
	if (error?.data?._offline) return true;
	return false;
}
