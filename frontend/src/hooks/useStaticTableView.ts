/**
 * Сортировка и быстрый поиск для таблиц на СТАТИЧНЫХ данных (buildStaticTableProps).
 *
 * ЗАЧЕМ. В курсорных списках и порядок, и поиск выполняет сервер, а у статичных таблиц
 * оба были заглушками: клик по заголовку рисовал стрелку, строка поиска принимала текст —
 * и ничего не менялось. Данные при этом целиком в памяти, поэтому и то и другое делается
 * здесь, теми же правилами, что и везде (sortTableRows: числа как числа, null в конец).
 *
 * ПОРЯДОК ОПЕРАЦИЙ: сначала фильтр, потом сортировка. Наоборот — значит сортировать
 * строки, которые всё равно будут выброшены.
 *
 * Ищем по СЫРЫМ значениям строки, до форматирования: вызывающий сортирует и фильтрует
 * исходные данные, а формат накладывает после (иначе «04.09.2026» сравнивалось бы
 * посимвольно). Служебные поля id/uuid из поиска исключены — по ним не ищут.
 */
import { useDeferredValue, useMemo, useState } from "react";
import { sortTableRows } from "src/components/Table/services";
import type { TDataItem } from "src/components/Table/types";

export type TableSort = Record<string, "asc" | "desc">;

const SKIP = new Set(["id", "uuid"]);

function matches(row: TDataItem, needle: string): boolean {
	for (const [k, v] of Object.entries(row)) {
		if (SKIP.has(k) || v == null) continue;
		// Ищем по скалярам: объект в ячейке дал бы «[object Object]» — совпадение,
		// которого пользователь не поймёт.
		if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
		if (String(v).toLowerCase().includes(needle)) return true;
	}
	return false;
}

export function useStaticTableView<T extends TDataItem>(rows: T[], initialSort: TableSort = {}) {
	const [sort, setSort] = useState<TableSort>(initialSort);
	const [query, setQuery] = useState("");
	// Ввод не должен дёргать перерисовку сотен строк на каждый символ.
	const deferred = useDeferredValue(query);

	const filtered = useMemo(() => {
		const needle = deferred.trim().toLowerCase();
		return needle ? rows.filter((r) => matches(r, needle)) : rows;
	}, [rows, deferred]);

	const sorted = useMemo(() => sortTableRows(filtered, sort), [filtered, sort]);
	const sorting = useMemo(() => ({ sort, onSortChange: setSort }), [sort]);
	const search = useMemo(() => ({ value: query, onChange: setQuery }), [query]);

	return { rows: sorted, sorting, search };
}

export default useStaticTableView;
