/**
 * Шина «объект создан из лукапа» (write-back).
 *
 * Задача: пользователь в LookupField (в т.ч. «Основание») жмёт «Создать новый»,
 * заполняет открывшуюся форму и нажимает «Записать и закрыть» — созданный объект
 * должен подставиться в ТО САМОЕ поле, из которого создание было инициировано.
 *
 * Почему событие, а не колбэк в data панели: панели восстанавливаются из ссылки
 * (см. utils/paneLink) и их data должна оставаться сериализуемой — функцию туда
 * класть нельзя. Поэтому в data кладётся одноразовый ТОКЕН, поле подписывается на
 * него, а форма после сохранения публикует запись с тем же токеном.
 *
 * Активацию панели-владельца делать здесь не нужно: addPane уже запоминает
 * openerPaneId, и requestClose возвращает фокус на неё (см. app/index.tsx).
 */

const EVENT = "lookupObjectCreated";

/** Ключ токена в data открываемой панели. */
export const LOOKUP_CREATE_TOKEN_KEY = "__lookupCreateId";

export interface LookupCreatedDetail {
	/** Токен, связывающий созданный объект с инициировавшим полем. */
	requestId: string;
	/** UUID созданной записи. */
	uuid: string;
	/** Эндпоинт модели (для контроля соответствия полю). */
	endpoint: string;
	/** Сохранённая запись (ответ сервера) — из неё берётся отображаемое значение. */
	item?: Record<string, unknown>;
}

/** Новый одноразовый токен запроса на создание. */
export function newLookupCreateToken(): string {
	return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Опубликовать созданный объект (вызывает форма после «Записать и закрыть»). */
export function emitLookupCreated(detail: LookupCreatedDetail): void {
	window.dispatchEvent(new CustomEvent<LookupCreatedDetail>(EVENT, { detail }));
}

/** Подписаться на создание по конкретному токену. Возвращает функцию отписки. */
export function subscribeLookupCreated(
	requestId: string,
	callback: (detail: LookupCreatedDetail) => void,
): () => void {
	const handler = (ev: Event) => {
		const detail = (ev as CustomEvent<LookupCreatedDetail>).detail;
		if (detail?.requestId === requestId) callback(detail);
	};
	window.addEventListener(EVENT, handler);
	return () => window.removeEventListener(EVENT, handler);
}
