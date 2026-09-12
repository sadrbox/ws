import { TColumn } from "src/components/Table/types";

/**
 * СЛОВАРИ ГРУЗЯТСЯ ПО ЯЗЫКУ, А НЕ ВСЕ СРАЗУ (O4).
 *
 * Два словаря по 2045 ключей — это 178 кБ русского и 138 кБ казахского, и оба лежали в
 * главном чанке статическими импортами: 60 % его веса приходилось на текст, из которого
 * русскому пользователю не нужна ровно половина. Теперь словарь активного языка
 * подгружается ОДИН раз до запуска приложения (см. main.tsx), а казахский — только тем,
 * кто на нём работает.
 *
 * `translate()` ОСТАЁТСЯ СИНХРОННЫМ: он вызывается на каждый заголовок колонки и подпись
 * поля, тысячи раз за рендер, и переделывать его в асинхронный означало бы переписать всё
 * приложение. Поэтому загрузка сделана шагом ЗАГРУЗКИ, а не ожиданием в месте вызова:
 * приложение рендерится после неё и словарь к этому моменту на месте.
 */
const _lang = (() => {
	try {
		return localStorage.getItem("lang") ?? "ru";
	} catch {
		return "ru";
	}
})();

let translations: Record<string, string> = {};

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

// Индекс «нормализованный ключ → перевод», собирается ОДИН раз.
// Раньше getTranslation на КАЖДЫЙ вызов делал Object.entries(...).find(...) —
// линейный перебор ~1000 ключей с toLowerCase() на каждом. А translate() дёргается
// на каждый заголовок колонки, подпись поля и ячейку таблицы, т.е. тысячи раз за
// рендер списка. Теперь это O(1) по Map.
const NORMALIZE = (s: string) => s.toLowerCase().replace(/\s/g, "");
const translationIndex: Map<string, string> = new Map();

/**
 * Загрузить словарь активного языка. Вызывается ОДИН раз при запуске (main.tsx) и в
 * подготовке тестов; повторный вызов ничего не делает.
 *
 * Казахский идёт ПОВЕРХ русского: непереведённый ключ показывается по-русски, а не сырым
 * кодом, — поэтому у казахского языка словарей два, а у русского один.
 */
let loaded: Promise<void> | null = null;

/** Положить готовый словарь (подготовка тестов: там он импортируется статически). */
export function setTranslations(dict: Record<string, string>): void {
	translations = dict;
	translationIndex.clear();
	for (const [key, value] of Object.entries(translations)) translationIndex.set(NORMALIZE(key), value);
	loaded = Promise.resolve();
}

export function loadTranslations(): Promise<void> {
	loaded ??= (async () => {
		const ru = (await import("./translations.json")).default as Record<string, string>;
		const kk = _lang === "kk"
			? (await import("./translations.kk.json")).default as Record<string, string>
			: null;
		translations = kk ? { ...ru, ...kk } : ru;
		translationIndex.clear();
		for (const [key, value] of Object.entries(translations)) translationIndex.set(NORMALIZE(key), value);
	})();
	return loaded;
}

export function getTranslation(word: string | undefined | null): string {
	if (!word) return "";
	// Ключа нет → возвращаем сам ключ (как и раньше).
	// Для казахского словарь собран как {...RU, ...KK}, поэтому непереведённый ключ
	// показывается по-русски, а не сырым кодом.
	return translationIndex.get(NORMALIZE(word)) ?? word;
}

export const translate = (word: string) => getTranslation(word);

/**
 * Перевод серверных сообщений об ошибках на понятный пользователю язык.
 */
const errorTranslations: [RegExp, string | (() => string)][] = [
	// ── Общие серверные ошибки ──
	[/server error/i, "Ошибка сервера"],
	[/not found/i, "Запись не найдена"],
	[/already exists/i, "Запись уже существует"],
	[/unauthorized/i, "Не авторизован"],
	[/forbidden/i, "Доступ запрещён"],
	[/invalid credentials/i, "Неверные учётные данные"],
	// ── Валидация полей (field required) ──
	// Перевод берётся В МОМЕНТ ПРИМЕНЕНИЯ, а не при загрузке модуля: словарь приезжает
	// отдельным файлом (см. loadTranslations), и вычисленная здесь строка была бы сырым
	// ключом. Остальные строки списка — литералы, их это не касается.
	[/contactType\s+is\s+required/i, () => translate("contactTypeRequired")],
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
			return message.replace(pattern, typeof replacement === "function" ? replacement() : replacement);
		}
	}
	return message;
}

export function getTranslateColumn(column: TColumn): string | undefined {
	if (column.identifier) {
		const id = column.identifier.toString();
		// Служебные колонки («__rowActions» и пр.) — без заголовка.
		if (id.startsWith("__")) return "";
		const translated = getTranslation(id);
		if (translated && translated !== id) return translated;
		return id;
	}
	return column.identifier;
}
