import { useMemo, useEffect, useState, ReactNode } from "react";
import {
	TColumn,
	TDataItem,
	TypeModelProps,
	TOpenForm,
	TypeTableParams,
	TypeTableTypes,
} from "../components/Table/types";
import { useQueryParams } from "./useQueryParams";
import { useFetchData } from "./useFetchData";
import { getModelColumns, sortTableRows } from "../components/Table/services";

type TypeUseTableReturn = {
	componentName: string; // mostly for logging/debugging
	model: string; // entity name: 'users', 'products', etc.
	columnsJson: any; // usually ColumnDef<TData>[] from @tanstack/react-table
	openForm?: TOpenForm;
	initProps?: Partial<TypeTableParams>;
	type?: TypeTableTypes;
};

// Универсальный хук для работы с таблицей
export const useTable = ({
	componentName,
	model,
	columnsJson,
	openForm,
	initProps,
	type,
}: TypeUseTableReturn) => {
	const [columns, setColumns] = useState<TColumn[]>(() =>
		getModelColumns(columnsJson, componentName, type),
	);
	const [queryParams, setQueryParams] = useQueryParams({
		model,
		...initProps,
	});

	const { data, isLoading, isFetching, error, refetch } =
		useFetchData<TDataItem>(queryParams);

	// Логирование ошибок
	useEffect(() => {
		// if (!!rows) console.log(rows);
		if (error) {
			console.error(`React Query Error fetching ${model}:`, error);
		}
	}, [error, model]);

	// Мемоизированные данные
	const rows = useMemo(() => {
		// console.log(data?.items);
		return data?.items ? sortTableRows(data.items, queryParams.sort) : [];
	}, [data?.items, queryParams.sort]);

	const totalPages = data?.totalPages || 0;

	// Пропсы для таблицы
	const tableProps = useMemo<Omit<TypeModelProps, "states">>(
		() => ({
			type,
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
			actions: { openForm, refetch, setColumns },
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
		],
	);

	return {
		tableProps, // только пропсы таблицы используются снаружи
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
