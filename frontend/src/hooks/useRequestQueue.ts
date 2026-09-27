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
	execute: () => Promise<unknown>;
	timestamp: number;
	timeout?: ReturnType<typeof setTimeout>;
	/** Callback для отмены (когда компонент размонтирован) */
	cancelled?: boolean;
	/** Сообщить владельцу, что запрос снят из очереди и выполнен НЕ будет. */
	onCancel?: (reason: Error) => void;
}

/**
 * Запрос снят из очереди, не начавшись (размонтирование, «Обновить», отмена react-query).
 * Имя — AbortError: так отмену узнают по `err.name`, как у fetch/axios.
 */
export class RequestCancelledError extends Error {
	constructor(message = "Запрос снят из очереди") {
		super(message);
		this.name = "AbortError";
	}
}

/** Ошибка — это снятие запроса из очереди (а не сбой сервера). */
export function isRequestCancelled(err: unknown): boolean {
	return err instanceof RequestCancelledError;
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

/**
 * Снять ещё не начатый запрос: убрать из очереди и СООБЩИТЬ владельцу (onCancel).
 * Раньше снятый запрос просто не выполнялся — его промис не завершался никогда, и
 * react-query держал список в «загрузке»: повторно открытый список крутился без
 * запроса (аудит 26.09, И9). Уже начатый запрос не трогаем.
 */
function cancelRequest(req: QueuedRequest) {
	if (req.cancelled) return;
	const idx = queue.indexOf(req);
	if (idx === -1) return;
	queue.splice(idx, 1);
	req.cancelled = true;
	req.onCancel?.(new RequestCancelledError());
}

function addRequestGlobal(
	id: string,
	execute: () => Promise<unknown>,
	onCancel?: (reason: Error) => void,
	signal?: AbortSignal,
) {
	const req: QueuedRequest = { id, execute, timestamp: Date.now(), onCancel };
	if (signal?.aborted) {
		onCancel?.(new RequestCancelledError());
		return;
	}
	signal?.addEventListener("abort", () => cancelRequest(req), { once: true });
	queue.push(req);
	processQueue();
}

function cancelGroupGlobal(groupId: string) {
	// Снимаем ожидающие запросы этой группы (владельцу — отказ, см. cancelRequest)
	for (const req of [...queue]) {
		if (req.id.startsWith(groupId + ":")) {
			cancelRequest(req);
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

	/**
	 * Поставить запрос в очередь.
	 * @param onCancel — вызывается, если запрос снят, не начавшись (владелец отклоняет свой промис);
	 * @param signal — отмена извне (react-query при размонтировании / новом запросе).
	 */
	const addRequest = useCallback(
		(id: string, execute: () => Promise<unknown>, onCancel?: (reason: Error) => void, signal?: AbortSignal) => {
			const fullId = `${groupIdRef.current}:${id}`;
			addRequestGlobal(fullId, execute, onCancel, signal);
		},
		[],
	);

	const cancelAll = useCallback(() => {
		cancelGroupGlobal(groupIdRef.current);
	}, []);

	return { addRequest, cancelAll, getQueueSize: () => queue.length };
};
