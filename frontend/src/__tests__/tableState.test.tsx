// Состояние таблицы — одна запись на таблицу (28.09, components/Table/tableState.ts): колонки, сортировка, быстрый
// поиск, отборы с периодом и вид списка. Поиск и отборы теперь хранятся, как сортировка: остаются, пока пользователь
// их не изменит. Прежние ключи (table_columns_*, table_view_*, listPaneLayout:*) переносятся при первом чтении.
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTableState, saveTableColumns, writeTableState } from "src/components/Table/tableState";
import { getModelColumns } from "src/components/Table/services";
import { useTableViewState } from "src/hooks/useTableViewState";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import Table from "src/components/Table";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import type { TColumn, TDataItem } from "src/components/Table/types";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const raw = (name: string) => JSON.parse(localStorage.getItem(`table_state_${name}`) ?? "null") as Record<string, unknown> | null;

describe("хранилище состояния таблицы", () => {
	it("запись по частям: переданное заменяется, пустое убирается, прочее не трогается; пустое целиком — ключа нет", () => {
		writeTableState("T", { sort: { name: "asc" }, search: "альфа" });
		writeTableState("T", { filter: { dateRange: { value: { startDate: "2026-09-01" }, operator: "eq" } } });
		expect(readTableState("T")).toEqual({
			sort: { name: "asc" }, search: "альфа", filter: { dateRange: { value: { startDate: "2026-09-01" }, operator: "eq" } },
		});
		writeTableState("T", { search: "", filter: undefined });
		expect(readTableState("T")).toEqual({ sort: { name: "asc" } });
		writeTableState("T", { sort: {} });
		expect(localStorage.getItem("table_state_T")).toBeNull();
	});

	it("прочитанное проверяется: мусор и чужие поля отбрасываются, служебные колонки не хранятся", () => {
		localStorage.setItem("table_state_T", JSON.stringify({
			sort: { name: "up", date: "desc" }, search: 5, layout: "grid", junk: 1,
			columns: [{ identifier: "__rowActions", type: "actions" }, { identifier: "name", type: "string", width: "200px", visible: true }],
		}));
		expect(readTableState("T")).toEqual({
			sort: { date: "desc" },
			columns: [{ identifier: "name", type: "string", width: "200px", visible: true }],
		});
		localStorage.setItem("table_state_T", "{битый json");
		expect(readTableState("T")).toEqual({});
		expect(readTableState(undefined)).toEqual({});
	});

	it("колонки: сохраняется только настраиваемое, служебные — нет", () => {
		saveTableColumns("T", [
			{ identifier: "__pick", type: "boolean", visible: true, inlist: true },
			{ identifier: "amount", type: "number", width: "120px", visible: false, inlist: true, footer: "sum", hint: "x" },
		] as unknown as TColumn[]);
		expect(raw("T")).toEqual({ columns: [{ identifier: "amount", type: "number", width: "120px", visible: false }] });
	});

	it("прежние ключи переносятся в одну запись и удаляются; период становится отбором", () => {
		localStorage.setItem("table_columns_Old", JSON.stringify([
			{ identifier: "amount", type: "number", visible: false, width: "180px", footer: "sum" },
			{ identifier: "name", type: "string", visible: true, width: "300px" },
		]));
		localStorage.setItem("table_view_Old", JSON.stringify({ sort: { name: "desc" }, dateRange: { startDate: "2026-09-01", endDate: "2026-09-30" } }));
		localStorage.setItem("listPaneLayout:Old", "split");
		expect(readTableState("Old")).toEqual({
			columns: [
				{ identifier: "amount", type: "number", visible: false, width: "180px" },
				{ identifier: "name", type: "string", visible: true, width: "300px" },
			],
			sort: { name: "desc" },
			filter: { dateRange: { startDate: "2026-09-01", endDate: "2026-09-30" } },
			layout: "split",
		});
		expect(localStorage.getItem("table_columns_Old")).toBeNull();
		expect(localStorage.getItem("table_view_Old")).toBeNull();
		expect(localStorage.getItem("listPaneLayout:Old")).toBeNull();
		expect(raw("Old")?.layout).toBe("split");
	});

	it("колонки поменялись в определении — сбрасываются только они, поиск и сортировка остаются", () => {
		writeTableState("T", { search: "бета", sort: { name: "asc" } });
		saveTableColumns("T", [{ identifier: "name", type: "string", visible: true, inlist: true }] as unknown as TColumn[]);
		const cols = getModelColumns([
			{ identifier: "name", type: "string", visible: true, inlist: true },
			{ identifier: "code", type: "string", visible: true, inlist: true },
		] as unknown as TColumn[], "T");
		expect(cols.map((c) => c.identifier)).toEqual(["name", "code"]);
		expect(readTableState("T")).toEqual({ search: "бета", sort: { name: "asc" } });
	});
});

describe("сортировка, поиск и отборы с памятью (useTableViewState)", () => {
	it("выбранное остаётся после повторного открытия; сортировка по умолчанию не хранится", () => {
		const first = renderHook(() => useTableViewState("L", { sort: { id: "asc" } }));
		expect(first.result.current.sort).toEqual({ id: "asc" });
		expect(localStorage.getItem("table_state_L")).toBeNull();
		act(() => {
			first.result.current.setSort({ name: "desc" });
			first.result.current.setSearch("ноутбук");
			first.result.current.setFilter({ dateRange: { value: { startDate: "2026-09-01" }, operator: "eq" } });
		});
		first.unmount();

		const again = renderHook(() => useTableViewState("L", { sort: { id: "asc" } }));
		expect(again.result.current.sort).toEqual({ name: "desc" });
		expect(again.result.current.search).toBe("ноутбук");
		expect(again.result.current.filter).toEqual({ dateRange: { value: { startDate: "2026-09-01" }, operator: "eq" } });
		expect(again.result.current.sortRestored).toBe(true);

		// Пользователь очистил и вернул умолчание — это тоже его изменение: ничего не хранится.
		act(() => {
			again.result.current.setSort({ id: "asc" });
			again.result.current.setSearch("");
			again.result.current.setFilter(undefined);
		});
		expect(localStorage.getItem("table_state_L")).toBeNull();
	});

	it("без имени таблицы — ничего не хранится", () => {
		const h = renderHook(() => useTableViewState(undefined, { sort: { id: "asc" } }));
		act(() => h.result.current.setSearch("x"));
		expect(localStorage.length).toBe(0);
	});
});

describe("память поиска там, где она может ввести в заблуждение", () => {
	const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

	it("табличная часть: поиск документа возвращается тому же документу и не переходит в другой", () => {
		const a = renderHook(() => useTableViewState("SaleItems", { sort: { lineNumber: "asc" } }, { scope: "doc-A" }));
		act(() => a.result.current.setSearch("ноут"));
		a.unmount();

		// Другой документ: строки не отобраны, и запомненное для первого не стёрто (даже двойным эффектом StrictMode).
		const b = renderHook(() => useTableViewState("SaleItems", { sort: { lineNumber: "asc" } }, { scope: "doc-B" }), { wrapper: strict });
		expect(b.result.current.search).toBe("");
		b.unmount();
		expect(readTableState("SaleItems")).toMatchObject({ search: "ноут", searchScope: "doc-A" });

		const again = renderHook(() => useTableViewState("SaleItems", { sort: { lineNumber: "asc" } }, { scope: "doc-A" }));
		expect(again.result.current.search).toBe("ноут");
	});

	it("сортировка табличной части — общая: она ничего не прячет", () => {
		const a = renderHook(() => useTableViewState("SaleItems", { sort: { lineNumber: "asc" } }, { scope: "doc-A" }));
		act(() => a.result.current.setSort({ name: "asc" }));
		a.unmount();
		const b = renderHook(() => useTableViewState("SaleItems", { sort: { lineNumber: "asc" } }, { scope: "doc-B" }));
		expect(b.result.current.sort).toEqual({ name: "asc" });
	});

	it("незаписанный документ (владельца нет) — поиск живёт, пока открыт экран", () => {
		const h = renderHook(() => useTableViewState("SaleItems", {}, { scope: null }));
		act(() => h.result.current.setSearch("ноут"));
		expect(readTableState("SaleItems").search).toBeUndefined();
	});

	it("таблица, где отмеченное уходит в групповую операцию: поиск не восстанавливается и не хранится, сортировка — да", () => {
		writeTableState("Pick", { search: "buh" });
		const h = renderHook(() => useTableViewState("Pick", { sort: { baseKey: "asc" } }, { rememberFilters: false }));
		expect(h.result.current.search).toBe("");
		act(() => {
			h.result.current.setSearch("alma");
			h.result.current.setSort({ baseKey: "desc" });
		});
		expect(readTableState("Pick").search).toBe("buh");
		expect(readTableState("Pick").sort).toEqual({ baseKey: "desc" });
	});
});

describe("таблица открывается с сохранённым поиском", () => {
	const columns = [
		{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	] as unknown as TColumn[];
	const rows = [{ id: 1, uuid: "a", name: "Альфа" }, { id: 2, uuid: "b", name: "Бета" }] as TDataItem[];

	const Screen = () => {
		const view = useStaticTableView(rows, { name: "asc" }, "Saved");
		return <Table {...buildStaticTableProps({ componentName: "Saved", rows: view.rows, columns, setColumns: () => { }, sorting: view.sorting, search: view.search })} />;
	};

	it("строка поиска открыта со значением, строки отобраны — отбор не выглядит пропажей", () => {
		writeTableState("Saved", { search: "аль" });
		const { container } = render(<TestWrapper><Screen /></TestWrapper>);
		const input = container.querySelector<HTMLInputElement>('input[name="fastSearch"]');
		expect(input?.value).toBe("аль");
		const names = [...container.querySelectorAll("tbody td")].map((td) => td.textContent).filter(Boolean);
		expect(names).toContain("Альфа");
		expect(names).not.toContain("Бета");
	});

	it("без сохранённого поиска строка поиска закрыта, как раньше", () => {
		const { container } = render(<TestWrapper><Screen /></TestWrapper>);
		expect(container.querySelector('input[name="fastSearch"]')).toBeNull();
	});
});
