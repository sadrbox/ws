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

/**
 * ПОДПИСЬ СОСТОЯНИЯ — для быстрого поиска. Панель показывает в «Статусе» не код кластера, а подпись по рангу
 * (baseState в models/OneCBases), и человек ищет то, что видит: «нет в СУБД», «скрыта». Поиск шёл по сырому коду
 * (`ONLINE`) и такие запросы не находил ничего. Ищем по подписям на обоих языках панели (RU/KK) и по коду.
 *
 * Тексты — копия ключей onecBase* из frontend/src/i18 (бэкенд переводов не грузит); расхождение ловит
 * __tests__/onecBasesList.test.js.
 */
export const BASE_STATE_LABELS = {
	0: ["Доступна", "Қолжетімді"],
	1: ["Нет доступа", "Қолжетімі жоқ"],
	2: ["Недоступна", "Қолжетімсіз"],
	3: ["Нет в СУБД", "ДҚБЖ-де жоқ"],
	4: ["Нет в кластере", "Кластерде жоқ"],
	5: ["Скрыта", "Жасырылған"],
	6: ["Не проверялась", "Тексерілмеген"],
};

/** Подпись колонки «Публикация»: null — «не проверялась» (копия onecPublished/onecNotPublished/onecPublishUnknown). */
export const PUBLISH_LABELS = {
	true: ["Опубликована", "Жарияланған"],
	false: ["Нет публикации", "Жарияланбаған"],
	null: ["Не проверялась", "Тексерілмеген"],
};

/**
 * СОВПАДАЕТ ЛИ СТРОКА С БЫСТРЫМ ПОИСКОМ — по тому, что видно в колонках, а не по тому, что хранится.
 *
 * Слова ищет сервер (SERVER_WORD_SEARCH в useModelListState): клиент искал по сырым значениям видимых колонок —
 * по коду ONLINE вместо подписи «Статуса» и мимо «Адреса публикации», который по умолчанию скрыт. Поэтому правило
 * покрывает надмножество колонок списка. «Адрес публикации» панель показывает под публичным именем сервера, а в
 * подсказке — адрес от агента; ищем по обоим. Каждое слово должно найтись (как в клиентском поиске). Служебные
 * id/uuid не ищем.
 */
export function matchesBaseSearch(x, needle) {
	const words = String(needle ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return true;
	const haystack = [
		x.baseKey, x.name, x.status, ...(BASE_STATE_LABELS[baseStateRank(x)] ?? []),
		x.serverName, x.onecVersion,
		...PUBLISH_LABELS[x.published === true ? "true" : x.published === false ? "false" : "null"],
		x.publishUrlPublic, x.publishUrl,
		x.extensionsCount, x.sessionsCount,
	]
		.filter((v) => v !== null && v !== undefined && v !== "")
		.map((v) => String(v).toLowerCase())
		.join(" \u0000 ");
	return words.every((w) => haystack.includes(w));
}

/**
 * Регламентные задания (18.09): в колонке — «Включено» / «Отключено» / «—». Сортируем по показанному: булево
 * поле `scheduled_jobs_denied` иначе давало бы порядок «false, true», в котором «не знаем» (null) уезжает в конец
 * по общему правилу пустых, а «Включено» и «Отключено» стоят по алфавиту английских слов.
 */
const jobsRank = (x) => (x.scheduledJobsDenied === false ? 0 : x.scheduledJobsDenied === true ? 1 : 2);

/** Значение поля для сортировки: у вычисляемых колонок — то, что показано, а не то, что хранится. */
const SORT_VALUE = {
	status: baseStateRank,
	scheduledJobsDenied: jobsRank,
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
