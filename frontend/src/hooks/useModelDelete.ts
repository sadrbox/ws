import { useCallback } from "react";
import apiClient from "src/services/api/client";
import type { TDataItem } from "src/components/Table/types";
import { useAppContext } from "src/app";

/**
 * Хук для удаления записей модели по выбранным строкам таблицы.
 * Использует глобальный ConfirmModal из AppContext вместо window.confirm.
 * @param model — endpoint модели (например "organizations")
 * @param refetch — функция обновления списка после удаления
 */
export function useModelDelete(
	model: string,
	refetch: () => void | Promise<unknown>,
) {
	const {
		actions: { confirm },
	} = useAppContext();

	const handleDelete = useCallback(
		async (selectedRowIds: Set<number>, tableRows: TDataItem[]) => {
			const items = tableRows.filter((r) => selectedRowIds.has(Number(r.id)));
			if (items.length === 0) return;

			const message =
				items.length === 1
					? `Удалить запись #${items[0].id}?`
					: `Удалить записи (${items.length} шт.)?`;

			const confirmed = await confirm(message);
			if (!confirmed) return;

			const errors: string[] = [];
			for (const item of items) {
				try {
					await apiClient.delete(`/${model}/${item.uuid || item.id}`);
				} catch (err: any) {
					const msg =
						err.response?.data?.message || `Ошибка удаления #${item.id}`;
					errors.push(msg);
				}
			}

			if (errors.length > 0) {
				alert(`Ошибки при удалении:\n${errors.join("\n")}`);
			}

			void refetch();
		},
		[model, refetch, confirm],
	);

	return handleDelete;
}
