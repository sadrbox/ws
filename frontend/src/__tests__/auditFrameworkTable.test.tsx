/**
 * Регрессия аудита 26.09 (И7, И8, И12, О6): клавиатура таблицы выбора, End за виртуальным
 * окном, итоги без колонки отметок, перенос отметок за O(n + m).
 */
import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import Table from "src/components/Table";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import { remapSelection, rowIdentities } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";

afterEach(() => cleanup());

const columns = [{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true }] as unknown as TColumn[];
const two = [{ id: 1, uuid: "a", name: "Альфа" }, { id: 2, uuid: "b", name: "Бета" }] as TDataItem[];

describe("Таблица выбора (И7)", () => {
	it("Enter и стрелки в поле ДРУГОЙ формы не перехватываются", () => {
		const onSelectItem = vi.fn();
		const props = { ...buildStaticTableProps({ componentName: "AuditSel1", rows: two, columns, setColumns: () => { } }), onSelectItem };
		const { container } = render(
			<TestWrapper>
				<div style={{ display: "none" }}><Table {...props} /></div>
				<textarea data-testid="ta" />
			</TestWrapper>,
		);
		const ta = container.querySelector("textarea")!;
		ta.focus();
		let notPrevented = false;
		act(() => { notPrevented = fireEvent.keyDown(ta, { key: "Enter" }); });
		expect(onSelectItem).not.toHaveBeenCalled();
		expect(notPrevented).toBe(true); // перевод строки не отменён
		act(() => { notPrevented = fireEvent.keyDown(ta, { key: "ArrowUp" }); });
		expect(notPrevented).toBe(true);
	});

	it("внутри своей таблицы ↓ и Enter по-прежнему выбирают строку", () => {
		const onSelectItem = vi.fn<(item: TDataItem) => void>();
		const props = { ...buildStaticTableProps({ componentName: "AuditSel2", rows: two, columns, setColumns: () => { } }), onSelectItem };
		const { container } = render(<TestWrapper><Table {...props} /></TestWrapper>);
		const scroller = container.querySelector('[tabindex="0"]') as HTMLElement;
		scroller.focus();
		act(() => { fireEvent.keyDown(scroller, { key: "ArrowDown" }); });
		act(() => { fireEvent.keyDown(scroller, { key: "Enter" }); });
		expect(onSelectItem).toHaveBeenCalledTimes(1);
		expect(onSelectItem.mock.calls[0][0].name).toBe("Бета");
	});
});

describe("Горячие клавиши списка (И8)", () => {
	it("Insert не создаёт запись, когда «Добавить» погашена (disableAdd)", () => {
		const openModelForm = vi.fn();
		const base = buildStaticTableProps({ componentName: "AuditIns", rows: two, columns, setColumns: () => { } });
		const props = { ...base, actions: { ...base.actions, openModelForm }, disableAdd: true };
		const { container } = render(<TestWrapper><Table {...props} /></TestWrapper>);
		const scroller = container.querySelector('[tabindex="0"]') as HTMLElement;
		act(() => { fireEvent.keyDown(scroller, { key: "Insert" }); });
		expect(openModelForm).not.toHaveBeenCalled();
	});

	it("смена запрета после монтирования учитывается (нет устаревшего замыкания)", () => {
		const onDelete = vi.fn();
		const base = buildStaticTableProps({ componentName: "AuditDel", rows: two, columns, setColumns: () => { } });
		const Harness = ({ ro }: { ro: boolean }) => <TestWrapper><Table {...base} selectable hideAddDelete={false} onDelete={onDelete} readonly={ro} /></TestWrapper>;
		const { container, rerender } = render(<Harness ro={false} />);
		const box = container.querySelector('tbody input[type="checkbox"]') as HTMLInputElement;
		fireEvent.click(box);
		rerender(<Harness ro />);
		const scroller = container.querySelector('[tabindex="0"]') as HTMLElement;
		act(() => { fireEvent.keyDown(scroller, { key: "Delete" }); });
		expect(onDelete).not.toHaveBeenCalled();
	});
});

describe("End за виртуальным окном (И12)", () => {
	it("End делает активной последнюю строку и прокручивает к ней", async () => {
		const rows = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, uuid: `u${i + 1}`, name: `N${i + 1}` })) as TDataItem[];
		const onActive = vi.fn<(row: TDataItem | null) => void>();
		const { container } = render(<TestWrapper><Table {...buildStaticTableProps({ componentName: "AuditEnd", rows, columns, setColumns: () => { }, onActiveRowChange: onActive })} /></TestWrapper>);
		const scroller = container.querySelector('[tabindex="0"]') as HTMLElement;
		scroller.focus();
		await act(async () => { await Promise.resolve(); fireEvent.keyDown(scroller, { key: "End" }); });
		expect(onActive.mock.calls.at(-1)?.[0]?.id).toBe(300);
		expect(scroller.scrollTop).toBeGreaterThan(0);
	});
});

describe("Итоги без колонки отметок (И12)", () => {
	it("при selectable=false ячеек подвала столько же, сколько колонок шапки", () => {
		const cols = [
			{ identifier: "name", type: "string", visible: true, inlist: true },
			{ identifier: "a", type: "number", visible: true, inlist: true, footer: "sum" },
			{ identifier: "b", type: "number", visible: true, inlist: true, footer: "sum" },
		] as unknown as TColumn[];
		const rows = [{ id: 1, uuid: "x", name: "X", a: 10, b: 7 }] as TDataItem[];
		const { container } = render(<TestWrapper><Table {...buildStaticTableProps({ componentName: "AuditFoot", rows, columns: cols, setColumns: () => { } })} selectable={false} /></TestWrapper>);
		const ths = container.querySelectorAll("thead th").length;
		const tds = Array.from(container.querySelectorAll("tfoot td"));
		expect(tds.length).toBe(ths);
		// «a» — вторая колонка: итог стоит под своим заголовком, а не под соседним.
		expect(tds[1].textContent).toContain("10");
	});
});

describe("Перенос отметок (О6)", () => {
	it("remapSelection на 5000 × 5000 — линейно", () => {
		const N = 5000;
		const rows = Array.from({ length: N }, (_, i) => ({ id: i + 1, uuid: `u${i}` }));
		const was = rowIdentities(rows);
		const sel = new Set(rows.map((r) => r.id));
		const t0 = performance.now();
		remapSelection(sel, was, rows.slice(1), false);
		expect(performance.now() - t0).toBeLessThan(1000);
	});
});
