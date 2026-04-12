import { useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// ГЛОБАЛЬНАЯ ОЧЕРЕДЬ ЗАПРОСОВ (singleton)
// ═══════════════════════════════════════════════════════════════════════════
// Все экземпляры useInfiniteModelList используют ОДНУ очередь.
// Это предотвращает burst-нагрузку, когда несколько SubTable / списков
// одновременно отправляют запросы и исчерпывают rate-limit бэкенда.
// ═══════════════════════════════════════════════════════════════════════════

interface QueuedRequest {
	id: string;
	execute: () => Promise<any>;
	timestamp: number;
	timeout?: ReturnType<typeof setTimeout>;
	/** Callback для отмены (когда компонент размонтирован) */
	cancelled?: boolean;
}

/** Максимум параллельных запросов */
const MAX_CONCURRENT = 6;
/** Таймаут для "зависшего" запроса */
const HANGING_REQUEST_TIMEOUT = 30_000; // 30 сек

// ─── Глобальное состояние (НЕ внутри хука) ───
const queue: QueuedRequest[] = [];
let activeCount = 0;

function processQueue() {
	while (activeCount < MAX_CONCURRENT && queue.length > 0) {
		const request = queue.shift();
		if (!request) break;

		// Если запрос отменён до начала выполнения — пропускаем
		if (request.cancelled) continue;

		activeCount++;

		const timeout = setTimeout(() => {
			// Принудительно освобождаем слот для "зависшего" запроса
			activeCount = Math.max(0, activeCount - 1);
			processQueue();
		}, HANGING_REQUEST_TIMEOUT);

		request.timeout = timeout;

		request
			.execute()
			.catch((err) => {
				// Ошибка уже обрабатывается в execute — тут только лог
				if (!(err instanceof Error && err.name === "CanceledError")) {
					console.error(`[RequestQueue] ${request.id} failed:`, err);
				}
			})
			.finally(() => {
				clearTimeout(timeout);
				activeCount = Math.max(0, activeCount - 1);
				processQueue();
			});
	}
}

function addRequestGlobal(id: string, execute: () => Promise<any>) {
	const req: QueuedRequest = { id, execute, timestamp: Date.now() };
	queue.push(req);
	processQueue();
}

function cancelGroupGlobal(groupId: string) {
	// Помечаем ожидающие запросы этой группы как отменённые
	for (const req of queue) {
		if (req.id.startsWith(groupId + ":")) {
			req.cancelled = true;
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// ХУКИ для компонентов
// ═══════════════════════════════════════════════════════════════════════════

let instanceCounter = 0;

/**
 * Хук-обёртка над глобальной очередью.
 * Каждый экземпляр получает уникальный groupId для возможности
 * отмены "своих" запросов при unmount.
 */
export const useRequestQueue = () => {
	const groupIdRef = useRef(`rq-${++instanceCounter}`);

	const addRequest = useCallback(
		(id: string, execute: () => Promise<any>) => {
			const fullId = `${groupIdRef.current}:${id}`;
			addRequestGlobal(fullId, execute);
		},
		[],
	);

	const cancelAll = useCallback(() => {
		cancelGroupGlobal(groupIdRef.current);
	}, []);

	return { addRequest, cancelAll, getQueueSize: () => queue.length };
};
