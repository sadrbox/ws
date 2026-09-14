/**
 * ЧТО СЕРВИС ОБЯЗАН ЗАПОМНИТЬ САМ — по факту УСПЕШНО выполненной команды.
 *
 * ЗАЧЕМ. Часть реквизитов пользователя ИБ прочитать неоткуда: `IB_LIST_USERS` возвращает
 * имя, полное имя, признак отключения и роли — «Показывать в списке выбора» в этом ответе
 * нет и не было. Пока никто не запоминал записанное, выходило так: человек включает
 * тумблер, команда выполняется успешно, панель перечитывает базу — и показывает «выключено»,
 * потому что значение ей неизвестно. Со стороны это выглядит как «не записывается»
 * (жалоба 12.09, дважды за вечер).
 *
 * ПОЧЕМУ ЭТО ЧЕСТНО. Команда, завершившаяся успехом, несёт то самое значение в своём
 * payload: мы знаем, что записали. Это не догадка, а факт нашей собственной записи —
 * ровно поэтому колонка `base_users.show_in_list` трёхзначна: NULL значит «никто не
 * сообщал», а не «выключено» (миграция 019).
 *
 * ГРАНИЦА. Запоминаем ТОЛЬКО то, чего нельзя прочитать. Полное имя и признак отключения
 * приходят в каждом списке пользователей — их хранить по своей записи незачем: следующее
 * чтение принесёт истину, и расхождение будет видно.
 */

import type { IbUser } from "./registry.ts";

/** Что запомнить: пользователь в базе и значение непрочитываемого признака. */
export type WriteBack = { name: string; showInList: boolean };

/**
 * Разобрать успешную команду: есть ли в ней то, что стоит запомнить.
 *
 * `null` — запоминать нечего (другая команда, признака в payload нет, имя пустое).
 */
export function writeBackOf(type: string, payload: Record<string, unknown>): WriteBack | null {
	if (type !== "IB_CREATE_USER" && type !== "IB_UPDATE_USER") return null;
	if (typeof payload.showInList !== "boolean") return null;

	// Переименование: значение относится к НОВОМУ имени — под прежним пользователя в базе
	// уже нет, и запись по нему потерялась бы.
	const raw = typeof payload.newName === "string" && payload.newName.trim()
		? payload.newName
		: payload.name;
	const name = typeof raw === "string" ? raw.trim() : "";
	if (!name) return null;

	return { name, showInList: payload.showInList };
}

const FIELD_LABEL: Record<string, string> = {
	showInList: "«Показывать в списке выбора»",
	fullName: "«Полное имя»",
	disabled: "«Вход запрещён»",
	password: "пароль",
};

/**
 * УСПЕХ С ОГОВОРКОЙ у записи пользователя (П12, агент с 14.09 12:46): `unverified` — записано, но
 * перечитать не удалось; `skipped` — необязательные свойства, которые платформа не приняла (полное
 * имя и т. п.). Команда при этом «Выполнено», и без предупреждения человек уходит, считая записанным
 * всё. `null` — оговорок нет.
 */
export function userWriteWarning(result: { unverified?: unknown; skipped?: unknown } | null | undefined): string | null {
	if (!result) return null;
	const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);
	const label = (k: string) => FIELD_LABEL[k] ?? k;
	const parts: string[] = [];
	const unverified = list(result.unverified);
	if (unverified.length) {
		parts.push(`записано, но перечитать не удалось: ${unverified.map(label).join(", ")} — проверьте в Конфигураторе`);
	}
	const skipped = list(result.skipped);
	if (skipped.length) parts.push(`платформа не приняла: ${skipped.map(label).join(", ")}`);
	return parts.length ? parts.join("; ") : null;
}

/**
 * Запоминать ли записанное ПОСЛЕ применения эха (S2). Эхо принесло признак этого пользователя —
 * прочитанное у 1С важнее памяти о своей записи: запомненное перетёрло бы правду отметкой
 * «по записи панели». Не принесло (старая сборка) — запоминаем: строка пользователя после эха
 * уже есть, в том числе у только что созданного.
 */
export function rememberAfterEcho(back: WriteBack, echoUsers: IbUser[]): boolean {
	const key = back.name.toLowerCase();
	const found = echoUsers.find((u) => u.name.trim().toLowerCase() === key);
	return !(found && typeof found.showInList === "boolean");
}
