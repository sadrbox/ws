import { useRef, useCallback } from "react";

interface QueuedRequest {
	id: string;
	execute: () => Promise<any>;
	timestamp: number;
	timeout?: NodeJS.Timeout;
}

const HANGING_REQUEST_TIMEOUT = 30000; // 30 сек

export const useRequestQueue = () => {
	const queueRef = useRef<QueuedRequest[]>([]);
	const activeRequestRef = useRef<QueuedRequest | null>(null);

	const cancelHangingRequest = useCallback(() => {
		if (activeRequestRef.current?.timeout) {
			clearTimeout(activeRequestRef.current.timeout);
		}
		activeRequestRef.current = null;
	}, []);

	const processQueue = useCallback(async () => {
		if (activeRequestRef.current || queueRef.current.length === 0) {
			return;
		}

		const request = queueRef.current.shift();
		if (!request) return;

		activeRequestRef.current = request;

		// Установим таймаут для "зависшего" запроса
		request.timeout = setTimeout(() => {
			console.warn(
				`[RequestQueue] Request ${request.id} is hanging, canceling...`,
			);
			cancelHangingRequest();
			processQueue(); // Переходим к следующему
		}, HANGING_REQUEST_TIMEOUT);

		try {
			await request.execute();
			clearTimeout(request.timeout);
		} catch (error) {
			console.error(`[RequestQueue] Request ${request.id} failed:`, error);
		} finally {
			activeRequestRef.current = null;
			processQueue(); // Переходим к следующему
		}
	}, [cancelHangingRequest]);

	const addRequest = useCallback(
		(id: string, execute: () => Promise<any>) => {
			console.log(`[RequestQueue] Adding request: ${id}`);
			queueRef.current.push({ id, execute, timestamp: Date.now() });
			processQueue();
		},
		[processQueue],
	);

	const cancelAll = useCallback(() => {
		queueRef.current = [];
		cancelHangingRequest();
	}, [cancelHangingRequest]);

	return { addRequest, cancelAll, getQueueSize: () => queueRef.current.length };
};
