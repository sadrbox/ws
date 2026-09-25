/**
 * Имя сотрудника из элемента справочника пользователей — так же, как его называет сервер
 * качества (services/quality/access.js userNames): ФИО сотрудника, иначе логин.
 *
 * Лукап пользователей показывает логин (displayField "username"), а реестр нарушений, группы
 * и итоги месяца — ФИО. Если в поле выбора оставить логин, то после записи подпись поменялась
 * бы на ФИО: одно и то же лицо под двумя именами на одном экране.
 */
export function userDisplayName(item: Record<string, unknown> | null | undefined, fallback = ""): string {
	const employee = item?.employee as { fullName?: unknown } | null | undefined;
	const fullName = typeof employee?.fullName === "string" ? employee.fullName.trim() : "";
	if (fullName) return fullName;
	const username = typeof item?.username === "string" ? item.username.trim() : "";
	return username || fallback;
}
