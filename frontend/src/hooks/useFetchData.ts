import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { API_BASE_URL } from "../utils/main.module";
import { TypeTableParams } from "../components/Table/types";
import { FetchDataResult } from "../components/Table/types";

// Универсальная функция для загрузки данных
export const fetchData = async <TDataItem>(
	queryParams: TypeTableParams,
): Promise<FetchDataResult<TDataItem> | null> => {
	if (!queryParams?.model) return null;

	const controller = new AbortController();
	const signal = controller.signal;

	const params = new URLSearchParams({
		page: queryParams.page?.toString() ?? "1",
		limit: queryParams.limit?.toString() ?? "100",
	});

	if (queryParams.sort) {
		params.append("sort", JSON.stringify(queryParams.sort));
	}
	if (queryParams.filter) {
		params.append("filter", JSON.stringify(queryParams.filter));
	}
	if (queryParams.selectedIds && queryParams.selectedIds.size > 0) {
		params.append(
			"selectedIds",
			JSON.stringify(Array.from(queryParams.selectedIds)),
		);
	}

	const url = `${API_BASE_URL}/${queryParams.model}?${params.toString()}`;
	try {
		const response = await fetch(url, { signal });
		if (!response.ok) {
			let errorDetails = response.statusText;
			try {
				const errorJson = await response.json();
				if (errorJson.message) errorDetails = errorJson.message;
				else if (errorJson.error) errorDetails = errorJson.error;
			} catch (e) {
				/* ignore json parse error */
			}

			throw new Error(`Ошибка ${response.status}: ${errorDetails}`);
		}
		return await response.json();
	} catch (error) {
		if (error instanceof Error && error.name !== "AbortError") {
			console.error("Ошибка загрузки данных:", error);
		}
		throw error;
	}
};

// Универсальный хук для загрузки данных таблицы
export const useFetchData = <TDataItem>(
	queryParams: TypeTableParams,
	options?: Omit<
		UseQueryOptions<FetchDataResult<TDataItem> | null, Error>,
		"queryKey" | "queryFn"
	>,
) => {
	return useQuery({
		queryKey: [queryParams.model, queryParams],
		queryFn: () => fetchData<TDataItem>(queryParams),
		retry: 2,
		...options,
	});
};
