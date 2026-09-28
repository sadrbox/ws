/**
 * ОТВЕТ ВЫГРУЗКИ РАСШИРЕНИЯ → ФАЙЛ (28.09).
 *
 * Сервис держит содержимое .cfe в журнале команд только час (С3 задачи агента 28.09): потом убирает
 * `contentBase64` и кладёт рядом `contentDigest = {size, sha256}` — след того, что файл был. Такой ответ приходит,
 * когда команду дочитывают позже (поздний результат, восстановленное слежение). Без различения панель говорила
 * «в базе нет прочитанных расширений» — неправду: расширение выгрузилось, удалён только файл из журнала, и лекарство
 * одно — выгрузить заново.
 *
 * Результат в журнале бывает обёрнут `{success, data}` — поля ищем и на верхнем уровне, и в `data`.
 *
 * Модуль без компонентов (Fast Refresh): разбор проверяет тест.
 */

export type ExportAnswer =
	/** Файл есть — можно отдать на скачивание. */
	| { kind: "file"; base64: string; fileName: string | null; name: string | null }
	/** Файл был, но сервис уже убрал его из журнала (прошёл час): выгрузить заново. */
	| { kind: "expired" }
	/** Ни файла, ни его следа. */
	| { kind: "empty" };

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function readExportAnswer(r: unknown): ExportAnswer {
	const inner = r && typeof r === "object" ? (r as { data?: unknown }).data : undefined;
	const layers = [r, inner].filter((o): o is Record<string, unknown> => !!o && typeof o === "object");
	for (const o of layers) {
		const base64 = text(o.contentBase64);
		if (base64) return { kind: "file", base64, fileName: text(o.fileName), name: text(o.name) };
	}
	return layers.some((o) => !!o.contentDigest && typeof o.contentDigest === "object")
		? { kind: "expired" }
		: { kind: "empty" };
}
