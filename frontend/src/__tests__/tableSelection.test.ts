/**
 * Отметки строк таблицы живут, пока живы строки: иначе групповое действие уходит по чужим id.
 */
import { describe, expect, it } from "vitest";
import { pruneSelection } from "src/components/Table/services";

describe("pruneSelection", () => {
	it("исчезнувшие строки снимаются, оставшиеся — нет", () => {
		expect([...(pruneSelection(new Set([1, 2, 3]), [2, 3, 4]) ?? [])]).toEqual([2, 3]);
	});

	it("все отметки живы — набор не пересоздаётся (null значит «не трогать»)", () => {
		expect(pruneSelection(new Set([1, 2]), [1, 2, 3])).toBeNull();
	});

	it("строк ещё нет — отметки не трогаем: у таблиц-состояний (роли) они приходят раньше строк", () => {
		expect(pruneSelection(new Set([1, 2]), [])).toBeNull();
	});

	it("пустой набор отметок — чистить нечего", () => {
		expect(pruneSelection(new Set(), [1, 2])).toBeNull();
	});
});
