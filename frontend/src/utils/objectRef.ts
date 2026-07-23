/**
 * ObjectRef — универсальная ССЫЛКА НА ЛЮБОЙ ОБЪЕКТ системы (справочник, документ,
 * отчёт, заметка, задача, файл).
 *
 * Основа переиспользуется от механизма «Копировать ссылку на эту форму»: код
 * рецепта панели из utils/paneLink (`f~<endpoint>~<uuid>`, `v~<name>~<uuid>`,
 * `r~<key>`…). По клику ссылка открывается тем же restorePane, что и ссылка из
 * адресной строки — то есть работает для всего, что вообще умеет открываться.
 *
 * Почему код, а не полный URL: код не зависит от домена/протокола (ссылка не
 * протухнет при смене адреса), компактен и рендерится дружелюбным чипом с
 * названием объекта вместо длинной строки.
 *
 * Текстовый токен для встраивания в тело сообщения/заметки:
 *     [[ref:<код>|<подпись>]]
 * Подпись хранится рядом с кодом, чтобы ссылка читалась даже когда объект
 * недоступен (нет прав) или удалён.
 */
import type { TPaneRestore } from "src/app/types";
import { encodeRestore } from "src/utils/paneLink";

export interface ObjectRef {
	/** Код рецепта панели (см. utils/paneLink). */
	code: string;
	/** Человекочитаемая подпись объекта («Реализация № 12 - 01.02.2026»). */
	label: string;
}

/** Регулярка токена ссылки. Код — без `|` и `]`, подпись — без `]`. */
const REF_TOKEN_RE = /\[\[ref:([^|\]]+)\|([^\]]*)\]\]/g;

/** Убирает символы, ломающие разбор токена. */
function sanitizeLabel(label: string): string {
	return label.replace(/[[\]|]/g, " ").replace(/\s+/g, " ").trim();
}

/** Строит ObjectRef из рецепта панели. */
export function refFromRestore(restore: TPaneRestore, label: string): ObjectRef {
	return { code: encodeRestore(restore), label: sanitizeLabel(label) };
}

/** Текстовый токен для вставки в сообщение/заметку. */
export function formatRefToken(ref: ObjectRef): string {
	return `[[ref:${ref.code}|${sanitizeLabel(ref.label)}]]`;
}

/** Кусок разобранного текста: обычный текст либо ссылка на объект. */
export type RefSegment =
	| { type: "text"; text: string }
	| { type: "ref"; ref: ObjectRef };

/**
 * Разбирает текст на сегменты: обычный текст и ссылки-токены.
 * Используется рендером сообщений чата (и любым другим текстом со ссылками).
 */
export function parseRefSegments(text: string): RefSegment[] {
	const segments: RefSegment[] = [];
	let lastIndex = 0;
	// Регулярка глобальная — работаем с копией, чтобы не тащить общий lastIndex.
	const re = new RegExp(REF_TOKEN_RE.source, "g");
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
		}
		segments.push({ type: "ref", ref: { code: match[1], label: match[2] } });
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		segments.push({ type: "text", text: text.slice(lastIndex) });
	}
	return segments;
}

/** Есть ли в тексте хотя бы одна ссылка (быстрая проверка перед разбором). */
export function hasRefToken(text: string): boolean {
	return new RegExp(REF_TOKEN_RE.source).test(text);
}
