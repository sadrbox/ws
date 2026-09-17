/**
 * Быстрый поиск и отметки строк.
 *
 * ЖИВОЙ СЛУЧАЙ (17.09). «Пользователи баз» → групповое создание пользователя, шаг «3. Права»:
 * поиск оставлял одну роль, отметка этой роли включала режим «выбраны все записи», и после
 * снятия поиска новому пользователю выдавались ВСЕ роли — человек этого не просил.
 */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";

const columns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const allRows: TDataItem[] = [
	{ id: 1, uuid: "r1", role: "ПолныеПрава" },
	{ id: 2, uuid: "r2", role: "Кассир" },
	{ id: 3, uuid: "r3", role: "Кладовщик" },
	{ id: 4, uuid: "r4", role: "Бухгалтер" },
	{ id: 5, uuid: "r5", role: "Аудитор" },
];

// Мини-аналог useStaticTableView: быстрый поиск отбирает строки на клиенте.
const Harness = ({ onSelectionChange, source = allRows }: {
	onSelectionChange: (s: Set<number>, rows: TDataItem[]) => void;
	/** Данные списка: тест подменяет их, чтобы строка «исчезла» (удалена, перечитан список). */
	source?: TDataItem[];
}) => {
	const [query, setQuery] = useState("");
	const rows = query ? source.filter((r) => String(r.role).toLowerCase().includes(query.toLowerCase())) : source;
	return (
		<>
			<button type="button" data-testid="search-one" onClick={() => setQuery("Аудитор")}>искать</button>
			<button type="button" data-testid="search-two" onClick={() => setQuery("Кассир")}>искать ещё</button>
			<button type="button" data-testid="search-clear" onClick={() => setQuery("")}>сбросить</button>
			<Table {...buildStaticTableProps({
				componentName: "TestSearchSelection", rows, columns: columns(), setColumns: () => {},
				search: { value: query, onChange: setQuery },
				selectable: true, disableActiveRow: true, onSelectionChange,
			})} />
		</>
	);
};

const lastSelection = (spy: ReturnType<typeof vi.fn>): number[] => {
	const call = spy.mock.calls.at(-1);
	return call ? [...(call[0] as Set<number>)].sort((a, b) => a - b) : [];
};

const rowBoxes = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'));
const headBox = (container: HTMLElement) =>
	container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;

describe("Table: отметки при быстром поиске", () => {
	it("отметка единственной найденной строки не выбирает весь список", () => {
		const onSelectionChange = vi.fn();
		const { container, getByTestId } = render(<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>);

		fireEvent.click(getByTestId("search-one"));
		expect(rowBoxes(container)).toHaveLength(1);

		fireEvent.click(rowBoxes(container)[0]);
		expect(lastSelection(onSelectionChange)).toEqual([5]);

		fireEvent.click(getByTestId("search-clear"));
		expect(rowBoxes(container)).toHaveLength(5);
		expect(lastSelection(onSelectionChange)).toEqual([5]);
	});

	it("«выбрать все» при поиске отмечает только найденное", () => {
		const onSelectionChange = vi.fn();
		const { container, getByTestId } = render(<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>);

		fireEvent.click(getByTestId("search-one"));
		fireEvent.click(headBox(container));
		expect(lastSelection(onSelectionChange)).toEqual([5]);

		fireEvent.click(getByTestId("search-clear"));
		expect(lastSelection(onSelectionChange)).toEqual([5]);
	});

	it("выбранное до поиска не теряется, когда список сужается", () => {
		const onSelectionChange = vi.fn();
		const { container, getByTestId } = render(<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>);

		// «Выбрать все» на полном списке — режим «все записи».
		fireEvent.click(headBox(container));
		expect(lastSelection(onSelectionChange)).toEqual([1, 2, 3, 4, 5]);

		fireEvent.click(getByTestId("search-one"));
		expect(lastSelection(onSelectionChange)).toEqual([1, 2, 3, 4, 5]);

		// Снятие найденной строки убирает только её.
		fireEvent.click(rowBoxes(container)[0]);
		expect(lastSelection(onSelectionChange)).toEqual([1, 2, 3, 4]);
	});

	it("без поиска отметка всех строк по одной по-прежнему выбирает весь список", () => {
		const onSelectionChange = vi.fn();
		const { container } = render(<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>);
		for (const box of rowBoxes(container)) fireEvent.click(box);
		expect(lastSelection(onSelectionChange)).toEqual([1, 2, 3, 4, 5]);
	});
});

/**
 * ЖИВОЙ СЛУЧАЙ (17.09). Роли отмечали по одной, находя каждую поиском: набрал «Кассир» — отметил,
 * набрал «Кладовщик» — отметил, и первая галочка исчезала. Отметки снимала чистка «строк, которых
 * больше нет»: при поиске строка не исчезла, а скрыта.
 */
describe("Table: отметки переживают смену быстрого поиска", () => {
	it("отмеченное прежним поиском остаётся при новом поиске", () => {
		const onSelectionChange = vi.fn();
		const { container, getByTestId } = render(<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>);

		fireEvent.click(getByTestId("search-one"));
		fireEvent.click(rowBoxes(container)[0]);
		expect(lastSelection(onSelectionChange)).toEqual([5]);

		// Ищем другую роль — прежняя отметка не должна сняться.
		fireEvent.click(getByTestId("search-two"));
		expect(rowBoxes(container)).toHaveLength(1);
		expect(lastSelection(onSelectionChange)).toEqual([5]);

		fireEvent.click(rowBoxes(container)[0]);
		expect(lastSelection(onSelectionChange)).toEqual([2, 5]);

		fireEvent.click(getByTestId("search-clear"));
		expect(lastSelection(onSelectionChange)).toEqual([2, 5]);
	});

	it("после снятия поиска отметки исчезнувших строк всё же снимаются", () => {
		const onSelectionChange = vi.fn();
		const { container, getByTestId, rerender } = render(
			<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>,
		);
		fireEvent.click(rowBoxes(container)[0]);
		fireEvent.click(rowBoxes(container)[1]);
		expect(lastSelection(onSelectionChange)).toEqual([1, 2]);

		// Строка 1 ушла из данных (удалена, перечитан список) — её отметка не должна остаться.
		rerender(<TestWrapper><Harness onSelectionChange={onSelectionChange} source={allRows.slice(1)} /></TestWrapper>);
		expect(lastSelection(onSelectionChange)).toEqual([2]);
		expect(getByTestId("search-clear")).toBeTruthy();
	});
});
