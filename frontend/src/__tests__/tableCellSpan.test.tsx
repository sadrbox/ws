// Общий вид ячейки (28.09): текстовое значение в ячейке Table/SubTableSheets — дочерний <span> у TableBodyCell,
// в том числе когда его вернул кастомный renderCell строкой или числом. На `.TableBodyCell > span` держатся отступ
// от рамки, многоточие и сжатие; узел из renderCell (свой span, кнопка) повторно не оборачивается.
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import Table from "src/components/Table";
import SubTableSheets from "src/components/SubTableSheets";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { wrapCellText } from "src/components/Table/services";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import type { TColumn, TDataItem } from "src/components/Table/types";

afterEach(cleanup);

const columns = [
	{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "qty", type: "number", width: "100px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "note", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[];
const rows = [{ id: 1, uuid: "a", name: "Альфа", qty: 3, note: "x" }] as TDataItem[];

/** Строка — текстом, число — числом, note — своим узлом-кнопкой. */
const renderCell = (row: TDataItem, col: TColumn) =>
	col.identifier === "name" ? `имя: ${String(row.name)}`
		: col.identifier === "qty" ? 42
			: <button type="button">действие</button>;

const cellChildren = (container: HTMLElement, colId: string) => {
	const cell = container.querySelector(`td[data-col-id="${colId}"] > div, td > div[data-col="${colId}"]`)
		?? [...container.querySelectorAll("tbody td")].find((td) => td.textContent?.includes(colId === "name" ? "имя:" : colId === "qty" ? "42" : "действие"))?.firstElementChild;
	return cell ? [...cell.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim())) : [];
};

describe("ячейка: текст из renderCell — в span", () => {
	it("wrapCellText: строка и число — в span, узел и пустое — как есть", () => {
		const { container } = render(<div>{wrapCellText("текст")}{wrapCellText(7)}</div>);
		expect([...container.firstElementChild!.children].map((e) => e.tagName)).toEqual(["SPAN", "SPAN"]);
		const node = <b>уже узел</b>;
		expect(wrapCellText(node)).toBe(node);
		expect(wrapCellText(undefined)).toBeUndefined();
		expect(wrapCellText(null)).toBeNull();
	});

	it("Table: строка и число из renderCell — единственный дочерний span ячейки; кнопка не оборачивается", () => {
		const props = buildStaticTableProps({ componentName: "CellSpan", rows, columns, setColumns: () => { }, renderCell });
		const { container } = render(<TestWrapper><Table {...props} /></TestWrapper>);
		for (const [col, text] of [["name", "имя: Альфа"], ["qty", "42"]] as const) {
			const kids = cellChildren(container, col);
			expect(kids).toHaveLength(1);
			expect((kids[0] as HTMLElement).tagName).toBe("SPAN");
			expect(kids[0].textContent).toBe(text);
		}
		const note = cellChildren(container, "note");
		expect((note[0] as HTMLElement).tagName).toBe("BUTTON");
	});

	it("SubTableSheets: так же, как Table", () => {
		const { container } = render(<TestWrapper><SubTableSheets columns={columns} rows={rows} renderCell={renderCell} /></TestWrapper>);
		const tds = [...container.querySelectorAll("tbody td")];
		const byText = (t: string) => tds.find((td) => td.textContent === t)!.firstElementChild!;
		for (const t of ["имя: Альфа", "42"]) {
			const cell = byText(t);
			const kids = [...cell.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
			expect(kids).toHaveLength(1);
			expect((kids[0] as HTMLElement).tagName).toBe("SPAN");
		}
		expect(byText("действие").firstElementChild!.tagName).toBe("BUTTON");
	});
});
