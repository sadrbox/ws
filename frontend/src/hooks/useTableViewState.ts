/**
 * СОРТИРОВКА, БЫСТРЫЙ ПОИСК И ОТБОРЫ ТАБЛИЦЫ — С ПАМЯТЬЮ (28.09).
 *
 * Один хук для всех владельцев этого состояния: списки справочников и документов (useModelListState), табличные части
 * (SubTable) и таблицы на статичных данных (useStaticTableView). Хранит — общее состояние таблицы по её имени
 * (components/Table/tableState.ts), рядом с настройками колонок и видом списка.
 *
 * ПРАВИЛО: что пользователь выбрал, то и остаётся, пока он сам не изменит. Закрыл вкладку, открыл снова — та же
 * сортировка, тот же поиск и тот же период. «Обновить» с очисткой, «Очистить отборы», пустая строка поиска —
 * это тоже изменение пользователем, и оно так же запоминается (пустое просто не хранится).
 *
 * ПОИСК И ОТБОРЫ ПРЯЧУТ СТРОКИ — поэтому их память осторожнее, чем у сортировки (сортировка ничего не прячет):
 *   • `scope` — у табличной части документа поиск относится к ЭТОМУ документу: он возвращается при повторном
 *     открытии того же документа, а в другой не переносится (поиск «ноут» в строках одной реализации не должен
 *     встретить пользователя отобранными строками другой — с суммами подвала только по отобранным). Документ ещё не
 *     записан (владельца нет) — поиск живёт, пока открыт экран;
 *   • `rememberFilters: false` — таблица, где отмеченные строки уходят в групповую операцию (выбор баз для установки
 *     расширения, сеансы для завершения): восстановленный поиск незаметно сузил бы выбор — «отметить все» отметит
 *     только видимые. Там поиск живёт, пока открыт экран, как раньше.
 * Записываются поиск и отборы только после изменения пользователем: открыть другой документ не значит стереть
 * запомненный поиск прежнего.
 *
 * ЧИТАЕТСЯ ОДИН РАЗ — при монтировании: начальное состояние нужно синхронно, до первого запроса к серверу, иначе
 * список сходил бы за данными с умолчанием и тут же ещё раз — с сохранённым. Две открытые вкладки одной таблицы
 * живут каждая своим состоянием, запоминается последнее изменение.
 *
 * Сортировка, равная умолчанию владельца, не хранится: иначе смена умолчания в коде не дошла бы до тех, кто однажды
 * щёлкал по заголовку.
 *
 * Без имени таблицы (`componentName` пуст) — обычный useState, ничего не хранится.
 */
import { useEffect, useRef, useState } from "react";
import { readTableState, sameSort, writeTableState, type TableFilter, type TableSort } from "src/components/Table/tableState";

export type TableViewDefaults = { sort?: TableSort; filter?: TableFilter };

export type TableViewMemory = {
	/** Помнить ли поиск и отборы (по умолчанию — да). Нет — у таблиц, где отмеченное уходит в групповую операцию. */
	rememberFilters?: boolean;
	/**
	 * Владелец, к которому относятся поиск и отборы (табличная часть — документ). Передан, но пуст (документ не
	 * записан) — поиск и отборы не запоминаются.
	 */
	scope?: string | null;
};

export function useTableViewState(
	componentName: string | null | undefined, defaults: TableViewDefaults = {}, memory: TableViewMemory = {},
) {
	const scoped = "scope" in memory;
	const scope = memory.scope || null;
	const remember = !!componentName && memory.rememberFilters !== false && (!scoped || !!scope);

	// Сохранённое — один раз на монтирование (см. шапку); ref, а не useMemo: чтение не должно повторяться.
	const restoredRef = useRef<ReturnType<typeof readTableState> | null>(null);
	if (restoredRef.current === null) restoredRef.current = readTableState(componentName);
	const restored = restoredRef.current;
	// Поиск и отборы возвращаются только туда, где их запомнили: у документа — тому же документу.
	const restoreFilters = remember && (!scoped || restored.searchScope === scope);

	const [sort, setSort] = useState<TableSort>(() => restored.sort ?? defaults.sort ?? {});
	const [search, setSearch] = useState<string>(() => (restoreFilters ? restored.search ?? "" : ""));
	const [filter, setFilter] = useState<TableFilter | undefined>(() => (restoreFilters ? restored.filter : undefined) ?? defaults.filter);

	// Умолчание — из первого рендера: владельцы передают его литералом, и новый объект на каждый рендер не должен
	// заново записывать хранилище.
	const defaultSortRef = useRef(defaults.sort);

	useEffect(() => {
		if (!componentName) return;
		writeTableState(componentName, { sort: sameSort(sort, defaultSortRef.current) ? undefined : sort });
	}, [componentName, sort]);

	// Поиск и отборы — только после изменения пользователем: пока они те же, что при открытии, запись не нужна (и не
	// должна стирать запомненное для другого документа). Сравнение со значениями открытия, а не «первый проход
	// эффекта»: в режиме разработки React запускает эффект дважды.
	const initialFiltersRef = useRef({ search, filter });
	const filtersTouchedRef = useRef(false);
	useEffect(() => {
		if (!filtersTouchedRef.current && search === initialFiltersRef.current.search && filter === initialFiltersRef.current.filter) return;
		filtersTouchedRef.current = true;
		if (!remember) return;
		const has = !!search.trim() || !!(filter && Object.keys(filter).length);
		writeTableState(componentName, {
			search: search.trim() ? search : undefined,
			filter,
			searchScope: has && scoped ? scope ?? undefined : undefined,
		});
	}, [componentName, remember, scoped, scope, search, filter]);

	return {
		sort, setSort, search, setSearch, filter, setFilter,
		/** Сортировку при открытии взяли из сохранённого: её когда-то выбрал пользователь, а не код. */
		sortRestored: !!restored.sort,
	};
}

export default useTableViewState;
