import {
	useQuery,
	type UseQueryOptions,
	type UseQueryResult,
} from "@tanstack/react-query";
import apiClient from "src/app/services/api/client";

export interface ModelListResponse<T> {
	items: T[];
	total: number;
	totalPages?: number;
	page?: number;
	limit?: number;
	nextCursor?: number | null;
	hasMore?: boolean;
	[key: string]: any;
}

export interface ModelListParams {
	page?: number;
	limit?: number;
	sort?: Record<string, "desc" | "asc"> | null;
	search?: string;
	filter?: Record<string, { value: unknown; operator: string }>;
	cursor?: number | null;
	extra?: Record<string, any>;
	[key: string]: any;
}

interface UseModelListOptions<TData> {
	model: string;
	params?: ModelListParams;
	queryOptions?: Omit<
		UseQueryOptions<ModelListResponse<TData>, Error>,
		"queryKey" | "queryFn"
	> & {
		onError?: (err: Error) => void;
	};
}

export function useModelList<TData = unknown>({
	model,
	params = {},
	queryOptions = {},
}: UseModelListOptions<TData>): UseQueryResult<
	ModelListResponse<TData>,
	Error
> {
	const { onError, ...restQueryOptions } =
		queryOptions as typeof queryOptions & {
			onError?: (err: Error) => void;
		};

	const queryKey = [model, "list", params] as const;

	return useQuery<ModelListResponse<TData>, Error>({
		queryKey,
		queryFn: async () => {
			const query: Record<string, any> = {};

			if (params.cursor !== undefined && params.cursor !== null) {
				query.cursor = params.cursor;
			}
			if (params.limit !== undefined) {
				query.limit = params.limit;
			}
			if (params.search) {
				query.search = params.search;
			}
			if (params.sort && Object.keys(params.sort).length > 0) {
				const sortParts: string[] = [];
				for (const [field, dir] of Object.entries(params.sort)) {
					sortParts.push(dir === "desc" ? `-${field}` : field);
				}
				query.sort = sortParts.join(",");
			}
			// ИСПРАВЛЕНО: query[`filter[...]`] — квадратная скобка перед backtick обязательна
			if (params.filter) {
				for (const [field, cond] of Object.entries(params.filter)) {
					if (typeof cond === "object" && cond !== null && "value" in cond) {
						query[`filter[${field}][${cond.operator}]`] = cond.value;
					} else {
						query[`filter[${field}]`] = cond;
					}
				}
			}
			if (params.extra) {
				Object.assign(query, params.extra);
			}

			try {
				const response = await apiClient.get<ModelListResponse<TData>>(model, {
					params: query,
				});
				return response.data;
			} catch (err) {
				onError?.(err as Error);
				throw err;
			}
		},
		staleTime: 2 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		retry: 1,
		refetchOnWindowFocus: false,
		...restQueryOptions,
	});
}
