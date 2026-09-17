/**
 * СПИСОК БАЗ 1С («Администрирование 1С» → «Базы»): что в него попадает и как он сортируется.
 */

/**
 * БАЗЫ, КОТОРОЙ НЕТ В КЛАСТЕРЕ, В СПИСКЕ НЕТ.
 *
 * ЖИВОЙ СЛУЧАЙ (17.09). «Удалить регистрацию из кластера» у nomadstroygroup отработала, сервис пометил
 * базу MISSING, а строка осталась в списке: прокси отдавал весь реестр. Человек видел базу как прежде,
 * нажимал ещё раз — и получал «база не найдена в кластере», затем прятал её вручную.
 *
 * Запись в реестре остаётся (история команд и заданий ссылается на ключ базы), а в список не попадает —
 * так же, как остальные экраны панели не предлагают такую базу ни для одной операции (isApplicable).
 * Если базу зарегистрируют снова, полный срез вернёт ей статус, и она появится сама.
 *
 * Скрытые базы (disabled) в списке остаются: их прячут от операций, но вернуть можно только из карточки.
 */
export const isListedBase = (x) => x.status !== "MISSING";

/**
 * «Статус» в списке — не код кластера, а СОСТОЯНИЕ, которое видит человек: у базы-фантома кластер
 * отвечает ONLINE (запись есть), а панель пишет «нет в СУБД» (см. renderCell в models/OneCBases).
 * Сортировка шла по сырому коду — и не делала ничего: живой реестр 17.09 — 111 баз, у всех ONLINE,
 * 27 из них показаны недоступными. Поэтому «Статус» сортируется по показанному состоянию.
 *
 * Порядок — от рабочего к проблемному, а не по алфавиту подписей: подписи переводятся (RU/KK), а
 * смысл сортировки — собрать вместе базы, с которыми можно работать, и те, с которыми нельзя.
 */

/** Ранг состояния — в том же порядке ветвей, что и подпись в панели. */
export function baseStateRank(x) {
	if (x.ibUnreachableAt) {
		// Подпись по причине: «не пускают» → «недоступна» → «нет в СУБД» (последнее не лечится повтором).
		return { NO_ACCESS: 1, NO_DB: 3 }[x.ibUnreachableReason] ?? 2;
	}
	return { ONLINE: 0, MISSING: 4, DISABLED: 5, UNKNOWN: 6 }[x.status] ?? 7;
}

/** Значение поля для сортировки: у вычисляемых колонок — то, что показано, а не то, что хранится. */
const SORT_VALUE = {
	status: baseStateRank,
};

/** Сравнение значений строки: числа как числа, пустые — в конец. */
export function compare(a, b, dir) {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	const sign = dir === "desc" ? -1 : 1;
	if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
	return String(a).localeCompare(String(b), "ru") * sign;
}

/** Сортировка приходит как JSON-строка { "поле": "asc" | "desc" }. */
export function parseSort(raw) {
	if (typeof raw !== "string" || !raw) return null;
	try {
		const o = JSON.parse(raw);
		return o && typeof o === "object" ? o : null;
	} catch {
		return null;
	}
}

/** Отсортировать строки списка. Сортировка устойчивая: равные остаются в порядке сервиса (сервер, ключ). */
export function sortBases(items, sort) {
	if (!sort) return items;
	const entries = Object.entries(sort);
	if (!entries.length) return items;
	const valueOf = (row, field) => (SORT_VALUE[field] ? SORT_VALUE[field](row) : row[field]);
	return [...items].sort((a, b) => {
		for (const [field, dir] of entries) {
			const c = compare(valueOf(a, field), valueOf(b, field), dir);
			if (c !== 0) return c;
		}
		return 0;
	});
}
