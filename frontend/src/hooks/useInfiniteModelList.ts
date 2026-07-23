import type { SyncRecord } from "src/services/offlineDb";
import {
	useInfiniteQuery,
	type UseInfiniteQueryOptions,
	type UseInfiniteQueryResult,
	type InfiniteData,
} from "@tanstack/react-query";
import { useRef, useMemo, useCallback, useEffect } from "react";
import apiClient from "src/services/api/client";
import { useRequestQueue } from "./useRequestQueue";
import { fetchList, isSyncableEndpoint } from "src/services/offlineDataService";
import { getIsOnline } from "src/services/networkStatus";
import { isNetworkError as isNetworkLikeError } from "src/services/networkUtils";
import { isOfflineFirst } from "src/services/persistenceMode";

// ⚠️ ГЛОБАЛЬНЫЙ REF для хранения adaptiveLimit
export const GLOBAL_ADAPTIVE_LIMIT_REF = { current: 200 };

// ⚠️ ГЛОБАЛЬНЫЙ REF для прыжка скролла — если задан, следующий запрос начнёт с этого курсора
export const GLOBAL_JUMP_CURSOR_REF = { current: null as number | null };

export interface InfiniteModelPage<T> {
	items: T[];
	nextCursor: number | null;
	hasMore: boolean;
	total?: number;
}

export interface InfiniteModelParams {
	limit?: number;
	sort?: Record<string, "desc" | "asc"> | null;
	search?: string;
	filter?: Record<string, { value: unknown; operator: string }>;
	extra?: Record<string, any>;
}

type InfiniteQueryKey = readonly [
	string,
	"infinite",
	{
		sort?: Record<string, "asc" | "desc"> | null;
		search?: string;
		filter?: Record<string, { value: unknown; operator: string }> | undefined;
		extra?: Record<string, any>;
	},
];

interface UseInfiniteModelListOptions<TData> {
	model: string;
	params?: InfiniteModelParams;
	queryOptions?: Omit<
		UseInfiniteQueryOptions<
			InfiniteModelPage<TData>,
			Error,
			InfiniteData<InfiniteModelPage<TData>>,
			InfiniteQueryKey,
			number | null
		>,
		"queryKey" | "queryFn" | "getNextPageParam" | "initialPageParam"
	> & {
		onError?: (err: Error) => void;
	};
}

export type UseInfiniteModelListResult<TData> = UseInfiniteQueryResult<
	InfiniteData<InfiniteModelPage<TData>>,
	Error
> & {
	allItems: TData[];
	total: number;
	isAnythingLoading: boolean;
	cancelAllRequests: () => void;
};

export function useInfiniteModelList<TData = unknown>({
	model,
	params = {},
	queryOptions = {},
}: UseInfiniteModelListOptions<TData>): UseInfiniteModelListResult<TData> {
	const { onError, ...restQueryOptions } =
		queryOptions as typeof queryOptions & {
			onError?: (err: Error) => void;
		};

	// ⚠️ КРИТИЧНО: Храним в ref ВСЕ параметры
	const paramsRef = useRef(params);
	paramsRef.current = params;

	// ⚠️ КРИТИЧНО: Мемоизируем search/filter/sort для queryKey
	// sort теперь отправляется на сервер — смена сортировки вызывает новый запрос
	const memoizedQueryParams = useMemo(
		() => ({
			sort: params.sort,
			search: params.search,
			filter: params.filter,
			extra: params.extra,
		}),
		[
			JSON.stringify(params.sort),
			params.search,
			JSON.stringify(params.filter),
			JSON.stringify(params.extra),
		],
	);

	const queryKey: InfiniteQueryKey = [model, "infinite", memoizedQueryParams];

	const { addRequest, cancelAll } = useRequestQueue();

	const wrappedQueryFn = useCallback(
		async ({ pageParam }: { pageParam: number | null }) => {
			const query: Record<string, any> = {};

			if (pageParam !== null && pageParam !== undefined) {
				query.cursor = pageParam;
			}

			// Читаем свежий limit из глобального ref
			const limit = GLOBAL_ADAPTIVE_LIMIT_REF.current ?? 200;
			query.limit = limit;

			// Остальные параметры из paramsRef
			const currentParams = paramsRef.current;

			if (currentParams.search) {
				query.search = currentParams.search;
			}

			// ⚠️ Отправляем sort на сервер как JSON-строку: { "field": "asc"|"desc" }
			if (currentParams.sort && Object.keys(currentParams.sort).length > 0) {
				query.sort = JSON.stringify(currentParams.sort);
			}

			// ⚠️ НЕ отправляем sort на сервер - только локальная сортировка на клиенте
			// if (currentParams.sort && Object.keys(currentParams.sort).length > 0) {
			// 	const sortParts: string[] = [];
			// 	for (const [field, dir] of Object.entries(currentParams.sort)) {
			// 		sortParts.push(dir === "desc" ? `-${field}` : field);
			// 	}
			// 	query.sort = sortParts.join(",");
			// }

			if (currentParams.filter) {
				for (const [field, cond] of Object.entries(currentParams.filter)) {
					if (cond !== null && typeof cond === "object" && "value" in cond) {
						query[`filter[${field}][${cond.operator}]`] = cond.value;
					} else if (cond !== null && typeof cond === "object") {
						// Объекты без { value, operator } (например dateRange:
						// { startDate, endDate }) разворачиваем в подключи —
						// бэкенд читает filter[dateRange][startDate].
						for (const [subKey, subVal] of Object.entries(cond)) {
							if (subVal !== undefined && subVal !== null && subVal !== "") {
								query[`filter[${field}][${subKey}]`] = subVal;
							}
						}
					} else {
						query[`filter[${field}]`] = cond;
					}
				}
			}

			if (currentParams.extra) {
				for (const [key, value] of Object.entries(currentParams.extra)) {
					if (key !== "limit") {
						query[key] = value;
					}
				}
			}

			return new Promise<InfiniteModelPage<TData>>((resolve, reject) => {
				addRequest(`${model}-page-${pageParam}`, async () => {
					// ══════════════════════════════════════════════════════════
					// TRANSACTIONAL MODE — только сервер, без кэша
					// ══════════════════════════════════════════════════════════
					if (!isOfflineFirst()) {
						try {
							const response = await apiClient.get<InfiniteModelPage<TData>>(
								model,
								{ params: query },
							);
							resolve(response.data);
						} catch (err) {
							if (err instanceof Error && err.name === "CanceledError") {
								reject(new Error("Request was cancelled"));
							}
							onError?.(err as Error);
							reject(err instanceof Error ? err : new Error(String(err)));
						}
						return;
					}

					// ══════════════════════════════════════════════════════════
					// OFFLINE-FIRST MODE — сервер с fallback на Dexie
					// ══════════════════════════════════════════════════════════

					// При offline и syncable → читаем из Dexie напрямую
					if (!getIsOnline() && isSyncableEndpoint(model)) {
						try {
							const result = await fetchList<TData>(
								model,
								{
									limit: query.limit,
									cursor: pageParam,
									sort: currentParams.sort,
									search: currentParams.search,
								},
								query,
							);
							resolve({
								items: result.items,
								nextCursor: result.nextCursor,
								hasMore: result.hasMore,
								total: result.total,
							});
							return;
						} catch (offlineErr) {
							console.warn(
								`[InfiniteList] Offline fallback failed for ${model}:`,
								offlineErr,
							);
						}
					}

					try {
						const response = await apiClient.get<InfiniteModelPage<TData>>(
							model,
							{ params: query },
						);

						// Кэшируем данные в Dexie для будущего offline-доступа
						if (isSyncableEndpoint(model) && response.data?.items?.length > 0) {
							void import("src/services/offlineDb").then(({ upsertRecords }) =>
								upsertRecords(model, response.data.items as any[]).catch(
									() => {},
								),
							);
						}

						resolve(response.data);
					} catch (err) {
						// Если сеть упала во время запроса → fallback на Dexie (без повторного сетевого запроса)
						if (isSyncableEndpoint(model) && isNetworkLikeError(err)) {
							try {
								const { getActiveRecords, countActiveRecords, searchRecords } =
									await import("src/services/offlineDb");

								let sortField = "id";
								let sortDir: "asc" | "desc" = "desc";
								if (currentParams.sort) {
									const entries = Object.entries(currentParams.sort);
									if (entries.length > 0) [sortField, sortDir] = entries[0];
								}

								let items: SyncRecord[];
								let total: number;
								const limit = query.limit ?? 200;
								const offset = pageParam ?? 0;

								if (currentParams.search) {
									items = await searchRecords(model, currentParams.search);
									total = items.length;
								items.sort((a: SyncRecord, b: SyncRecord) => {
									const va = a[sortField],
										vb = b[sortField];
									if (va == null && vb == null) return 0;
									if (va == null) return 1;
									if (vb == null) return -1;
									if (typeof va === "string" && typeof vb === "string") {
										const comparison = va.localeCompare(vb, undefined, {
											numeric: true,
											sensitivity: "base",
										});
										return sortDir === "desc" ? -comparison : comparison;
									}
									return sortDir === "desc"
											? vb > va
												? 1
												: -1
											: va > vb
												? 1
												: -1;
									});
									items = items.slice(offset, offset + limit);
								} else {
									total = await countActiveRecords(model);
									items = await getActiveRecords(model, {
										limit,
										offset,
										sortField,
										sortDir,
									});
								}

								const hasMore = offset + items.length < total;
								resolve({
									items: items as TData[],
									nextCursor: hasMore ? offset + items.length : null,
									hasMore,
									total,
								});
								return;
							} catch {
								// Fallback тоже не сработал
							}
						}

						if (err instanceof Error && err.name === "CanceledError") {
							reject(new Error("Request was cancelled"));
						}
						onError?.(err as Error);
						reject(err instanceof Error ? err : new Error(String(err)));
					}
				});
			});
		},
		[model, onError, addRequest],
	);

	const result = useInfiniteQuery<
		InfiniteModelPage<TData>,
		Error,
		InfiniteData<InfiniteModelPage<TData>>,
		InfiniteQueryKey,
		number | null
	>({
		queryKey,
		initialPageParam: null,
		getNextPageParam: (lastPage) => {
			// Если задан jump cursor — используем его и сбрасываем
			if (GLOBAL_JUMP_CURSOR_REF.current !== null) {
				const jumpCursor = GLOBAL_JUMP_CURSOR_REF.current;
				GLOBAL_JUMP_CURSOR_REF.current = null;
				return jumpCursor;
			}
			if (!lastPage.hasMore || lastPage.nextCursor === null) return undefined;
			return lastPage.nextCursor;
		},
		queryFn: wrappedQueryFn,
		staleTime: 2 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		retry: (failureCount, error: unknown) => {
			// Не ретраить при сетевых ошибках
			const e = error as { code?: string; message?: string };
			if (e?.code === "ERR_NETWORK" || e?.message === "Network Error")
				return false;
			return failureCount < 1;
		},
		refetchOnWindowFocus: false,
		placeholderData: (previousData) => previousData,
		...restQueryOptions,
	});

	const allItems: TData[] = useMemo(() => {
		const flat = result.data?.pages.flatMap((p) => p.items) ?? [];
		const seen = new Set<unknown>();
		return flat.filter((item) => {
			const id = (item as any)?.id;
			if (id === undefined || id === null) return true;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
	}, [result.data]);

	const total = result.data?.pages[0]?.total ?? allItems.length;

	const isAnythingLoading =
		result.isLoading || result.isFetching || result.isFetchingNextPage;

	// Таймстамп последнего обновления данных — можно использовать как триггер
	// для сброса кэшей, не зависящий от ссылочного равенства allItems
	const dataUpdatedAt = result.dataUpdatedAt;

	// Отменяем очередь при unmount
	useEffect(() => {
		return () => cancelAll();
	}, [cancelAll]);

	return {
		...result,
		allItems,
		total,
		isAnythingLoading,
		cancelAllRequests: cancelAll,
		dataUpdatedAt,
	};
}
