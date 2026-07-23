/**
 * useTodoStatuses — статусы задач из СПРАВОЧНИКА (E9.5), а не хардкод-enum.
 *
 * `code` лежит в `Todo.status`, `name` показывается пользователю, `sortOrder`
 * задаёт порядок колонок доски, `isFinal` помечает завершающие статусы (по нему
 * считается просрочка — раньше это был захардкоженный список done/cancelled).
 *
 * Fallback: если справочник почему-то пуст (не применены сиды), отдаём базовый
 * набор — иначе форма и доска остались бы без статусов вообще.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";

export interface TodoStatusRow {
	uuid: string;
	code: string;
	name: string;
	sortOrder: number;
	isFinal: boolean;
}

const FALLBACK: TodoStatusRow[] = [
	{ uuid: "f-new", code: "new", name: "Новая", sortOrder: 10, isFinal: false },
	{ uuid: "f-inprogress", code: "in_progress", name: "В работе", sortOrder: 20, isFinal: false },
	{ uuid: "f-done", code: "done", name: "Выполнена", sortOrder: 30, isFinal: true },
	{ uuid: "f-cancelled", code: "cancelled", name: "Отменена", sortOrder: 40, isFinal: true },
];

export function useTodoStatuses() {
	const { data } = useQuery({
		queryKey: ["todo-statuses"],
		queryFn: async (): Promise<TodoStatusRow[]> => {
			const r = await apiClient.get<{ items?: TodoStatusRow[] }>("todo-statuses");
			return r.data?.items ?? [];
		},
		staleTime: 5 * 60_000,
	});

	const statuses = data && data.length > 0 ? data : FALLBACK;
	return {
		statuses,
		/** Варианты для FieldSelect. */
		options: statuses.map((s) => ({ value: s.code, label: s.name })),
		/** Коды завершающих статусов — для расчёта просрочки. */
		finalCodes: new Set(statuses.filter((s) => s.isFinal).map((s) => s.code)),
	};
}
