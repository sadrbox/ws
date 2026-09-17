/**
 * СПИСОК БАЗ 1С («Администрирование 1С» → «Базы»): что в него попадает и как он сортируется.
 */

/**
 * КТО В СПИСКЕ ПО УМОЛЧАНИЮ: только базы, с которыми можно работать (П33).
 *
 * ЖИВОЙ СЛУЧАЙ (17.09). «Удалить регистрацию из кластера» у nomadstroygroup отработала, сервис пометил базу MISSING,
 * а строка осталась в списке: прокси отдавал весь реестр. Человек видел базу как прежде и звал её на команды,
 * которые откажут. Та же беда у скрытых: их прячут из работы, а в списке они стояли в одном ряду с рабочими.
 *
 * Поэтому по умолчанию не показываются:
 *   - базы, которых нет в кластере (`MISSING`) — регистрации уже нет;
 *   - скрытые (`disabled`) — их убрали из работы сознательно.
 * Переключатель «Скрытые и удалённые из кластера» (`showHidden`) показывает всех — оттуда скрытую возвращают в
 * работу, а удалённую из кластера убирают из реестра (С45). Запись в реестре остаётся в любом случае.
 *
 * Статус кластера берётся из `clusterStatus`: у скрытой базы сервис подменяет `status` на `DISABLED`, и база,
 * которую и скрыли, и удалили из кластера, иначе выглядела бы просто скрытой. Сервис старее С44 поля не знает —
 * тогда по `status`.
 */
export const clusterStatusOf = (x) => x.clusterStatus ?? x.status;

export const isListedBase = (x, { showHidden = false } = {}) =>
	showHidden || (clusterStatusOf(x) !== "MISSING" && !x.disabled);

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
	// Тот же порядок, что у подписи в панели (baseState в models/OneCBases): «нет в кластере» → «скрыта» →
	// недоступность → статус. Скрытие и недоступность у базы, которой нет в кластере, уже ничего не значат.
	if (clusterStatusOf(x) === "MISSING") return 4;
	if (x.disabled) return 5;
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
