/**
 * Сортировка по колонке — ДВОЙНЫМ щелчком по её заголовку.
 *
 * ЗАЧЕМ ИЗМЕНЕНО. Одиночный щелчок по шапке слишком дёшев для действия, которое перестраивает
 * весь список: задев заголовок мимо строки или при выделении, человек терял место, на котором
 * работал, и возвращался к нему вручную. Двойной щелчок — жест намеренный.
 *
 * Тест держит и то, что рядом: двойной щелчок по ГРАНИЦЕ колонки подбирает ширину и до
 * сортировки не доходит, а у колонки с `sortable: false` не работает ни один щелчок.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";

const columns = (): TColumn[] => ([
  { identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
  { identifier: "note", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true, sortable: false },
] as unknown as TColumn[]);

const rows: TDataItem[] = [
  { id: 1, uuid: "a", name: "Альфа", note: "первая" },
  { id: 2, uuid: "b", name: "Бета", note: "вторая" },
];

function renderTable(onSortChange: (s: Record<string, "asc" | "desc">) => void) {
  const props = buildStaticTableProps({
    componentName: "TestSortTable",
    rows,
    columns: columns(),
    setColumns: () => { },
    sorting: { sort: { name: "asc" }, onSortChange },
  });
  return render(<TestWrapper><Table {...props} /></TestWrapper>);
}

const headers = (container: HTMLElement) => Array.from(container.querySelectorAll("thead th"));

describe("Table: сортировка по двойному щелчку", () => {
  it("одиночный щелчок список не перестраивает", () => {
    const onSortChange = vi.fn();
    const { container } = renderTable(onSortChange);

    fireEvent.click(headers(container)[0]);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("двойной щелчок сортирует и переворачивает порядок", () => {
    const onSortChange = vi.fn();
    const { container } = renderTable(onSortChange);

    // Колонка уже отсортирована по возрастанию — повторный жест просит обратный порядок.
    fireEvent.doubleClick(headers(container)[0]);
    expect(onSortChange).toHaveBeenCalledWith({ name: "desc" });
  });

  it("колонка с sortable: false не сортируется ни одним щелчком", () => {
    const onSortChange = vi.fn();
    const { container } = renderTable(onSortChange);
    const note = headers(container)[1];

    fireEvent.click(note);
    fireEvent.doubleClick(note);
    expect(onSortChange).not.toHaveBeenCalled();
    // Признак для курсора тоже снят: заголовок не обещает того, чего не делает.
    expect(note.getAttribute("data-sortable")).toBeNull();
  });

  it("двойной щелчок по границе колонки подбирает ширину, а не сортирует", () => {
    const onSortChange = vi.fn();
    const { container } = renderTable(onSortChange);
    const handle = headers(container)[0].querySelector("div[class*='ResizeHandle']");
    expect(handle).toBeTruthy();

    fireEvent.doubleClick(handle!);
    // Подбор ширины гасит всплытие: иначе одним жестом менялись бы сразу две вещи.
    expect(onSortChange).not.toHaveBeenCalled();
  });
});
