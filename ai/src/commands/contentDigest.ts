// СОДЕРЖИМОЕ ФАЙЛА .cfe В ЖУРНАЛЕ КОМАНД — ТОЛЬКО ПОКА ОНО НУЖНО (С3 docs/TASK_SERVICE_FROM_AGENT_AUDIT_2026-09-28.md, 28.09).
//
// Установка расширения несёт файл в `payload.contentBase64`, выгрузка — в `result.contentBase64`. Журнал команд живёт
// полгода (retention.ts), и раскатка на сотню баз оставляла в нём сто копий файла по ≈0,5 МБ — в таблице, которую
// сервис читает на каждом опросе агента. Файл нужен, пока его может взять агент (установка, её повтор) или панель
// (выгрузка); дальше вместо него — сводка `{size, sha256}`: по ней видно, какой именно файл ставили, и его можно
// сверить с файлом на руках. Когда что очищается — CommandQueue.complete и CommandQueue.scrubStoredContent.

import { createHash } from "node:crypto";

/** Что остаётся от файла: размер в байтах и SHA-256 (hex) раскодированного содержимого. */
export type ContentDigest = { size: number; sha256: string };

export const INSTALL_EXTENSION_TYPE = "IB_INSTALL_EXTENSION";
export const EXPORT_EXTENSION_TYPE = "IB_EXPORT_EXTENSION";

/**
 * Неуспешная установка (failed, canceled, expired) хранит файл сутки: «Повторить неуспешные» и повтор «база занята»
 * берут payload из САМОЙ команды — в задании файл намеренно не хранится (batchRunner.startBatch).
 */
export const INSTALL_CONTENT_KEEP_FAILED_SECS = 24 * 3600;

/** Выгрузку панель забирает сразу по /commands/:id; час — запас на медленную вкладку и повторное скачивание. */
export const EXPORT_CONTENT_KEEP_SECS = 3600;

/** Строк за проход очистки: 50 файлов — около 25 МБ в одном ответе базы, а не весь журнал разом. */
export const CONTENT_SCRUB_BATCH = 50;

/**
 * Сводка файла по его base64. Раскодирование мягкое: `Buffer.from` пропускает недопустимые знаки, а не бросает, —
 * битый base64 не должен ронять закрытие команды. Сводка тогда описывает то, что из строки раскодировалось.
 */
export function contentDigest(base64: string): ContentDigest {
	const bytes = Buffer.from(base64, "base64");
	return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * Сводки порции очистки: `{ id: сводка }` — одним параметром jsonb для `jsonb_each`. Не строка вместо файла (ключ
 * есть, значения нет) — `null`: выдумывать размер пустоты незачем, а ключ всё равно надо убрать.
 */
export function digestsById(rows: readonly { id: string; content: string | null }[]): Record<string, ContentDigest | null> {
	return Object.fromEntries(rows.map((x) => [x.id, typeof x.content === "string" ? contentDigest(x.content) : null]));
}
