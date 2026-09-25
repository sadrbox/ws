/**
 * «Добавить» и «Удалить» для списков E17 — своими кнопками, а не кнопками таблицы.
 *
 * ПОЧЕМУ НЕ ВСТРОЕННЫЕ. Кнопки записи в таблице ModelList включает право на модель
 * (useAccessPermission по ENDPOINT_TO_MODEL). У справочников качества таких прав нет: роль
 * в качестве задают группы сотрудников (главбух, руководитель), а не профиль доступа. Без
 * обхода «Добавить» видел бы только суперадминистратор, а главбух — никогда. Поэтому список
 * прячет встроенные кнопки (hideAddDelete) и показывает эти — по контексту useQualityMe.
 * Сервер всё равно проверяет каждое действие: здесь только то, что показывать.
 *
 * Открытие новой формы повторяет ModelList.openModelForm: уникальный _paneToken, чтобы
 * повторное «Добавить» открывало новую панель, а не активировало уже открытую.
 */
import { useCallback, useMemo, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import { translate } from "src/i18";
import { useModelDelete } from "src/hooks/useModelDelete";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";
import type { TDataItem } from "src/components/Table/types";

export function useQualityListActions(endpoint: string, listName: string, FormComponent: ComponentType<Record<string, unknown>>) {
	const { addPane } = useAppContext().windows;
	const queryClient = useQueryClient();

	/** Перечитать список (и все запросы этого раздела): ключ ModelList начинается с endpoint. */
	const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: [endpoint] }), [queryClient, endpoint]);

	const handleDelete = useModelDelete(endpoint, refresh);

	const openNew = useCallback((data: Record<string, unknown> = {}) => {
		addPane({
			label: makePaneLabelFromData(listName, translate(listName)),
			component: FormComponent,
			data: {
				...data,
				_paneToken: `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
			} as unknown as TDataItem,
			onSave: async () => { await refresh(); },
			onClose: async () => { await refresh(); },
		});
	}, [addPane, listName, FormComponent, refresh]);

	/** Удалить отмеченные строки: подтверждение, запрос, закрытие открытых форм — useModelDelete. */
	const deleteRows = useCallback(async (rows: TDataItem[]) => {
		if (!rows.length) return;
		await handleDelete(new Set(rows.map((r) => Number(r.id))), rows);
	}, [handleDelete]);

	return useMemo(() => ({ openNew, deleteRows, refresh }), [openNew, deleteRows, refresh]);
}
