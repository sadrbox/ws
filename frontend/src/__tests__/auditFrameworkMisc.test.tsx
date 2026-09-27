/**
 * Регрессия аудита 26.09 (И17, О8): клавиатура вкладок, SegmentedControl без выбранного
 * варианта, кэш колонок, порог протягивания, завершение ресайза колонки.
 */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import Tabs from "src/components/Tabs";
import { SegmentedControl } from "src/components/SegmentedControl";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import type { TColumn, TDataItem } from "src/components/Table/types";

afterEach(() => { cleanup(); localStorage.clear(); });

describe("Tabs (И17, О8)", () => {
	const tabs = [
		{ id: "a", label: "Основное", component: <div>A</div> },
		{ id: "b", label: "Позиции", component: <div>B</div> },
		{ id: "c", label: "Файлы", component: <div>C</div> },
	];

	it("← / → / Home / End переключают вкладки и переводят фокус", () => {
		const onTabChange = vi.fn();
		render(<Tabs tabs={tabs} onTabChange={onTabChange} />);
		const [a, b, c] = screen.getAllByRole("tab");
		a.focus();
		fireEvent.keyDown(a, { key: "ArrowRight" });
		expect(b.getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(b);
		fireEvent.keyDown(b, { key: "End" });
		expect(c.getAttribute("aria-selected")).toBe("true");
		fireEvent.keyDown(c, { key: "ArrowRight" });
		expect(a.getAttribute("aria-selected")).toBe("true");
		fireEvent.keyDown(a, { key: "ArrowLeft" });
		expect(c.getAttribute("aria-selected")).toBe("true");
		expect(onTabChange).toHaveBeenLastCalledWith("c");
	});

	it("щелчок зовёт АКТУАЛЬНЫЙ onTabChange (без устаревшего замыкания)", () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = render(<Tabs tabs={tabs} onTabChange={first} />);
		rerender(<Tabs tabs={tabs} onTabChange={second} />);
		fireEvent.click(screen.getAllByRole("tab")[1]);
		expect(second).toHaveBeenCalledWith("b");
		expect(first).not.toHaveBeenCalled();
	});

	it("aria-controls ведёт на существующую панель, id не повторяются между экземплярами", () => {
		render(<div><Tabs tabs={tabs} /><Tabs tabs={tabs} /></div>);
		const all = screen.getAllByRole("tab");
		const ids = all.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const t of all) expect(document.getElementById(t.getAttribute("aria-controls")!)).not.toBeNull();
	});
});

describe("SegmentedControl (И17)", () => {
	it("значения нет среди вариантов — первый вариант достижим с клавиатуры", async () => {
		const user = userEvent.setup();
		render(<SegmentedControl name="s" label="L" value={"X" as never} options={[{ value: "A", label: "A" }, { value: "B", label: "B" }] as never} onChange={() => { }} />);
		await user.tab();
		expect(document.activeElement?.getAttribute("role")).toBe("radio");
	});
});

describe("Кэш колонок (И17)", () => {
	it("из кэша — ширина и видимость, новые свойства колонок — из JSON", () => {
		const json = [
			{ identifier: "name", type: "string", visible: true, width: "200px" },
			{ identifier: "amount", type: "number", visible: true, width: "120px", footer: "sum", decimals: 2 },
		] as unknown as TColumn[];
		localStorage.setItem("table_columns_AuditCols", JSON.stringify([
			{ identifier: "amount", type: "number", visible: false, width: "180px" },
			{ identifier: "name", type: "string", visible: true, width: "300px" },
		]));
		const cols = getModelColumns(json, "AuditCols");
		expect(cols.map((c) => c.identifier)).toEqual(["amount", "name"]); // порядок пользователя
		const amount = cols[0] as TColumn & { footer?: string; decimals?: number };
		expect(amount.width).toBe("180px");
		expect(amount.visible).toBe(false);
		expect(amount.footer).toBe("sum");
		expect(amount.decimals).toBe(2);
	});
});

describe("Протягивание и ресайз (И17)", () => {
	const columns = [{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true }] as unknown as TColumn[];
	const rows = [1, 2, 3].map((id) => ({ id, uuid: `r${id}`, name: `Строка ${id}` })) as TDataItem[];

	it("дрожание мыши у границы строки (меньше порога) не начинает протягивание", () => {
		let picked: number[] = [];
		const base = buildStaticTableProps({
			componentName: "AuditDrag", rows, columns, setColumns: () => { }, selectable: true,
			onSelectionChange: (sel) => { picked = [...sel]; },
		});
		const { container } = render(<TestWrapper><Table {...base} /></TestWrapper>);
		const cell = (id: number) => container.querySelector<HTMLElement>(`tbody tr[data-row-id="${id}"] td[data-col-id="name"] div`)!;
		let pointed: Element | null = null;
		Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => pointed });
		try {
			fireEvent.mouseDown(cell(1), { button: 0, clientX: 50, clientY: 50 });
			pointed = cell(2);
			fireEvent.mouseMove(document, { buttons: 1, clientX: 51, clientY: 53 });
			fireEvent.mouseUp(document, { button: 0 });
			expect(picked).toEqual([]);
		} finally {
			delete (document as unknown as Record<string, unknown>).elementFromPoint;
		}
	});

	it("ресайз колонки завершается при потере фокуса окна", () => {
		const setColumns = vi.fn();
		const cols = [
			{ identifier: "name", type: "string", width: "200px", minWidth: "50px", visible: true, inlist: true },
			{ identifier: "code", type: "string", width: "100px", minWidth: "50px", visible: true, inlist: true },
		] as unknown as TColumn[];
		const { container } = render(<TestWrapper><Table {...buildStaticTableProps({ componentName: "AuditResize", rows, columns: cols, setColumns })} /></TestWrapper>);
		const handle = container.querySelector<HTMLElement>('thead th [class*="Resiz"], thead th [class*="resiz"]');
		expect(handle).not.toBeNull();
		fireEvent.mouseDown(handle!, { button: 0, clientX: 200 });
		expect(document.body.style.cursor).toBe("col-resize");
		fireEvent.blur(window);
		expect(document.body.style.cursor).toBe("");
		expect(setColumns).toHaveBeenCalledTimes(1);
	});
});
