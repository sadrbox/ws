import { TColumn } from "src/components/Table/types";
import translations from "./translations.json" with { type: "json" };

export function getTranslation(word: string | undefined | null): string {
	const normalizedWord = word?.toLowerCase()?.replace(/\s/g, "") || "";

	const translate: [string, string] | undefined = Object.entries(
		translations,
	).find(([value]) => {
		const normalizedKey = value.toLowerCase().replace(/\s/g, "");
		return normalizedKey === normalizedWord;
	});

	return translate !== undefined ? translate[1] : word || "";
}

export const translate = (word: string) => getTranslation(word);

/**
 * Перевод серверных сообщений об ошибках на понятный пользователю язык.
 * Принимает строку (часто на английском) и возвращает локализованную версию.
 * Если перевод не найден — возвращает оригинал.
 */
const errorTranslations: [RegExp, string][] = [
	// ── Общие серверные ошибки ──
	[/server error/i, "Ошибка сервера"],
	[/not found/i, "Запись не найдена"],
	[/already exists/i, "Запись уже существует"],
	[/unauthorized/i, "Не авторизован"],
	[/forbidden/i, "Доступ запрещён"],
	[/invalid credentials/i, "Неверные учётные данные"],
	// ── Валидация полей (field required) ──
	[/shortName\s*required/i, "Укажите наименование"],
	[/contractNumber\s*required/i, "Укажите номер договора"],
	[/bin\s*required/i, "Укажите БИН"],
	[/name\s*required/i, "Укажите наименование"],
	[/username\s*required/i, "Укажите имя пользователя"],
	[/password\s*required/i, "Укажите пароль"],
	[/email\s*required/i, "Укажите email"],
	[/(\w+)\s+required/i, "Поле «$1» обязательно для заполнения"],
	// ── Prisma / DB ──
	[/unique constraint/i, "Нарушение уникальности: такая запись уже существует"],
	[
		/foreign key constraint/i,
		"Невозможно удалить: запись используется в других данных",
	],
];

export function translateError(message: string): string {
	if (!message) return message;
	for (const [pattern, replacement] of errorTranslations) {
		if (pattern.test(message)) {
			return message.replace(pattern, replacement);
		}
	}
	return message;
}

export function getTranslateColumn(column: TColumn): string | undefined {
	if (column.identifier) {
		const id = column.identifier.toString();
		const translated = getTranslation(id);
		// Если для identifier нет перевода — getTranslation возвращает сам id.
		// В этом случае предпочитаем явное column.name (например, для
		// динамически генерируемых колонок типа `tax_<uuid>`).
		if (translated && translated !== id) return translated;
		return column.name || id;
	}
	return column.name || column.identifier;
}
