/**
 * Выделение строк протягиванием мышью (Table → useRowDragSelect): нажали на строке, повели — отмечен диапазон.
 *
 * В тестовой среде нет раскладки, поэтому «строку под курсором» (document.elementFromPoint) задаёт тест.
 */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";

const columns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const rows: TDataItem[] = [1, 2, 3, 4, 5, 6].map((id) => ({ id, uuid: `r${id}`, name: `Строка ${id}` }));

let pointed: Element | null = null;
// Своё свойство документа поверх метода прототипа; удаление возвращает метод прототипа.
beforeEach(() => {
	pointed = null;
	Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => pointed });
});
afterEach(() => {
	delete (document as unknown as Record<string, unknown>).elementFromPoint;
});

const setup = (extra: Record<string, unknown> = {}) => {
	let picked: number[] = [];
	const base = buildStaticTableProps({
		componentName: "TestRowDragSelect", rows, columns: columns(), setColumns: () => {},
		selectable: true,
		onSelectionChange: (sel) => { picked = [...sel].sort((a, b) => a - b); },
	});
	const utils = render(<TestWrapper><Table {...base} {...extra} /></TestWrapper>);
	const row = (id: number) => utils.container.querySelector<HTMLTableRowElement>(`tbody tr[data-row-id="${id}"]`)!;
	const cell = (id: number) => row(id).querySelector<HTMLElement>('td[data-col-id="name"] div')!;
	/** Нажать на строке `from`, провести через `via…` и отпустить (или не отпускать). */
	const drag = (from: number, via: number[], opts: { ctrl?: boolean; release?: boolean } = {}) => {
		fireEvent.mouseDown(cell(from), { button: 0, ctrlKey: !!opts.ctrl });
		for (const id of via) {
			pointed = cell(id);
			fireEvent.mouseMove(document, { buttons: 1, clientX: 10, clientY: 10 });
		}
		if (opts.release !== false) fireEvent.mouseUp(document, { button: 0 });
	};
	const selectedRows = () => Array.from(utils.container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-selected]"))
		.map((tr) => Number(tr.dataset.rowId));
	return { ...utils, row, cell, drag, selectedRows, picked: () => picked };
};

describe("Выделение строк протягиванием мышью", () => {
	it("протянули со 2-й строки до 4-й — отмечены 2, 3, 4, а 4-я стала активной", () => {
		const t = setup();
		t.drag(2, [3, 4]);
		expect(t.picked()).toEqual([2, 3, 4]);
		expect(t.selectedRows()).toEqual([2, 3, 4]);
		expect(t.row(4).dataset.active).toBe("true");
	});

	it("вверх — тот же диапазон; вернулись назад — диапазон сжимается", () => {
		const t = setup();
		t.drag(5, [4, 3, 4], { release: false });
		expect(t.picked()).toEqual([4, 5]);
		fireEvent.mouseUp(document, { button: 0 });
		expect(t.picked()).toEqual([4, 5]);
	});

	it("простой щелчок без перехода на другую строку ничего не отмечает", () => {
		const t = setup();
		t.drag(3, [3]);
		expect(t.picked()).toEqual([]);
		expect(t.selectedRows()).toEqual([]);
	});

	it("без Ctrl новый диапазон заменяет прежний, с Ctrl — добавляется к нему", () => {
		const t = setup();
		t.drag(1, [2]);
		t.drag(4, [5]);
		expect(t.picked()).toEqual([4, 5]);
		t.drag(1, [2], { ctrl: true });
		expect(t.picked()).toEqual([1, 2, 4, 5]);
	});

	it("Escape во время протягивания возвращает отметки, какими они были", () => {
		const t = setup();
		t.drag(1, [2]);
		t.drag(3, [4, 5], { release: false });
		expect(t.picked()).toEqual([3, 4, 5]);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(t.picked()).toEqual([1, 2]);
		// Отпускание кнопки после отмены ничего не меняет.
		pointed = t.cell(6);
		fireEvent.mouseMove(document, { buttons: 1 });
		fireEvent.mouseUp(document, { button: 0 });
		expect(t.picked()).toEqual([1, 2]);
	});

	it("с галочки протягивание не начинается — у неё своё поведение мыши", () => {
		const t = setup();
		const box = t.row(2).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
		fireEvent.mouseDown(box, { button: 0 });
		pointed = t.cell(4);
		fireEvent.mouseMove(document, { buttons: 1 });
		fireEvent.mouseUp(document, { button: 0 });
		expect(t.picked()).toEqual([]);
	});

	it("кнопку отпустили за пределами окна — следующее движение без нажатой кнопки завершает протягивание", () => {
		const t = setup();
		t.drag(1, [3], { release: false });
		pointed = t.cell(6);
		fireEvent.mouseMove(document, { buttons: 0 });
		expect(t.picked()).toEqual([1, 2, 3]);
		pointed = t.cell(5);
		fireEvent.mouseMove(document, { buttons: 1 });
		expect(t.picked()).toEqual([1, 2, 3]);
	});

	it("таблица выбора (variant select) и отметки, заблокированные операцией, протягиванием не выделяются", () => {
		const select = setup({ variant: "select" });
		select.drag(1, [3]);
		expect(select.selectedRows()).toEqual([]);
		select.unmount();

		const locked = setup({ selectionLocked: true });
		locked.drag(1, [3]);
		expect(locked.picked()).toEqual([]);
	});
});
