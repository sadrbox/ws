/**
 * Регрессия аудита 26.09 (И10, И15, У5): гонки и ошибки поля выбора, числовое поле,
 * поле периода, поле даты.
 */
import React from "react";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("src/services/offlineDataService", () => ({ fetchList: vi.fn() }));
vi.mock("src/app/context", () => ({
	useAppContext: () => ({ windows: { addPane: addPaneMock }, screenRef: { current: null } }),
	useAppActions: () => ({ windows: { addPane: addPaneMock } }),
}));
vi.mock("src/hooks/useDirtyHighlight", () => ({ useFieldDirty: () => ({}), useCellFieldState: () => ({}) }));
vi.mock("src/registry/modelRegistry", () => ({ getByEndpoint: () => null }));
vi.mock("src/hooks/useAccessPermission", () => ({ useAccessPermission: () => ({ canWrite: true }) }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("src/components/UIToast", () => ({ showToast: toast }));
const { addPaneMock } = vi.hoisted(() => ({ addPaneMock: vi.fn() }));

import LookupField from "src/components/Field/LookupField";
import { FieldNumber } from "src/components/Field/FieldNumber";
import { FieldPeriod } from "src/components/Field/FieldPeriod";
import { FieldDate } from "src/components/Field/FieldDate";
import { fetchList } from "src/services/offlineDataService";

const res = (items: unknown[]) => ({ items, total: items.length, nextCursor: null, hasMore: false, fromCache: false });
const dropdownItems = () => Array.from(document.querySelectorAll('[role="option"]')).map((e) => e.textContent);
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

afterEach(() => { cleanup(); vi.useRealTimers(); toast.mockReset(); addPaneMock.mockReset(); });

describe("LookupField: гонки (И10)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(fetchList).mockReset();
		(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => { };
	});

	it("«Ив» → дописали «л» → сразу Enter: выбирается результат для «Ивл», а не прошлая выдача", async () => {
		const DB = [{ uuid: "1", name: "Иванов" }, { uuid: "2", name: "Ивлев" }];
		vi.mocked(fetchList).mockImplementation(((_e: string, _c: unknown, p: { search?: string }) =>
			Promise.resolve(res(DB.filter((d) => d.name.toLowerCase().includes(String(p.search).toLowerCase()))))) as never);
		const onSelect = vi.fn();
		render(<LookupField name="f" endpoint="counterparties" onSelect={onSelect} />);
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.focus();
		fireEvent.change(input, { target: { value: "Ив" } });
		await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(350); });
		await settle();
		fireEvent.change(input, { target: { value: "Ивл" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onSelect).not.toHaveBeenCalled(); // ждём ответ для «Ивл»
		await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(350); });
		await settle();
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect.mock.calls[0][1]).toBe("Ивлев");
	});

	it("поздний ответ «Быстрого выбора» не затирает отфильтрованный список", async () => {
		let resolveQs: (v: unknown) => void = () => { };
		vi.mocked(fetchList).mockImplementation(((_e: string, _c: unknown, p: Record<string, unknown>) => {
			if (p && p.search) return Promise.resolve(res([{ uuid: "b", name: "Beta" }]));
			return new Promise((r) => { resolveQs = r; });
		}) as never);
		const onSelect = vi.fn();
		render(<LookupField name="f" endpoint="counterparties" onSelect={onSelect} />);
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.focus();
		fireEvent.keyDown(input, { key: "ArrowDown" }); // быстрый выбор, медленный
		fireEvent.change(input, { target: { value: "Be" } });
		await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(350); });
		await settle();
		await act(async () => { resolveQs(res([{ uuid: "a", name: "Alpha" }, { uuid: "b", name: "Beta" }])); await Promise.resolve(); await Promise.resolve(); });
		expect(dropdownItems()).toEqual(["Beta"]);
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onSelect.mock.calls[0]?.[1]).toBe("Beta");
	});

	it("ошибка поиска — тост и «Ошибка поиска», без кнопки «Создать»", async () => {
		vi.mocked(fetchList).mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500, data: { message: "Внутренняя ошибка" } } }));
		render(<LookupField name="f" endpoint="counterparties" onSelect={() => { }} />);
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.focus();
		fireEvent.change(input, { target: { value: "Рога" } });
		await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(350); });
		await settle();
		expect(toast).toHaveBeenCalledWith(expect.stringContaining("Внутренняя ошибка"), "error");
		expect(document.body.textContent).toContain("Ошибка поиска");
		expect(document.body.textContent).not.toContain("Ничего не найдено");
	});

	it("набрали текст и ушли Tab без выбора — текст откатывается к значению, список не открывается", async () => {
		vi.mocked(fetchList).mockResolvedValue(res([{ uuid: "x", name: "Рога" }]) as never);
		const onSelect = vi.fn();
		render(<div><LookupField name="f" endpoint="counterparties" value="u1" displayValue="Копыта" onSelect={onSelect} /><input data-testid="next" /></div>);
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.focus();
		fireEvent.change(input, { target: { value: "Рог" } });
		act(() => { screen.getByTestId<HTMLInputElement>("next").focus(); });
		await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(350); });
		await settle();
		expect(input.value).toBe("Копыта");
		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("Escape при открытом списке закрывает его и откатывает текст", async () => {
		vi.mocked(fetchList).mockResolvedValue(res([{ uuid: "x", name: "Рога" }]) as never);
		render(<LookupField name="f" endpoint="counterparties" value="u1" displayValue="Копыта" onSelect={() => { }} />);
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.focus();
		fireEvent.change(input, { target: { value: "Рог" } });
		await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(350); });
		await settle();
		expect(input.getAttribute("aria-expanded")).toBe("true");
		expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
		fireEvent.keyDown(input, { key: "Escape" });
		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(input.value).toBe("Копыта");
	});

	it("инлайн getSuggestionLabel не перезапрашивает список на каждый рендер владельца", async () => {
		vi.mocked(fetchList).mockResolvedValue(res([{ uuid: "a", name: "Alpha" }]) as never);
		let bump: () => void = () => { };
		const Parent = () => {
			const [, setN] = React.useState(0);
			bump = () => setN((x) => x + 1);
			return <LookupField name="f" endpoint="counterparties" onSelect={() => { }} getSuggestionLabel={(i) => String(i.name)} />;
		};
		render(<Parent />);
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.focus();
		fireEvent.change(input, { target: { value: "Al" } });
		await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(350); });
		await settle();
		const calls = vi.mocked(fetchList).mock.calls.length;
		await act(async () => { await Promise.resolve(); bump(); });
		await act(async () => { await Promise.resolve(); bump(); });
		expect(vi.mocked(fetchList).mock.calls.length).toBe(calls);
	});

	it("двойной щелчок «Выбрать из списка» открывает одну панель", () => {
		render(<LookupField name="f" endpoint="counterparties" onSelect={() => { }} />);
		const btn = screen.getByLabelText("Выбрать из списка");
		fireEvent.click(btn);
		fireEvent.click(btn);
		expect(addPaneMock).toHaveBeenCalledTimes(1);
	});
});

describe("FieldNumber (И15)", () => {
	const Harness = ({ initial }: { initial: string }) => {
		const [v, setV] = React.useState(initial);
		return <div><FieldNumber name="n" value={v} onChange={(e) => setV(e.target.value)} /><span data-testid="state">{v}</span></div>;
	};
	it("«12,5» → «12,» → Tab: в состоянии 12", () => {
		render(<Harness initial="12" />);
		const input = document.querySelector("input")!;
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "12,5" } });
		fireEvent.change(input, { target: { value: "12," } });
		fireEvent.blur(input);
		expect(screen.getByTestId("state").textContent).toBe("12");
	});
	it("одиночный «−» не остаётся в состоянии", () => {
		render(<Harness initial="" />);
		const input = document.querySelector("input")!;
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "-" } });
		fireEvent.blur(input);
		expect(screen.getByTestId("state").textContent).toBe("");
	});
	it("вставка «1,234.56» и «1.234,56» — 1234.56", () => {
		render(<Harness initial="" />);
		const input = document.querySelector("input")!;
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "1,234.56" } });
		fireEvent.blur(input);
		expect(screen.getByTestId("state").textContent).toBe("1234.56");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "1.234,56" } });
		fireEvent.blur(input);
		expect(screen.getByTestId("state").textContent).toBe("1234.56");
	});
});

describe("FieldPeriod (И15)", () => {
	it("колесо над полем без фокуса не меняет месяц, в фокусе — меняет", () => {
		const onChange = vi.fn<(e: { target: { value: string; name: string } }) => void>();
		render(<FieldPeriod name="p" value="2026-03" onChange={onChange} />);
		const trigger = screen.getByRole("combobox");
		fireEvent.wheel(trigger, { deltaY: 100 });
		expect(onChange).not.toHaveBeenCalled();
		trigger.focus();
		fireEvent.wheel(trigger, { deltaY: 100 });
		expect(onChange.mock.calls[0][0].target.value).toBe("2026-04");
	});
});

describe("FieldDate (У5)", () => {
	it("ISO с поясом показывается местной датой (UTC+5), а не обрезкой по UTC", () => {
		render(<FieldDate name="d" value="2026-06-01T20:30:00.000Z" onChange={() => { }} />);
		expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-06-02");
	});
	it("дата без времени и полночь UTC не сдвигаются", () => {
		const { rerender } = render(<FieldDate name="d" value="2026-06-01" onChange={() => { }} />);
		expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-06-01");
		rerender(<FieldDate name="d" value="2026-06-01T00:00:00.000Z" onChange={() => { }} />);
		expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-06-01");
	});
});
