/**
 * Отметки на время операции: видны, но недоступны.
 *
 * ЖИВОЙ СЛУЧАЙ (13.09). В карточке «Пользователь базы» на время записи прав колонку
 * отметок прятали целиком: таблица перестраивалась, колонки съезжали, а по окончании
 * прыгали обратно — и терялось, где что было отмечено. Недоступный чекбокс говорит то же
 * самое («сейчас менять нельзя»), не двигая разметку.
 */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";

const columns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);
const rows: TDataItem[] = [
	{ id: 1, uuid: "r1", role: "ПолныеПрава" },
	{ id: 2, uuid: "r2", role: "Кассир" },
];

const show = (selectionLocked: boolean, onSelectionChange = vi.fn()) => render(
	<TestWrapper>
		<Table {...buildStaticTableProps({
			componentName: "TestLockedTable", rows, columns: columns(), setColumns: () => {},
			selectable: true, selectionLocked, onSelectionChange,
		})} />
	</TestWrapper>,
);

describe("Table: отметки заблокированы, но не спрятаны", () => {
	it("колонка отметок на месте — разметка не перестраивается", () => {
		const { container } = show(true);
		// Чекбокс в шапке и по одному на строку: колонка не исчезла.
		expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
	});

	it("все отметки недоступны — и в шапке, и в строках", () => {
		const { container } = show(true);
		const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
		expect(boxes.every((b) => b.disabled)).toBe(true);
	});

	it("без блокировки отметки работают как прежде", () => {
		const { container } = show(false);
		const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
		expect(boxes.some((b) => !b.disabled)).toBe(true);
	});

	it("щелчок по недоступной отметке ничего не меняет", () => {
		const onSelectionChange = vi.fn();
		const { container } = show(true, onSelectionChange);
		const row = container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')[0];
		fireEvent.click(row);
		// Судим по обработчику, а не по `checked`: jsdom переключает и недоступный контрол.
		const picked = onSelectionChange.mock.calls.some(([sel]) => (sel as Set<number>).size > 0);
		expect(picked).toBe(false);
	});
});
