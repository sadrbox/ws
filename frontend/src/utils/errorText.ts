/**
 * Текст ошибки, написанный для человека.
 *
 * ЗАЧЕМ. Ошибки приходят из трёх слоёв, и два из них говорят не по-нашему: браузер бросает
 * «Failed to fetch», когда запрос не ушёл вовсе, а сетевой слой — «Network Error». В
 * журнале это выглядело как «Операция завершилась с ошибками. С ошибками: 1 · Failed to
 * fetch», то есть сообщало человеку ровно ничего: ни что случилось, ни что с этим делать.
 *
 * ЧТО ЗАМЕНЯЕМ, А ЧТО НЕТ. Заменяем только то, что заведомо не про предметную область:
 * обрыв связи и истёкшее ожидание. Отказы 1С и сервиса («пользователь не найден», «база
 * заблокирована») приходят уже написанными для человека — их передаём дословно: наш
 * пересказ был бы хуже оригинала и скрыл бы подробности, по которым чинят.
 */
import { translate } from "src/i18";

const NO_CONNECTION = /failed to fetch|network ?error|load failed|network request failed|err_network|econnrefused/i;
const TIMEOUT = /timed? ?out|econnaborted|etimedout|aborted/i;

/** Понятный текст по техническому сообщению. Пустая строка остаётся пустой. */
export function humanErrorText(raw: string): string {
	const s = raw.trim();
	if (!s) return "";
	if (NO_CONNECTION.test(s)) return translate("netNoConnection");
	if (TIMEOUT.test(s)) return translate("netTimeout");
	return s;
}

/** То же для пойманного значения: не-Error не приводим к «[object Object]». */
export const humanError = (e: unknown, unknownText = translate("unknownError")): string =>
	humanErrorText(e instanceof Error ? e.message : typeof e === "string" ? e : unknownText);
