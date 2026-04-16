/**
 * persistencePipe.ts — единый pipe для всех операций с данными (CRUD + list).
 *
 * Проксирует вызовы в зависимости от текущего режима (`persistenceMode`):
 *
 *   ┌─────────────┐        ┌──────────────────────┐
 *   │  useFormStore│──┐     │  offline-first        │
 *   │  useInfinite │──┤────►│  (offlineDataService) │  ← read: server → Dexie fallback
 *   │  ModelList   │  │     │                        │  ← write: Dexie + server / queue
 *   └─────────────┘  │     └──────────────────────┘
 *                     │     ┌──────────────────────┐
 *                     └────►│  transactional         │  ← read: только сервер
 *                           │  (apiClient напрямую)  │  ← write: только сервер
 *                           └──────────────────────┘
 *
 * Формы и списки вызывают ТОЛЬКО pipe-функции.
 * Режим можно переключить на лету через `persistenceMode.setMode()`.
 */

import apiClient from "src/services/api/client";
import { isNetworkError } from "./networkUtils";
import { getMode, isOfflineFirst } from "./persistenceMode";
import {
	fetchList as offlineFetchList,
	fetchOne as offlineFetchOne,
	createRecord as offlineCreateRecord,
	updateRecord as offlineUpdateRecord,
	deleteRecord as offlineDeleteRecord,
	isSyncableEndpoint,
	type OfflineListParams,
	type OfflineListResult,
} from "./offlineDataService";
import type { SyncRecord } from "./offlineDb";

// ═══════════════════════════════════════════════════════════════════════════
// READ — список
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Получить список записей через текущий pipe.
 *
 * offline-first: делегирует в offlineDataService (server → Dexie fallback).
 * transactional: только apiClient, при ошибке сети — throw.
 */
export async function pipeList<T = SyncRecord>(
	endpoint: string,
	params?: OfflineListParams,
	apiParams?: Record<string, any>,
): Promise<OfflineListResult<T>> {
	if (isOfflineFirst()) {
		return offlineFetchList<T>(endpoint, params, apiParams);
	}

	// ── Transactional: сервер-only ──
	const response = await apiClient.get(`/${endpoint.replace(/^\/+/, "")}`, {
		params: apiParams,
	});
	const data = response.data;
	return {
		items: data.items ?? [],
		nextCursor: data.nextCursor ?? null,
		hasMore: data.hasMore ?? false,
		total: data.total ?? data.items?.length ?? 0,
		fromCache: false,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// READ — одна запись
// ═══════════════════════════════════════════════════════════════════════════

export interface PipeFetchOneResult<T> {
	item: T;
	fromCache: boolean;
}

/**
 * Получить одну запись по uuid через текущий pipe.
 */
export async function pipeFetchOne<T = SyncRecord>(
	endpoint: string,
	uuid: string,
): Promise<PipeFetchOneResult<T> | null> {
	if (isOfflineFirst()) {
		return offlineFetchOne<T>(endpoint, uuid);
	}

	// ── Transactional ──
	const ep = endpoint.replace(/^\/+/, "");
	const response = await apiClient.get(`/${ep}/${uuid}`);
	const item = response.data?.item ?? response.data;
	return { item: item as T, fromCache: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE — создание
// ═══════════════════════════════════════════════════════════════════════════

export interface PipeWriteResult<T> {
	item: T;
	offline: boolean;
}

/**
 * Создать запись через текущий pipe.
 */
export async function pipeCreate<T = SyncRecord>(
	endpoint: string,
	data: Record<string, unknown>,
): Promise<PipeWriteResult<T>> {
	if (isOfflineFirst()) {
		return offlineCreateRecord<T>(endpoint, data);
	}

	// ── Transactional ──
	const ep = endpoint.replace(/^\/+/, "");
	const response = await apiClient.post(`/${ep}`, data);
	const item = response.data?.item ?? response.data;
	return { item: item as T, offline: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE — обновление
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Обновить запись через текущий pipe.
 */
export async function pipeUpdate<T = SyncRecord>(
	endpoint: string,
	uuid: string,
	data: Record<string, unknown>,
): Promise<PipeWriteResult<T>> {
	if (isOfflineFirst()) {
		return offlineUpdateRecord<T>(endpoint, uuid, data);
	}

	// ── Transactional ──
	const ep = endpoint.replace(/^\/+/, "");
	const response = await apiClient.put(`/${ep}/${uuid}`, data);
	const item = response.data?.item ?? response.data;
	return { item: item as T, offline: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE — удаление
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Удалить запись через текущий pipe.
 */
export async function pipeDelete(
	endpoint: string,
	uuid: string,
): Promise<{ offline: boolean }> {
	if (isOfflineFirst()) {
		return offlineDeleteRecord(endpoint, uuid);
	}

	// ── Transactional ──
	const ep = endpoint.replace(/^\/+/, "");
	await apiClient.delete(`/${ep}/${uuid}`);
	return { offline: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Текущий режим (для логов / UI) */
export { getMode, isOfflineFirst, isSyncableEndpoint, isNetworkError };

export default {
	list: pipeList,
	fetchOne: pipeFetchOne,
	create: pipeCreate,
	update: pipeUpdate,
	delete: pipeDelete,
	getMode,
	isOfflineFirst,
};
