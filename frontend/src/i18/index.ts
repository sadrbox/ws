import { TColumn } from "src/components/Table/types";
import translationsRu from "./translations.json" with { type: "json" };
import translationsKk from "./translations.kk.json" with { type: "json" };

const _lang = (() => {
	try {
		return localStorage.getItem("lang") ?? "ru";
	} catch {
		return "ru";
	}
})();

const translations: Record<string, string> =
	_lang === "kk"
		? {
				...(translationsRu as Record<string, string>),
				...(translationsKk as Record<string, string>),
			}
		: (translationsRu as Record<string, string>);

export function getLanguage(): "ru" | "kk" {
	return _lang as "ru" | "kk";
}

export function setLanguage(lang: "ru" | "kk"): void {
	try {
		localStorage.setItem("lang", lang);
	} catch {
		/* ignore */
	}
	window.location.reload();
}

export function getTranslation(word: string | undefined | null): string {
	const normalizedWord = word?.toLowerCase()?.replace(/\s/g, "") || "";

	const entry = Object.entries(translations).find(([key]) => {
		const normalizedKey = key.toLowerCase().replace(/\s/g, "");
		return normalizedKey === normalizedWord;
	});

	return entry !== undefined ? entry[1] : word || "";
}

export const translate = (word: string) => getTranslation(word);

/**
 * Перевод серверных сообщений об ошибках на понятный пользователю язык.
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
	[/contactType\s+is\s+required/i, translate("contactTypeRequired")],
	[/name\s*required/i, "Укажите наименование"],
	[/contractNumber\s*required/i, "Укажите номер договора"],
	[/bin\s*required/i, "Укажите БИН"],
	[/username\s*required/i, "Укажите имя пользователя"],
	[/password\s*required/i, "Укажите пароль"],
	[/email\s*required/i, "Укажите email"],
	[/(\w+)\s+required/i, "Поле «$1» обязательно для заполнения"],
	// ── Prisma / DB ──
	[/unique constraint/i, "Нарушение уникальности: такая запись уже существует"],
	[
		/foreign key constraint/i,
		"Невозможно удалить — запись используется в других документах",
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
		if (translated && translated !== id) return translated;
		return id;
	}
	return column.identifier;
}
