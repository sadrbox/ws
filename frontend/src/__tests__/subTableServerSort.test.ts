/**
 * SubTable: unit-тесты serverSort фильтрации.
 *
 * Проверяем логику фильтрации sort-параметра перед отправкой на сервер:
 * поля у которых column.sortable === false не должны попасть в serverSort.
 *
 * Это критично для поля lineNumber (sortable: false в saleItemsColumns.json):
 * если оно попадёт в sort, бэкенд вернёт 500.
 */

import { describe, it, expect } from "vitest";
import type { TColumn } from "src/components/Table/types";

// ── Воспроизводит логику serverSort из SubTable ───────────────────────────────

function computeServerSort(
	sort: Record<string, "asc" | "desc">,
	columns: Pick<TColumn, "identifier" | "sortable">[],
): Record<string, "asc" | "desc"> | undefined {
	const unsortableCols = new Set(
		columns.filter((c) => c.sortable === false).map((c) => c.identifier),
	);
	if (unsortableCols.size === 0) return sort;
	const filtered = Object.fromEntries(
		Object.entries(sort).filter(([k]) => !unsortableCols.has(k)),
	) as Record<string, "asc" | "desc">;
	return Object.keys(filtered).length > 0 ? filtered : undefined;
}

// ── Тесты ──────────────────────────────────────────────────────────────────────

describe("SubTable: serverSort — фильтрация несортируемых полей", () => {
	it("lineNumber (sortable:false) не попадает в serverSort", () => {
		const sort = { lineNumber: "asc" } as Record<string, "asc" | "desc">;
		const columns: Pick<TColumn, "identifier" | "sortable">[] = [
			{ identifier: "lineNumber", sortable: false },
			{ identifier: "id", sortable: undefined },
		];
		const result = computeServerSort(sort, columns);
		expect(result).toBeUndefined();
	});

	it("обычное поле (sortable:undefined) проходит фильтр", () => {
		const sort = { id: "asc" } as Record<string, "asc" | "desc">;
		const columns: Pick<TColumn, "identifier" | "sortable">[] = [
			{ identifier: "id", sortable: undefined },
			{ identifier: "lineNumber", sortable: false },
		];
		const result = computeServerSort(sort, columns);
		expect(result).toEqual({ id: "asc" });
	});

	it("смешанный sort: несортируемое поле удаляется, остальные остаются", () => {
		const sort = { lineNumber: "asc", "product.name": "asc" } as Record<
			string,
			"asc" | "desc"
		>;
		const columns: Pick<TColumn, "identifier" | "sortable">[] = [
			{ identifier: "lineNumber", sortable: false },
			{ identifier: "product.name", sortable: undefined },
		];
		const result = computeServerSort(sort, columns);
		expect(result).toEqual({ "product.name": "asc" });
	});

	it("все поля sortable:true → sort передаётся без изменений", () => {
		const sort = { id: "desc", name: "asc" } as Record<
			string,
			"asc" | "desc"
		>;
		const columns: Pick<TColumn, "identifier" | "sortable">[] = [
			{ identifier: "id", sortable: true },
			{ identifier: "name", sortable: true },
		];
		const result = computeServerSort(sort, columns);
		expect(result).toEqual(sort);
	});

	it("нет несортируемых колонок → sort возвращается как есть (тот же объект)", () => {
		const sort = { id: "asc" } as Record<string, "asc" | "desc">;
		const columns: Pick<TColumn, "identifier" | "sortable">[] = [
			{ identifier: "id", sortable: undefined },
		];
		const result = computeServerSort(sort, columns);
		expect(result).toBe(sort); // ранняя оптимизация — тот же reference
	});

	it("все поля несортируемые → возвращает undefined", () => {
		const sort = { lineNumber: "asc", position: "desc" } as Record<
			string,
			"asc" | "desc"
		>;
		const columns: Pick<TColumn, "identifier" | "sortable">[] = [
			{ identifier: "lineNumber", sortable: false },
			{ identifier: "position", sortable: false },
		];
		const result = computeServerSort(sort, columns);
		expect(result).toBeUndefined();
	});
});
