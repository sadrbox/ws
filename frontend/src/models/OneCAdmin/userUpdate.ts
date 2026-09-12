/**
 * ЧТО ИМЕННО МЕНЯЕМ У ПОЛЬЗОВАТЕЛЯ БАЗЫ — расчёт отдельно от формы.
 *
 * ЗАЧЕМ ОТДЕЛЬНО. Правило простое на словах и легко теряемое в разметке: в команду уходит
 * ТОЛЬКО ИЗМЕНЁННОЕ. Оно уже терялось — и дорого: поле «Показывать в списке выбора» форма
 * не умела прочитать (в ответе `IB_LIST_USERS` его нет), подставляла «включено» как факт и
 * отправляла при каждом «Применить». Правка полного имени молча включала показ в списке
 * тому, у кого он был выключен. Здесь это правило — функция, которую проверяет тест.
 *
 * ТРИ РОДА ПОЛЕЙ, и обращаются с ними по-разному:
 *   известное (полное имя, признак отключения) — сравниваем с тем, что пришло из базы;
 *   непрочитываемое (показ в списке) — трёхзначно: `null` значит «не менять», и в команду
 *     не попадает вовсе;
 *   недоступное (пароль) — уходит только введённое, прочитать его неоткуда.
 */

/** Что панель знает о пользователе в ЭТОЙ базе — из реестра. */
export type UserCurrent = {
	fullName: string;
	disabled: boolean;
	/** `null` — агент не сообщает это значение (см. миграцию 019). */
	showInList: boolean | null;
};

/** Что стоит в полях формы. */
export type UserDraft = {
	/** Имя входа: отличается от текущего — значит, просят переименовать. */
	name: string;
	fullName: string;
	password: string;
	disabled: boolean;
	showInList: boolean | null;
};

/**
 * Тело команды `IB_UPDATE_USER` — или `null`, если менять нечего.
 *
 * `name` всегда остаётся АДРЕСОМ: им команда находит пользователя в базе. Новое имя едет
 * отдельным полем `newName`, иначе правка полного имени выглядела бы как переименование.
 */
export function buildUserUpdate(
	userName: string, current: UserCurrent, draft: UserDraft,
): Record<string, unknown> | null {
	const rename = draft.name.trim() && draft.name.trim() !== userName ? draft.name.trim() : "";
	const fullNameChanged = draft.fullName.trim() !== (current.fullName ?? "").trim();
	const disabledChanged = draft.disabled !== current.disabled;
	const showChanged = draft.showInList !== null && draft.showInList !== current.showInList;

	if (!rename && !fullNameChanged && !draft.password && !disabledChanged && !showChanged) return null;

	return {
		name: userName,
		...(rename ? { newName: rename } : {}),
		...(fullNameChanged ? { fullName: draft.fullName.trim() } : {}),
		...(draft.password ? { password: draft.password } : {}),
		...(disabledChanged ? { disabled: draft.disabled } : {}),
		...(showChanged ? { showInList: draft.showInList } : {}),
	};
}
