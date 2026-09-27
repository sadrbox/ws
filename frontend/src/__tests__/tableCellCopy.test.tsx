/**
 * Ctrl+C по активной ячейке Table: копирует показанное значение и анимирует ячейку.
 */
import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import Table from "src/components/Table";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import { isCopyShortcut, readCellText } from "src/components/Table/cellClipboard";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";

const columns = [
	{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "qty", type: "number", width: "100px", minWidth: "100px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[];
const rows = [{ id: 1, uuid: "a", name: "Альфа", qty: 3 }, { id: 2, uuid: "b", name: "Бета", qty: 7 }] as TDataItem[];

const key = (over: Partial<KeyboardEvent>) => ({ key: "c", code: "KeyC", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...over });

/** Нажатие с ожиданием записи в буфер (она асинхронна). Возвращает «не отменено». */
const press = async (el: HTMLElement, init: ReturnType<typeof key>) => {
	let notPrevented = true;
	await act(async () => { notPrevented = fireEvent.keyDown(el, init); await Promise.resolve(); });
	return notPrevented;
};

describe("isCopyShortcut", () => {
	it("Ctrl+C и ⌘C", () => {
		expect(isCopyShortcut(key({}))).toBe(true);
		expect(isCopyShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
		expect(isCopyShortcut(key({ key: "C" }))).toBe(true);
	});
	it("русская раскладка — по физической клавише C", () => {
		expect(isCopyShortcut(key({ key: "с" }))).toBe(true);
	});
	it("Dvorak — по символу, а не по физической клавише", () => {
		expect(isCopyShortcut(key({ key: "c", code: "KeyI" }))).toBe(true);
		expect(isCopyShortcut(key({ key: "j", code: "KeyC" }))).toBe(false);
	});
	it("без Ctrl, с Shift или Alt — не копирование", () => {
		expect(isCopyShortcut(key({ ctrlKey: false }))).toBe(false);
		expect(isCopyShortcut(key({ shiftKey: true }))).toBe(false);
		expect(isCopyShortcut(key({ altKey: true }))).toBe(false);
	});
});

describe("readCellText", () => {
	const cell = (html: string) => {
		const td = document.createElement("td");
		td.innerHTML = html;
		return td;
	};
	it("видимый текст без кнопок, иконок и подсказки ошибки", () => {
		const td = cell('<div><button>▾</button><svg><title>иконка</title></svg><span> Бета </span><div data-copy-skip>Обязательное поле</div></div>');
		expect(readCellText(td)).toBe("Бета");
	});
	it("значение поля ввода, а не подписи вокруг", () => {
		expect(readCellText(cell('<div><span>₸</span><input value="1 250,00"><button>…</button></div>'))).toBe("1 250,00");
	});
	it("выбранный пункт списка", () => {
		expect(readCellText(cell('<select><option value="1">Нет</option><option value="2" selected>Да</option></select>'))).toBe("Да");
	});
	it("флажок без подписи — как булева колонка", () => {
		expect(readCellText(cell('<input type="checkbox" checked>'))).toBe("✔");
		expect(readCellText(cell('<input type="checkbox">'))).toBe("");
	});
});

describe("Ctrl+C по активной ячейке", () => {
	let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
	beforeEach(() => {
		writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
	});
	afterEach(() => {
		cleanup();
		Reflect.deleteProperty(navigator, "clipboard");
	});

	const mount = (extra: Record<string, unknown> = {}) => {
		const props = { ...buildStaticTableProps({ componentName: "CellCopy", rows, columns, setColumns: () => { } }), ...extra };
		const { container } = render(<TestWrapper><Table {...props} /></TestWrapper>);
		const scroller = container.querySelector('[tabindex="0"]') as HTMLElement;
		const td = (rowId: number, col: string) => container.querySelector(`tr[data-row-id="${rowId}"] > td[data-col-id="${col}"]`) as HTMLElement;
		return { container, scroller, td };
	};

	it("копирует показанное значение и запускает анимацию «Скопировано»", async () => {
		const { scroller, td } = mount();
		fireEvent.click(td(2, "name"));
		expect(await press(scroller, key({}))).toBe(false);
		expect(writeText).toHaveBeenCalledWith("Бета");
		const box = td(2, "name").firstElementChild as HTMLElement;
		expect(box.getAttribute("data-copied")).toBe("ok");
		expect(box.getAttribute("data-copy-label")).toBe(translate("cellCopied"));
	});

	it("в русской раскладке (key «с») копирует так же", async () => {
		const { scroller, td } = mount();
		fireEvent.click(td(1, "qty"));
		await press(scroller, key({ key: "с" }));
		expect(writeText).toHaveBeenCalledWith("3");
	});

	it("без активной ячейки ничего не перехватывает", async () => {
		const { scroller } = mount();
		expect(await press(scroller, key({}))).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("в поле ввода копирует браузер (выделенный текст поля)", async () => {
		const renderCell = (row: TDataItem, col: TColumn) => (col.identifier === "name" ? <input defaultValue={String(row.name)} /> : undefined);
		const { td } = mount({ renderCell });
		fireEvent.click(td(1, "name"));
		const input = td(1, "name").querySelector("input") as HTMLInputElement;
		input.focus();
		expect(await press(input, key({}))).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("выделенный мышью текст в таблице копирует браузер", async () => {
		const { scroller, td } = mount();
		fireEvent.click(td(1, "name"));
		const range = document.createRange();
		range.selectNodeContents(td(2, "name"));
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
		const notPrevented = await press(scroller, key({}));
		sel.removeAllRanges();
		expect(notPrevented).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("сбой буфера обмена — анимация ошибки и тост", async () => {
		writeText.mockRejectedValue(new Error("denied"));
		const toasts: string[] = [];
		const onToast = (e: Event) => toasts.push((e as CustomEvent<{ message: string }>).detail.message);
		window.addEventListener("ui_toast", onToast);
		const { scroller, td } = mount();
		fireEvent.click(td(1, "name"));
		await press(scroller, key({}));
		window.removeEventListener("ui_toast", onToast);
		expect((td(1, "name").firstElementChild as HTMLElement).getAttribute("data-copied")).toBe("error");
		expect(toasts).toContain(translate("cellCopyError"));
	});
});
