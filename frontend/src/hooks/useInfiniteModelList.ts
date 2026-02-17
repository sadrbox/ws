import {
	useInfiniteQuery,
	type UseInfiniteQueryOptions,
	type UseInfiniteQueryResult,
	type InfiniteData,
} from "@tanstack/react-query";
import { useRef, useMemo, useCallback, useEffect } from "react";
import apiClient from "src/app/services/api/client";
import { useRequestQueue } from "./useRequestQueue";

// ⚠️ ГЛОБАЛЬНЫЙ REF для хранения adaptiveLimit
export const GLOBAL_ADAPTIVE_LIMIT_REF = { current: 200 };

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
		search?: string;
		filter?: Record<string, { value: unknown; operator: string }> | undefined;
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

	// ⚠️ КРИТИЧНО: Мемоизируем ТОЛЬКО search/filter для queryKey БЕЗ sort и limit
	// sort обрабатывается ТОЛЬКО на клиенте, не отправляется на сервер
	const memoizedQueryParams = useMemo(
		() => ({
			search: params.search,
			filter: params.filter,
		}),
		[params.search, JSON.stringify(params.filter)],
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
						reject(err);
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
			if (!lastPage.hasMore || lastPage.nextCursor === null) return undefined;
			return lastPage.nextCursor;
		},
		queryFn: wrappedQueryFn,
		staleTime: 2 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		retry: 1,
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

	// Отменяем очередь при unmount
	useEffect(() => {
		return () => cancelAll();
	}, [cancelAll]);

	return { ...result, allItems, total, isAnythingLoading };
}
