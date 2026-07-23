/**
 * Разбор ВСТАВЛЕННОЙ ссылки приложения («Копировать ссылку на эту форму») в
 * ObjectRef с человекочитаемой подписью.
 *
 * Отделено от utils/objectRef намеренно: там чистые функции (формат/разбор
 * токена, покрыты тестами), здесь — обращения к сети и словарю.
 */
import type { TPaneRestore } from "src/app/types";
import { apiClient } from "src/services/api/client";
import { decodeRestore } from "src/utils/paneLink";
import { refFromRestore, type ObjectRef } from "src/utils/objectRef";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";

/** Подпись записи: имя (справочник) либо «№ номер - дата» (документ). */
function labelOfItem(item: Record<string, unknown>, fallback: string): string {
	if (item.name) return String(item.name);
	if (item.number) {
		const date = item.date ? ` - ${getFormatDateOnly(String(item.date))}` : "";
		return `№ ${item.number}${date}`;
	}
	return fallback;
}

/**
 * Подпись объекта по рецепту панели. Для формы дочитывает запись (чтобы в чате
 * была видна «Реализация № 12», а не «sales»); при недоступности — переводит тип.
 */
export async function describeRestore(restore: TPaneRestore): Promise<string> {
	switch (restore.kind) {
		case "form": {
			const typeLabel = translate(restore.endpoint);
			if (!restore.uuid) return typeLabel;
			try {
				const r = await apiClient.get<{ item?: Record<string, unknown> }>(
					`${restore.endpoint}/${restore.uuid}`,
				);
				const item = r.data?.item;
				return item ? labelOfItem(item, typeLabel) : typeLabel;
			} catch {
				// Нет прав/записи — подпись по типу; ссылка всё равно рабочая.
				return typeLabel;
			}
		}
		case "view":
			return translate(restore.name);
		case "list":
			return translate(restore.ref);
		case "report":
			return translate(restore.key);
		case "file":
			return restore.fileName || translate("file");
	}
}

/**
 * Пытается собрать ObjectRef из вставленного текста — если это ссылка приложения
 * (…?open=<код>). Иначе null (текст вставляется как обычно).
 */
export async function refFromAppLink(text: string): Promise<ObjectRef | null> {
	const trimmed = text.trim();
	if (!trimmed || /\s/.test(trimmed)) return null; // ссылка — одиночный токен
	let code: string | null = null;
	try {
		const url = new URL(trimmed);
		code = url.searchParams.get("open");
	} catch {
		return null; // не URL
	}
	if (!code) return null;
	const restore = decodeRestore(code);
	if (!restore) return null;
	return refFromRestore(restore, await describeRestore(restore));
}
