import { useMemo, useEffect, useState } from "react";
import {
	TColumn,
	TDataItem,
	TypeModelProps,
	TypeTableParams,
} from "../components/Table/types";
import { useQueryParams } from "./useQueryParams";
import { useFetchData } from "./useFetchData";
import { getModelColumns, sortTableRows } from "../components/Table/services";

// Универсальный хук для работы с таблицей
export const useTable = <
	TDataItem extends import("../components/Table/types").TDataItem
>(
	componentName: string,
	model: string,
	columnsJson: any,
	initProps?: Partial<TypeTableParams>
) => {
	const [columns, setColumns] = useState<TColumn[]>(() =>
		getModelColumns(columnsJson, componentName)
	);
	const [queryParams, setQueryParams] = useQueryParams({
		model,
		...initProps,
	});

	const { data, isLoading, isFetching, error, refetch } =
		useFetchData<TDataItem>(queryParams);

	// Логирование ошибок
	useEffect(() => {
		if (error) {
			console.error(`React Query Error fetching ${model}:`, error);
		}
	}, [error, model]);

	// Мемоизированные данные
	const rows = useMemo(() => {
		return data?.items ? sortTableRows(data.items, queryParams.sort) : [];
	}, [data?.items, queryParams.sort]);

	const totalPages = data?.totalPages || 0;

	// Пропсы для таблицы
	const tableProps = useMemo<Omit<TypeModelProps, "states">>(
		() => ({
			componentName,
			rows,
			columns,
			totalPages,
			isLoading,
			isFetching,
			query: {
				queryParams,
				setQueryParams,
			},
			actions: { refetch, setColumns },
			error,
		}),
		[
			rows,
			columns,
			totalPages,
			queryParams,
			setQueryParams,
			refetch,
			isLoading,
			isFetching,
			error,
			componentName,
		]
	);

	return {
		tableProps,
		columns,
		setColumns,
		queryParams,
		setQueryParams,
		data,
		isLoading,
		isFetching,
		error,
		refetch,
	};
};
