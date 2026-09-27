import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TDataItem } from "src/components/Table/types";

// Аудит 26.09, терминал продаж (И1–И6): общая логика оплаты SalesTerminal и SalesTerminalV2.

const { apiMock } = vi.hoisted(() => ({
	apiMock: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("src/services/api/client", () => ({ __esModule: true, api: apiMock, default: {} }));

import {
	performTerminalSale, discardTerminalDraft, cartRowData, isOfflineStub, TerminalOfflineError,
	unpricedRowNames, terminalBlockedReason, useTerminalHotkeys, useSubmitLock, useTerminalRequisites, type TerminalRequisites,
} from "src/models/SalesTerminal/terminalSale";
import { useLateResponseGuard } from "src/models/_shared/lateResponseGuard";
import { isNetworkError } from "src/services/networkUtils";

const OFFLINE = { _offline: true, message: "Данные сохранены локально" };
const row = (over: Record<string, unknown> = {}): TDataItem => ({
	id: -1, uuid: "tmp-1",
	productUuid: "p1", product: { uuid: "p1", name: "Чай" }, quantity: 2, price: 1500,
	vatRate: 12, discountPercent: 10, exciseRate: 0, unitOfMeasureUuid: "u1", ...over,
} as TDataItem);
const header = { date: "2026-09-26T10:00:00.000Z", organizationUuid: "org", counterpartyUuid: "cp", warehouseUuid: "wh" };

beforeEach(() => {
	for (const f of Object.values(apiMock)) f.mockReset();
});

describe("И3 — скидка и акциз корзины уходят на сервер", () => {
	it("строка несёт discountPercent и exciseRate (раньше — только кол-во/цена/НДС)", () => {
		const d = cartRowData(row({ exciseRate: 5 }), 12);
		expect(d).toMatchObject({ productUuid: "p1", quantity: 2, price: 1500, discountPercent: 10, exciseRate: 5, vatRate: 12 });
	});
});

describe("performTerminalSale — шапка → строки → проведение", () => {
	it("новая продажа: POST черновика, строки со скидкой, PUT posted; итог — от сервера", async () => {
		apiMock.post.mockImplementation((url: string) =>
			Promise.resolve(url === "sales" ? { item: { uuid: "s1", number: "000012" } } : { success: true }));
		apiMock.put.mockResolvedValue({ item: { uuid: "s1", number: "000012", amount: "2700.00", posted: true } });
		const onDraft = vi.fn();
		const res = await performTerminalSale({ isReturn: false, header, rows: [row()], vatRate: 12, draftUuid: null, onDraft });
		expect(onDraft).toHaveBeenCalledWith("s1");
		expect(apiMock.post).toHaveBeenCalledWith("sales", expect.objectContaining({ posted: false, counterpartyUuid: "cp" }));
		const batch = (apiMock.post.mock.calls as unknown[][]).find((c) => c[0] === "saleitems/batch")![1] as { operations: Array<{ action: string; data: Record<string, unknown> }> };
		expect(batch.operations).toHaveLength(1);
		expect(batch.operations[0]).toMatchObject({ action: "create", data: { saleUuid: "s1", discountPercent: 10 } });
		expect(apiMock.put).toHaveBeenCalledWith("sales/s1", { posted: true });
		expect(res).toEqual({ docUuid: "s1", docNumber: "000012", amount: 2700 });
	});

	it("И2: офлайн-заглушка на проведении — ошибка, а не «проведена»; черновик запомнен", async () => {
		apiMock.post.mockImplementation((url: string) => Promise.resolve(url === "sales" ? { item: { uuid: "s1" } } : { success: true }));
		apiMock.put.mockResolvedValue(OFFLINE);
		const onDraft = vi.fn();
		await expect(performTerminalSale({ isReturn: false, header, rows: [row()], vatRate: 12, draftUuid: null, onDraft }))
			.rejects.toBeInstanceOf(TerminalOfflineError);
		expect(onDraft).toHaveBeenCalledWith("s1");
	});

	it("И2: офлайн-заглушка уже на создании — ошибка, черновика нет", async () => {
		apiMock.post.mockResolvedValue(OFFLINE);
		const onDraft = vi.fn();
		await expect(performTerminalSale({ isReturn: false, header, rows: [row()], vatRate: 12, draftUuid: null, onDraft }))
			.rejects.toBeInstanceOf(TerminalOfflineError);
		expect(onDraft).not.toHaveBeenCalled();
		expect(apiMock.put).not.toHaveBeenCalled();
	});

	it("И4: повтор после отказа проводит ТОТ ЖЕ черновик — без нового POST, строки заменяются", async () => {
		apiMock.get.mockImplementation((url: string) => Promise.resolve(
			url === "sales/s1" ? { item: { uuid: "s1", number: "000012", posted: false } }
				: url === "saleitems" ? { items: [{ uuid: "i-old" }] } : {}));
		apiMock.put.mockImplementation((_url: string, body: { posted?: boolean }) => Promise.resolve(
			body.posted ? { item: { uuid: "s1", number: "000012", amount: 1350, posted: true } } : { item: { uuid: "s1" } }));
		apiMock.post.mockResolvedValue({ success: true });
		const onDraft = vi.fn();
		const res = await performTerminalSale({ isReturn: false, header, rows: [row({ quantity: 1 })], vatRate: 12, draftUuid: "s1", onDraft });
		expect(apiMock.post).not.toHaveBeenCalledWith("sales", expect.anything());
		expect(onDraft).not.toHaveBeenCalled();
		const batch = (apiMock.post.mock.calls as unknown[][]).find((c) => c[0] === "saleitems/batch")![1] as { operations: Array<Record<string, unknown>> };
		expect(batch.operations[0]).toEqual({ action: "delete", uuid: "i-old" });
		expect(batch.operations[1]).toMatchObject({ action: "create" });
		expect(apiMock.put).toHaveBeenCalledWith("sales/s1", expect.objectContaining({ posted: false, counterpartyUuid: "cp" }));
		expect(res.docUuid).toBe("s1");
	});

	it("И4: черновик прошлой попытки уже проведён (ответ потерялся) — повторно не проводим", async () => {
		apiMock.get.mockResolvedValue({ item: { uuid: "s1", number: "7", amount: 100, posted: true } });
		const res = await performTerminalSale({ isReturn: false, header, rows: [row()], vatRate: 12, draftUuid: "s1", onDraft: vi.fn() });
		expect(res).toEqual({ docUuid: "s1", docNumber: "7", amount: 100 });
		expect(apiMock.post).not.toHaveBeenCalled();
		expect(apiMock.put).not.toHaveBeenCalled();
	});

	it("И2: обрыв связи на проведении — ошибка пробрасывается как есть (без статуса — тост), черновик запомнен", async () => {
		// По контракту api-клиента сетевой сбой без offlineStub — reject; корзину терминал не чистит.
		apiMock.post.mockImplementation((url: string) => Promise.resolve(url === "sales" ? { item: { uuid: "s1" } } : { success: true }));
		const netErr = Object.assign(new Error("Network Error"), { isAxiosError: true, code: "ERR_NETWORK" });
		apiMock.put.mockRejectedValue(netErr);
		const onDraft = vi.fn();
		await expect(performTerminalSale({ isReturn: false, header, rows: [row()], vatRate: 12, draftUuid: null, onDraft })).rejects.toBe(netErr);
		expect(onDraft).toHaveBeenCalledWith("s1");
		expect(isNetworkError(netErr)).toBe(true); // так его опознаёт catch терминала: подпись «продажа не завершена»
	});

	it("возврат идёт в sale-returns / sale-return-items", async () => {
		apiMock.post.mockImplementation((url: string) => Promise.resolve(url === "sale-returns" ? { item: { uuid: "r1" } } : { success: true }));
		apiMock.put.mockResolvedValue({ item: { uuid: "r1", number: "3", posted: true } });
		await performTerminalSale({ isReturn: true, header, rows: [row()], vatRate: 12, draftUuid: null, onDraft: vi.fn() });
		expect(apiMock.post).toHaveBeenCalledWith("sale-return-items/batch", expect.anything());
		expect(apiMock.put).toHaveBeenCalledWith("sale-returns/r1", { posted: true });
	});
});

describe("discardTerminalDraft — брошенный черновик", () => {
	it("непроведённый удаляется", async () => {
		apiMock.get.mockResolvedValue({ item: { uuid: "s1", posted: false } });
		expect(await discardTerminalDraft(false, "s1")).toBeNull();
		expect(apiMock.delete).toHaveBeenCalledWith("sales/s1");
	});
	it("проведённый (ответ потерялся) НЕ удаляется — возвращается его номер", async () => {
		apiMock.get.mockResolvedValue({ item: { uuid: "s1", posted: true, number: "12" } });
		expect(await discardTerminalDraft(false, "s1")).toBe("12");
		expect(apiMock.delete).not.toHaveBeenCalled();
	});
});

describe("проверки корзины", () => {
	it("isOfflineStub", () => {
		expect(isOfflineStub(OFFLINE)).toBe(true);
		expect(isOfflineStub({ item: {} })).toBe(false);
		expect(isOfflineStub(undefined)).toBe(false);
	});
	it("И6: товары без цены", () => {
		expect(unpricedRowNames([row({ price: 0 }), row({ productUuid: "p2", product: { name: "Сахар" }, price: 100 })])).toEqual(["Чай"]);
	});
	it("И4: товар с сериями/партиями — понятный отказ", () => {
		expect(terminalBlockedReason({ trackSerialNumbers: true })).not.toBe("");
		expect(terminalBlockedReason({ trackBatches: true })).not.toBe("");
		expect(terminalBlockedReason({ name: "Чай" })).toBe("");
	});
});

describe("И1 — замок оплаты", () => {
	it("второй вызов, пока идёт первый, ничего не делает", async () => {
		const { result } = renderHook(() => useSubmitLock());
		let release!: () => void;
		const fn = vi.fn(() => new Promise<void>((r) => { release = r; }));
		let first!: Promise<void>;
		act(() => { first = result.current.run(fn); void result.current.run(fn); });
		expect(fn).toHaveBeenCalledTimes(1);
		await act(async () => { release(); await first; });
		expect(result.current.busy).toBe(false);
		// После завершения — снова можно.
		await act(async () => { const p = result.current.run(fn); release(); await p; });
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("И5 — F9/F4 только в своей активной панели", () => {
	const key = (k: string) => ({ key: k, preventDefault: vi.fn() }) as unknown as ReactKeyboardEvent<HTMLElement>;

	it("в активной панели F9 проводит, F4 очищает", () => {
		const onSubmit = vi.fn(), onClear = vi.fn();
		const { result } = renderHook(() => useTerminalHotkeys({ uniqId: "t1", getActivePane: () => "t1", onSubmit, onClear }));
		result.current(key("F9"));
		result.current(key("F4"));
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onClear).toHaveBeenCalledTimes(1);
	});

	it("панель не активна — клавиши не трогают терминал", () => {
		const onSubmit = vi.fn(), onClear = vi.fn();
		const { result } = renderHook(() => useTerminalHotkeys({ uniqId: "t1", getActivePane: () => "other", onSubmit, onClear }));
		result.current(key("F9"));
		result.current(key("F4"));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(onClear).not.toHaveBeenCalled();
	});
});

describe("И13 — реквизиты терминала: поздний ответ по прежней организации", () => {
	beforeEach(() => { localStorage.clear(); });
	function deferred<T>() {
		let resolve!: (v: T) => void;
		const promise = new Promise<T>((r) => { resolve = r; });
		return { promise, resolve };
	}

	it("снимок обновляется синхронно — в том же обработчике, до перерисовки", () => {
		const { result } = renderHook(() => useTerminalRequisites({ orgUuid: "org-1", orgName: "Орг" }));
		let snap: TerminalRequisites | undefined;
		act(() => {
			result.current.setRequisites({ warehouseUuid: "wh", warehouseName: "Склад" });
			snap = result.current.getRequisites();
		});
		expect(snap).toMatchObject({ orgUuid: "org-1", warehouseUuid: "wh", warehouseName: "Склад" });
		expect(result.current.warehouseUuid).toBe("wh");
		expect(result.current.warehouseName).toBe("Склад");
	});

	it("организация A→B: дефолты A пришли позже и склад/касса A в терминал не попали", async () => {
		const { result } = renderHook(() => {
			const r = useTerminalRequisites({ orgUuid: "", orgName: "" });
			const guard = useLateResponseGuard<TerminalRequisites>(r.getRequisites, r.setRequisites);
			return { r, guard };
		});
		const a = deferred<object>();
		const b = deferred<object>();
		let pA!: Promise<unknown>;
		let pB!: Promise<unknown>;
		act(() => { result.current.r.setRequisites({ orgUuid: "A" }); pA = result.current.guard(() => a.promise, ["orgUuid"]); });
		act(() => { result.current.r.setRequisites({ orgUuid: "B" }); pB = result.current.guard(() => b.promise, ["orgUuid"]); });
		await act(async () => { b.resolve({ warehouseUuid: "wh-B", cashboxUuid: "cb-B" }); await pB; });
		await act(async () => { a.resolve({ warehouseUuid: "wh-A", cashboxUuid: "cb-A" }); expect(await pA).toBeNull(); });
		expect(result.current.r.warehouseUuid).toBe("wh-B");
		expect(result.current.r.cashboxUuid).toBe("cb-B");
		expect(result.current.r.getRequisites()).toMatchObject({ orgUuid: "B", warehouseUuid: "wh-B" });
	});
});
