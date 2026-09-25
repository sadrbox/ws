/**
 * useTodoStatuses — статусы задач из СПРАВОЧНИКА (E9.5), а не хардкод-enum.
 *
 * `code` лежит в `Todo.status`, `name` показывается пользователю, `sortOrder`
 * задаёт порядок колонок доски, `isFinal` помечает завершающие статусы (по нему
 * считается просрочка — раньше это был захардкоженный список done/cancelled),
 * `isWaiting` — статусы ожидания («Ждём клиента», «Ждём контрагента», E17 СК1.2):
 * не финальные и требуют даты следующего контроля.
 *
 * Fallback: если справочник почему-то пуст (не применены сиды), отдаём базовый
 * набор — иначе форма и доска остались бы без статусов вообще.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";

export interface TodoStatusRow {
	uuid: string;
	code: string;
	name: string;
	sortOrder: number;
	isFinal: boolean;
	/** Статус ожидания (E17): без даты следующего контроля сервер его не примет. */
	isWaiting?: boolean;
	/** Отмена (E17): финальный статус, которому результат не нужен. */
	isCancel?: boolean;
}

const FALLBACK: TodoStatusRow[] = [
	{ uuid: "f-new", code: "new", name: "Новая", sortOrder: 10, isFinal: false },
	{ uuid: "f-inprogress", code: "in_progress", name: "В работе", sortOrder: 20, isFinal: false },
	{ uuid: "f-done", code: "done", name: "Выполнена", sortOrder: 30, isFinal: true },
	{ uuid: "f-cancelled", code: "cancelled", name: "Отменена", sortOrder: 40, isFinal: true, isCancel: true },
];

export function useTodoStatuses() {
	const { data, isLoading } = useQuery({
		queryKey: ["todo-statuses"],
		queryFn: async (): Promise<TodoStatusRow[]> => {
			const r = await apiClient.get<{ items?: TodoStatusRow[] }>("todo-statuses");
			return r.data?.items ?? [];
		},
		staleTime: 5 * 60_000,
	});

	const statuses = data && data.length > 0 ? data : FALLBACK;
	// Производные — один раз на набор статусов: доска и форма кладут их в зависимости
	// useMemo/useCallback, и новый Set на каждый рендер пересчитывал бы их впустую.
	return useMemo(() => ({
		statuses,
		/** Варианты для FieldSelect. */
		options: statuses.map((s) => ({ value: s.code, label: s.name })),
		/** Коды завершающих статусов — для расчёта просрочки. */
		finalCodes: new Set(statuses.filter((s) => s.isFinal).map((s) => s.code)),
		/** Коды статусов ожидания — им нужна дата следующего контроля. */
		waitingCodes: new Set(statuses.filter((s) => s.isWaiting).map((s) => s.code)),
		/**
		 * Справочник ещё грузится (первый запрос в пути) — пока показан базовый набор. Доске это
		 * важно: задачи со статусом вне базового набора на миг легли бы в колонку «нет в справочнике».
		 */
		isLoading,
	}), [statuses, isLoading]);
}
