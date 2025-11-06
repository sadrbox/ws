import { useState } from "react";
import { TypeTableParams } from "../components/Table/types";
import { DEFAULT_TABLE_PARAMS } from "../app/configs/table";

// Универсальный хук для управления параметрами таблицы
export const useQueryParams = (initProps?: Partial<TypeTableParams>) => {
	const [params, setParams] = useState<TypeTableParams>(() => {
		const mergedParams = {
			...DEFAULT_TABLE_PARAMS,
			...(initProps as Partial<TypeTableParams>),
			filter: {
				...DEFAULT_TABLE_PARAMS.filter,
				...(initProps?.filter ?? {}),
			},
			selectedIds:
				initProps?.selectedIds instanceof Set
					? initProps.selectedIds
					: DEFAULT_TABLE_PARAMS.selectedIds,
		};

		return mergedParams as TypeTableParams;
	});

	const setQueryParams = (newParams: Partial<TypeTableParams>) => {
		setParams((prev) => {
			const updatedParams = { ...prev };

			// Специальное слияние для filter
			if (newParams.filter !== undefined) {
				updatedParams.filter = { ...prev.filter, ...newParams.filter };
			}

			// Специальное слияние для selectedIds
			if (newParams.selectedIds !== undefined) {
				if (newParams.selectedIds instanceof Set) {
					updatedParams.selectedIds = newParams.selectedIds;
				} else {
					console.warn(
						"setQueryParams called with non-Set for selectedIds",
						newParams.selectedIds
					);
				}
			}

			return {
				...updatedParams,
				...newParams,
				filter: updatedParams.filter,
				selectedIds: updatedParams.selectedIds,
			};
		});
	};

	return [params, setQueryParams] as const;
};
