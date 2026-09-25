/**
 * Подпись записи справочника по её uuid — для лукапа, у которого сервер отдал только uuid.
 *
 * Тип ошибки у задачи, исполнитель и группа сотрудников у расписания хранятся ссылками без
 * связей в ответе (E17: модели качества намеренно не обрастают обратными связями), и без подписи
 * поле выглядело бы пустым, хотя значение в нём есть. Не нашлось или отказ — пустая строка:
 * форма всё равно откроется, а uuid останется на месте и уйдёт при записи как был.
 *
 * Отдельным модулем, а не в index.tsx: там только компоненты (Fast Refresh). Им пользуются
 * формы задачи и регламентной задачи.
 */
import { api } from "src/services/api/client";
import { asText } from "src/utils/asText";
import { unwrapItem } from "src/utils/apiUnwrap";

export async function fetchRecordName(
	endpoint: string,
	uuid: string | null | undefined,
	pick: (item: Record<string, unknown>) => unknown = (item) => item.name,
): Promise<string> {
	if (!uuid) return "";
	try {
		const item = unwrapItem<Record<string, unknown> | null>(await api.get(`/${endpoint}/${uuid}`));
		return item ? asText(pick(item)) : "";
	} catch {
		return "";
	}
}

/** Подпись пользователя так же, как в лукапе `users`: ФИО сотрудника, иначе логин. */
export const userDisplayName = (item: Record<string, unknown>): string =>
	asText((item.employee as { fullName?: unknown } | null | undefined)?.fullName) || asText(item.username);
