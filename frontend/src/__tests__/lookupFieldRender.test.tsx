/**
 * LookupField (RTL): убедиться, что ArrowDown/ArrowUp/Enter реально работают
 * на смонтированном компоненте — выделяют активный пункт dropdown и выбирают
 * значение по Enter.
 */
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("src/services/offlineDataService", () => ({
	fetchList: vi.fn(),
}));
vi.mock("src/app", () => ({
	useAppContext: () => ({ windows: { addPane: vi.fn() } }),
}));
vi.mock("src/hooks/useDirtyHighlight", () => ({
	useFieldDirty: () => ({}),
	// LookupField читает контекст состояния ячейки (required/error) —
	// в тесте отдаём пустое состояние.
	useCellFieldState: () => ({}),
}));
vi.mock("src/registry/modelRegistry", () => ({
	getByEndpoint: () => null,
}));

import LookupField from "src/components/Field/LookupField";
import { fetchList } from "src/services/offlineDataService";

const ITEMS = [
	{ uuid: "a", name: "Alpha" },
	{ uuid: "b", name: "Beta" },
	{ uuid: "c", name: "Gamma" },
];

describe("LookupField — клавиатурная навигация (RTL)", () => {
	beforeEach(() => {
		vi.mocked(fetchList).mockReset();
		vi.mocked(fetchList).mockResolvedValue({ items: ITEMS, total: ITEMS.length, nextCursor: null, hasMore: false, fromCache: false });
		// jsdom не реализует scrollIntoView
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(Element.prototype as any).scrollIntoView = vi.fn();
	});

	it("ArrowDown открывает «Быстрый выбор», затем Up/Down меняют активный пункт, Enter выбирает", async () => {
		const onSelect = vi.fn();
		render(
			<LookupField
				name="testField"
				endpoint="counterparties"
				onSelect={onSelect}
			/>,
		);
		const input = screen.getByRole("combobox");
		input.focus();
		expect(document.activeElement).toBe(input);

		// ArrowDown при закрытом dropdown → QuickSelect → fetch
		await act(async () => {
			fireEvent.keyDown(input, { key: "ArrowDown" });
			await Promise.resolve();
		});
		expect(fetchList).toHaveBeenCalledTimes(1);

		// После загрузки появляется dropdown с активным первым пунктом
		const items = await screen.findAllByText(/Alpha|Beta|Gamma/);
		expect(items.length).toBe(3);

		// Первый пункт уже выделен (activeIndex=0)
		const activeBeforeDown = document.querySelector('[class*="LookupDropdownItemActive"]');
		expect(activeBeforeDown?.textContent).toContain("Alpha");

		// ArrowDown → выделяет Beta
		await act(async () => {
			fireEvent.keyDown(input, { key: "ArrowDown" });
		});
		const activeAfterDown = document.querySelector('[class*="LookupDropdownItemActive"]');
		expect(activeAfterDown?.textContent).toContain("Beta");

		// ArrowDown → Gamma
		await act(async () => {
			fireEvent.keyDown(input, { key: "ArrowDown" });
		});
		expect(document.querySelector('[class*="LookupDropdownItemActive"]')?.textContent).toContain("Gamma");

		// ArrowUp → Beta
		await act(async () => {
			fireEvent.keyDown(input, { key: "ArrowUp" });
		});
		expect(document.querySelector('[class*="LookupDropdownItemActive"]')?.textContent).toContain("Beta");

		// Enter → выбор Beta
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});
		expect(onSelect).toHaveBeenCalledWith("b", "Beta", expect.objectContaining({ uuid: "b" }));
	});
});
