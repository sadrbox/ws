/**
 * Отметка принадлежит СТРОКЕ, а не её номеру (17.09).
 *
 * ЖИВОЙ СЛУЧАЙ. В «Базах», «Сеансах» и «Соединениях» `id` строки — порядковый номер в ответе. Сняли сеанс — список
 * перечитан, номера сдвинулись, и галочка осталась на прежнем номере, то есть переехала на соседнюю строку.
 */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";
import { remapActiveRow, remapSelection, rowIdentities } from "src/components/Table/services";

const columns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

// Как в «Сеансах»: uuid — постоянный ключ, id — номер по порядку.
const numbered = (names: string[]): TDataItem[] => names.map((n, i) => ({ id: i + 1, uuid: n, name: n }));
const ALL = ["Кассир", "Кладовщик", "Бухгалтер", "Аудитор"];

const Harness = ({ onSelectionChange }: { onSelectionChange: (s: Set<number>, rows: TDataItem[]) => void }) => {
	const [names, setNames] = useState(ALL);
	return (
		<>
			<button type="button" data-testid="drop-first" onClick={() => setNames((v) => v.filter((n) => n !== "Кассир"))}>снять первый</button>
			<Table {...buildStaticTableProps({
				componentName: "TestRowIdentity", rows: numbered(names), columns: columns(), setColumns: () => {},
				selectable: true, onSelectionChange,
			})} />
		</>
	);
};

describe("Table: отметки после исчезновения строки", () => {
	it("строка ушла — отметка остаётся на своей строке, а не на её бывшем номере", () => {
		const onSelectionChange = vi.fn();
		const { container, getByTestId } = render(<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>);
		const rowOf = (name: string) => Array.from(container.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(name))!;
		const boxOf = (name: string) => rowOf(name).querySelector<HTMLInputElement>('input[type="checkbox"]')!;

		fireEvent.click(boxOf("Бухгалтер"));
		expect(boxOf("Бухгалтер").checked).toBe(true);

		// Первая строка исчезла (сеанс сняли, базу убрали) — номера сдвинулись на единицу.
		fireEvent.click(getByTestId("drop-first"));
		expect(boxOf("Бухгалтер").checked).toBe(true);
		expect(boxOf("Кладовщик").checked).toBe(false);
		expect(boxOf("Аудитор").checked).toBe(false);
		// Наружу уходит новый номер той же строки.
		const last = onSelectionChange.mock.calls.at(-1)!;
		const picked = (last[1] as TDataItem[]).filter((r) => (last[0] as Set<number>).has(Number(r.id))).map((r) => r.uuid);
		expect(picked).toEqual(["Бухгалтер"]);
	});

	it("отмеченная строка исчезла — отметка снимается, а не переходит на соседнюю", () => {
		const onSelectionChange = vi.fn();
		const { container, getByTestId } = render(<TestWrapper><Harness onSelectionChange={onSelectionChange} /></TestWrapper>);
		const boxOf = (name: string) => Array.from(container.querySelectorAll("tbody tr"))
			.find((tr) => tr.textContent?.includes(name))!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

		fireEvent.click(boxOf("Кассир"));
		fireEvent.click(getByTestId("drop-first"));
		expect(container.querySelectorAll('tbody input[type="checkbox"]:checked')).toHaveLength(0);
	});
});

describe("правила переноса (services)", () => {
	const rows = (names: string[]) => numbered(names).map((r) => ({ id: Number(r.id), uuid: String(r.uuid) }));
	const was = rowIdentities(rows(ALL));
	const after = rows(ALL.filter((n) => n !== "Кассир"));

	it("номер отмеченной строки переезжает вместе со строкой", () => {
		expect([...(remapSelection(new Set([3]), was, after, false) ?? [])]).toEqual([2]);
	});

	it("строки не стало — отметка снимается", () => {
		expect([...(remapSelection(new Set([1, 3]), was, after, false) ?? [])]).toEqual([2]);
	});

	it("при поиске и отборе отметка скрытой строки остаётся", () => {
		expect([...(remapSelection(new Set([1, 3]), was, after, true) ?? [])].sort()).toEqual([1, 2]);
	});

	it("ничего не сдвинулось — набор не трогаем", () => {
		expect(remapSelection(new Set([2]), was, rows(ALL), false)).toBeNull();
		expect(remapSelection(new Set(), was, after, false)).toBeNull();
		// Строки ещё не пришли — отметки не чистим.
		expect(remapSelection(new Set([1]), was, [], false)).toBeNull();
	});

	it("строка без постоянного ключа судится по номеру, как раньше", () => {
		const noKeys = [{ id: 1 }, { id: 2 }];
		expect(remapSelection(new Set([1, 5]), new Map(), noKeys, false)).toEqual(new Set([1]));
		expect(remapSelection(new Set([1, 5]), new Map(), noKeys, true)).toBeNull();
	});

	it("активная строка переезжает так же и снимается, когда строки не стало", () => {
		expect(remapActiveRow(3, was, after, false)).toBe(2);
		expect(remapActiveRow(1, was, after, false)).toBeNull();
		expect(remapActiveRow(1, was, after, true)).toBeUndefined();
		expect(remapActiveRow(null, was, after, false)).toBeUndefined();
	});
});
