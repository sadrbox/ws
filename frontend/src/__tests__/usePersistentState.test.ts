/**
 * usePersistentState — сохранение состояния в localStorage между «сессиями».
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePersistentState } from "src/hooks/usePersistentState";

const KEY = "test.persist.field";
const STORAGE_KEY = `ui.persist.${KEY}`;

describe("usePersistentState", () => {
	beforeEach(() => localStorage.clear());

	it("использует initial, когда в localStorage пусто", () => {
		const { result } = renderHook(() => usePersistentState(KEY, "def"));
		expect(result.current[0]).toBe("def");
	});

	it("поддерживает ленивую инициализацию", () => {
		const { result } = renderHook(() => usePersistentState(KEY, () => "lazy"));
		expect(result.current[0]).toBe("lazy");
	});

	it("сохраняет значение в localStorage при изменении", () => {
		const { result } = renderHook(() => usePersistentState(KEY, "a"));
		act(() => result.current[1]("b"));
		expect(result.current[0]).toBe("b");
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toBe("b");
	});

	it("восстанавливает сохранённое значение (новый монтаж), игнорируя initial", () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify("saved"));
		const { result } = renderHook(() => usePersistentState(KEY, "def"));
		expect(result.current[0]).toBe("saved");
	});

	it("сериализует объекты", () => {
		const { result } = renderHook(() =>
			usePersistentState<{ from: string; to: string }>(KEY, { from: "", to: "" }),
		);
		act(() => result.current[1]({ from: "2026-01-01", to: "2026-01-31" }));
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
	});
});
