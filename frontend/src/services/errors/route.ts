/**
 * КУДА ПОКАЗАТЬ ОШИБКУ — одно решение на всё приложение.
 *
 * ЗАЧЕМ. Правило «Notice vs Toast» было памяткой, а исполнялось руками: семнадцать
 * обработчиков `onError` звали `showToast`, и НИ ОДИН не различал системный сбой и отказ по
 * существу. «Сначала отключите агента» (409) мигало и исчезало так же, как обрыв сети, — то
 * есть ответ на вопрос человека пропадал вместе с ответом машины о своём нездоровье. А
 * `isSystemError` жил двумя копиями в двух моделях и применялся только в них.
 *
 * ПРАВИЛО. Канал выбирается по вопросу, на который отвечает (docs/TASKS_MESSAGING):
 *
 *   ОТКАЗ ПО СУЩЕСТВУ (400, 409, 422, 423 …) — ответ ЭТОЙ форме на ЭТО действие:
 *      «период закрыт», «серий меньше количества», «сначала отключите агента». Человек
 *      смотрит на форму, и ответ обязан остаться на экране, а не мигнуть на четыре секунды.
 *      → сообщение формы (`<Notice />`, показывает область «Технические сообщения»).
 *
 *   СИСТЕМНЫЙ СБОЙ (нет сети, 5xx, 403, таймаут) — про приложение, а не про данные:
 *      → тост «сейчас» И запись в журнал «что происходило». Раньше был только тост: через
 *      четыре секунды от отказа не оставалось ничего, и вопрос «почему полчаса назад ничего
 *      не сохранялось» был неразрешим.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. 401 не наш случай: сессию чистит перехватчик клиента, и показывать поверх
 * этого сообщение о «неудаче» значит спорить с экраном входа, который уже открылся.
 */
import { notify } from "src/components/TechMessages/store";
import { translate } from "src/i18";
import { humanErrorText } from "src/utils/errorText";
import type { NoticeItem } from "src/components/Notice";

/** Разбор любой ошибки до двух фактов: статус и текст для человека. */
export function errorStatus(e: unknown): number | undefined {
	if (!e || typeof e !== "object") return undefined;
	const withStatus = e as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
	for (const v of [withStatus.status, withStatus.statusCode, withStatus.response?.status]) {
		if (typeof v === "number" && Number.isFinite(v)) return v;
	}
	return undefined;
}

/**
 * Текст ошибки — ЗДЕСЬ ЖЕ И ПО-ЧЕЛОВЕЧЕСКИ.
 *
 * Отказ сервиса приходит написанным для человека, и его передаём дословно. А вот браузер
 * на неушедший запрос бросает «Failed to fetch» — по этим словам нельзя ни понять, что
 * случилось, ни решить, что делать; в журнале они выглядели как «Операция завершилась с
 * ошибками · Failed to fetch». Подменяем только такие, заведомо не предметные (см.
 * humanErrorText), и делаем это в одном месте — через него проходят все три канала:
 * тост, журнал и сообщение формы.
 */
export function errorText(e: unknown, fallback = translate("unknownError")): string {
	if (typeof e === "string" && e.trim()) return humanErrorText(e);
	if (e && typeof e === "object") {
		const o = e as { response?: { data?: { message?: unknown } }; message?: unknown };
		const server = o.response?.data?.message;
		if (typeof server === "string" && server.trim()) return humanErrorText(server);
		if (typeof o.message === "string" && o.message.trim() && !AXIOS_GENERIC.test(o.message.trim())) {
			return humanErrorText(o.message);
		}
	}
	return fallback;
}

/**
 * «Request failed with status code 500» — слова axios, когда сервер не объяснил отказ.
 * Человеку они не говорят ничего, а у места вызова есть свой переведённый `fallback`
 * («Не удалось загрузить список файлов») — он и честнее, и понятнее.
 */
const AXIOS_GENERIC = /^Request failed with status code \d+$/i;

/** Ошибка пришла от apiClient (у неё есть ответ сервера), а не от сервиса 1С или кода. */
const hasHttpResponse = (e: unknown): boolean =>
	!!e && typeof e === "object" && !!(e as { response?: unknown }).response;

/**
 * СБОЙ ЭТО ИЛИ ОТКАЗ.
 *
 * Системное — всё, что не про данные: связи нет (статуса нет вовсе), сервер сломался (5xx),
 * прав не дали (403), слишком часто (429), не дождались (408). Остальные 4xx — ответ по
 * существу: их придумала предметная область, и адресованы они форме.
 *
 * 403 намеренно СИСТЕМНОЕ, хотя формально это 4xx: «недостаточно прав» не исправляется
 * правкой полей — форму менять бессмысленно, идти нужно к администратору.
 */
export const isSystemError = (status?: number): boolean =>
	!status || status >= 500 || status === 403 || status === 429 || status === 408;

export interface RouteErrorOptions {
	/** Чем подписать запись журнала: «Реализация № 12», «Базы 1С». */
	source?: string;
	/** Область записи журнала: по умолчанию общая (APP_SCOPE в store). */
	scope?: string;
	/** Что показать, если у ошибки нет текста. */
	fallback?: string;
	/** Тип сообщения формы: по умолчанию «ошибка». */
	type?: NoticeItem["type"];
}

/**
 * Показать ошибку там, где ей место. Возвращает сообщения ДЛЯ ФОРМЫ:
 * пустой массив — значит показывать форме нечего, всё уже сказано тостом и журналом.
 *
 * Так вызывающий не решает, какой канал выбрать, — он лишь кладёт возвращённое в свой
 * `<Notice />`. Забыть про отказ по существу становится нельзя: он приходит возвратом.
 */
export function routeError(e: unknown, opts: RouteErrorOptions = {}): NoticeItem[] {
	const status = errorStatus(e);
	const text = errorText(e, opts.fallback);

	if (!isSystemError(status)) return [{ type: opts.type ?? "error", text }];

	// 403 от apiClient уже показал и записал перехватчик (services/api/client.ts): второй
	// тост и вторая запись о том же отказе ничего не добавляют. Отказ сервиса 1С идёт мимо
	// перехватчика — его показываем здесь.
	if (status === 403 && hasHttpResponse(e)) return [];

	// Тост «сейчас» и след в журнале — одним событием: тост живёт четыре секунды, а вопрос
	// «что это было» возникает позже.
	notify({ severity: "error", text, source: opts.source ?? translate("system"), scope: opts.scope });
	return [];
}

/**
 * Тот же разбор для мест, где формы нет вовсе (кнопка в тулбаре, фоновое действие).
 * Отказ по существу тоже попадает в журнал: показать его негде, а потерять нельзя.
 */
export function reportError(e: unknown, opts: RouteErrorOptions = {}): void {
	const items = routeError(e, opts);
	for (const it of items) {
		notify({ severity: it.type, text: it.text, source: opts.source ?? translate("system"), scope: opts.scope });
	}
}
