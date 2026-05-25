/**
 * LookupField: unit-тесты логики навигации клавиатурой.
 *
 * Паттерн: тестируем извлечённую логику handleKeyDown без рендера компонента,
 * т.к. LookupField имеет тяжёлые зависимости (portal, api, context).
 *
 * Проверяем:
 * 1. ArrowDown при закрытом dropdown → вызывает handleQuickSelect
 * 2. ArrowDown при открытом dropdown → инкрементирует activeIndex
 * 3. ArrowUp в dropdown → декрементирует activeIndex с циклическим переходом
 * 4. Enter при activeIndex ≥ 0 → выбирает элемент и вызывает onEnterKey
 * 5. Enter без dropdown → вызывает onEnterKey
 * 6. Escape → закрывает dropdown
 * 7. ArrowDown disabled=true → handleQuickSelect НЕ вызывается
 */

import { describe, it, expect, vi } from "vitest";

// ── Воспроизводит логику handleKeyDown из LookupField ─────────────────────────

interface KeyDownState {
	isDropdownOpen: boolean;
	suggestions: Record<string, unknown>[];
	activeIndex: number;
	disabled: boolean;
}

interface KeyDownActions {
	setActiveIndex: (fn: (prev: number) => number) => void;
	setIsDropdownOpen: (v: boolean) => void;
	handleQuickSelect: () => void;
	handleSelectItem: (item: Record<string, unknown>) => void;
	onEnterKey?: () => void;
}

function simulateKeyDown(
	key: string,
	state: KeyDownState,
	actions: KeyDownActions,
): { preventDefault: boolean } {
	const { isDropdownOpen, suggestions, activeIndex, disabled } = state;
	let preventedDefault = false;

	if (!isDropdownOpen || suggestions.length === 0) {
		if (key === "ArrowDown") {
			if (!disabled) {
				preventedDefault = true;
				actions.handleQuickSelect();
			}
		} else if (key === "Enter") {
			actions.onEnterKey?.();
		}
		return { preventDefault: preventedDefault };
	}

	if (key === "ArrowDown") {
		preventedDefault = true;
		actions.setActiveIndex((prev) =>
			prev < suggestions.length - 1 ? prev + 1 : 0,
		);
	} else if (key === "ArrowUp") {
		preventedDefault = true;
		actions.setActiveIndex((prev) =>
			prev > 0 ? prev - 1 : suggestions.length - 1,
		);
	} else if (key === "Enter") {
		preventedDefault = true;
		if (activeIndex >= 0 && activeIndex < suggestions.length) {
			actions.handleSelectItem(suggestions[activeIndex]);
		} else {
			actions.setIsDropdownOpen(false);
		}
		actions.onEnterKey?.();
	} else if (key === "Escape") {
		actions.setIsDropdownOpen(false);
	}

	return { preventDefault: preventedDefault };
}

// ── Тесты ──────────────────────────────────────────────────────────────────────

describe("LookupField: клавиатурная навигация", () => {
	it("ArrowDown при закрытом dropdown → вызывает handleQuickSelect", () => {
		const handleQuickSelect = vi.fn();
		simulateKeyDown(
			"ArrowDown",
			{
				isDropdownOpen: false,
				suggestions: [],
				activeIndex: -1,
				disabled: false,
			},
			{
				setActiveIndex: vi.fn(),
				setIsDropdownOpen: vi.fn(),
				handleQuickSelect,
				handleSelectItem: vi.fn(),
			},
		);
		expect(handleQuickSelect).toHaveBeenCalledOnce();
	});

	it("ArrowDown при закрытом dropdown → preventDefault=true", () => {
		const result = simulateKeyDown(
			"ArrowDown",
			{
				isDropdownOpen: false,
				suggestions: [],
				activeIndex: -1,
				disabled: false,
			},
			{
				setActiveIndex: vi.fn(),
				setIsDropdownOpen: vi.fn(),
				handleQuickSelect: vi.fn(),
				handleSelectItem: vi.fn(),
			},
		);
		expect(result.preventDefault).toBe(true);
	});

	it("ArrowDown disabled=true → handleQuickSelect НЕ вызывается", () => {
		const handleQuickSelect = vi.fn();
		simulateKeyDown(
			"ArrowDown",
			{
				isDropdownOpen: false,
				suggestions: [],
				activeIndex: -1,
				disabled: true,
			},
			{
				setActiveIndex: vi.fn(),
				setIsDropdownOpen: vi.fn(),
				handleQuickSelect,
				handleSelectItem: vi.fn(),
			},
		);
		expect(handleQuickSelect).not.toHaveBeenCalled();
	});

	it("ArrowDown при открытом dropdown → инкрементирует activeIndex", () => {
		const setActiveIndex = vi.fn();
		const suggestions = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
		simulateKeyDown(
			"ArrowDown",
			{ isDropdownOpen: true, suggestions, activeIndex: 0, disabled: false },
			{
				setActiveIndex,
				setIsDropdownOpen: vi.fn(),
				handleQuickSelect: vi.fn(),
				handleSelectItem: vi.fn(),
			},
		);
		// setActiveIndex вызывается с функцией
		const fn = setActiveIndex.mock.calls[0][0] as (prev: number) => number;
		expect(fn(0)).toBe(1);
		expect(fn(2)).toBe(0); // цикл
	});

	it("ArrowUp при открытом dropdown → декрементирует activeIndex с циклом", () => {
		const setActiveIndex = vi.fn();
		const suggestions = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
		simulateKeyDown(
			"ArrowUp",
			{ isDropdownOpen: true, suggestions, activeIndex: 1, disabled: false },
			{
				setActiveIndex,
				setIsDropdownOpen: vi.fn(),
				handleQuickSelect: vi.fn(),
				handleSelectItem: vi.fn(),
			},
		);
		const fn = setActiveIndex.mock.calls[0][0] as (prev: number) => number;
		expect(fn(1)).toBe(0);
		expect(fn(0)).toBe(2); // цикл на последний
	});

	it("Enter при activeIndex≥0 → выбирает элемент из dropdown", () => {
		const handleSelectItem = vi.fn();
		const suggestions = [
			{ uuid: "x", name: "Alpha" },
			{ uuid: "y", name: "Beta" },
		];
		simulateKeyDown(
			"Enter",
			{ isDropdownOpen: true, suggestions, activeIndex: 1, disabled: false },
			{
				setActiveIndex: vi.fn(),
				setIsDropdownOpen: vi.fn(),
				handleQuickSelect: vi.fn(),
				handleSelectItem,
			},
		);
		expect(handleSelectItem).toHaveBeenCalledWith({
			uuid: "y",
			name: "Beta",
		});
	});

	it("Enter при activeIndex=-1 → закрывает dropdown без выбора", () => {
		const handleSelectItem = vi.fn();
		const setIsDropdownOpen = vi.fn();
		const suggestions = [{ uuid: "x" }];
		simulateKeyDown(
			"Enter",
			{ isDropdownOpen: true, suggestions, activeIndex: -1, disabled: false },
			{
				setActiveIndex: vi.fn(),
				setIsDropdownOpen,
				handleQuickSelect: vi.fn(),
				handleSelectItem,
			},
		);
		expect(handleSelectItem).not.toHaveBeenCalled();
		expect(setIsDropdownOpen).toHaveBeenCalledWith(false);
	});

	it("Enter без dropdown → вызывает onEnterKey", () => {
		const onEnterKey = vi.fn();
		simulateKeyDown(
			"Enter",
			{
				isDropdownOpen: false,
				suggestions: [],
				activeIndex: -1,
				disabled: false,
			},
			{
				setActiveIndex: vi.fn(),
				setIsDropdownOpen: vi.fn(),
				handleQuickSelect: vi.fn(),
				handleSelectItem: vi.fn(),
				onEnterKey,
			},
		);
		expect(onEnterKey).toHaveBeenCalledOnce();
	});

	it("Escape → закрывает dropdown", () => {
		const setIsDropdownOpen = vi.fn();
		simulateKeyDown(
			"Escape",
			{
				isDropdownOpen: true,
				suggestions: [{ uuid: "a" }],
				activeIndex: -1,
				disabled: false,
			},
			{
				setActiveIndex: vi.fn(),
				setIsDropdownOpen,
				handleQuickSelect: vi.fn(),
				handleSelectItem: vi.fn(),
			},
		);
		expect(setIsDropdownOpen).toHaveBeenCalledWith(false);
	});
});
