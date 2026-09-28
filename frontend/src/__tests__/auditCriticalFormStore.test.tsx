/**
 * Регрессия аудита критических ошибок 27.09.
 * КР-4: две панели одной записи (новая форма после первой записи + та же запись из списка) держат
 * один store — закрытие одной не должно ломать другую: ни пустой формы, ни вечного скелетона, ни
 * второго документа (POST вместо PUT). P3: сырое «Строки: Network Error», черновики без userId.
 * Основа — тесты-воспроизведения инспектора (repro/insp_fe/sharedStore*.test.tsx).
 */
import React from "react";
import { renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("src/services/auth", () => ({ getCurrentUser: () => ({ uuid: "user-1" }), isAuthenticated: () => true, verifyToken: () => null, logout: () => { } }));
// store кэшируется на уровне модуля (живёт между тестами файла) — у каждого теста свои запись и панели.
const ids = vi.hoisted(() => ({ next: "new-uuid" }));
const pipe = vi.hoisted(() => ({
	fetchOne: vi.fn(async (_ep: string, uuid: string) => { await Promise.resolve(); return ({ item: { uuid, name: "srv" }, fromCache: false }); }),
	update: vi.fn(async (_ep: string, uuid: string, payload: Record<string, unknown>) => { await Promise.resolve(); return ({ item: { uuid, ...payload }, offline: false }); }),
	create: vi.fn(async (_ep: string, payload: Record<string, unknown>) => { await Promise.resolve(); return ({ item: { uuid: ids.next, ...payload }, offline: false }); }),
}));
vi.mock("src/services/persistencePipe", () => ({
	pipeFetchOne: (...a: unknown[]) => (pipe.fetchOne as (...x: unknown[]) => unknown)(...a),
	pipeUpdate: (...a: unknown[]) => (pipe.update as (...x: unknown[]) => unknown)(...a),
	pipeCreate: (...a: unknown[]) => (pipe.create as (...x: unknown[]) => unknown)(...a),
	isOfflineFirst: () => false,
}));
const commit = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => { }));
vi.mock("src/services/commitPendingRows", () => ({ commitPendingRows: (...a: unknown[]) => commit(...a) }));

import { useFormStore, purgeLegacyFormDrafts } from "src/hooks/useFormStore";
import { hasUnsavedWork } from "src/services/appUpdate";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";

type F = { uuid?: string; name: string };
const guards = new Map<string, () => Promise<boolean> | boolean>();
const requestClose = vi.fn(async () => { });
const confirm = vi.fn(() => Promise.resolve(true));
const value: TypeAppContextProps = {
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null,
		addPane: () => { }, requestClose, reloadPane: async () => { }, setActivePane: () => { },
		updatePaneLabel: () => { },
		registerBeforeClose: (id: string, fn: () => Promise<boolean> | boolean) => { guards.set(id, fn); return () => { guards.delete(id); }; },
	} as unknown as TypeAppContextProps["windows"],
	actions: { confirm },
	navbar: { props: [], setProps: () => { } },
	auth: { user: null, logout: () => { } },
};
const wrap = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => (
	<QueryClientProvider client={qc}><AppContextProvider value={value}>{children}</AppContextProvider></QueryClientProvider>
);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const ROWS = { items: { endpoint: "thingitems", parentField: "thingUuid", label: "Строки" } };
const useF = (data: Record<string, unknown> | undefined, uniq: string, tables: Record<string, { endpoint: string; parentField: string; label: string }> = {}) => useFormStore<F>({
	endpoint: "things", storageKey: "things-form", defaultFields: { name: "" }, tables,
	paneProps: { uniqId: uniq, data } as never,
	mapServerToForm: (d: { uuid?: string; name?: string }) => ({ uuid: d.uuid, name: d.name ?? "" }),
	buildPayload: (f) => ({ name: f.name }), buildPaneLabel: () => "x",
});

beforeEach(() => {
	localStorage.clear(); guards.clear();
	pipe.fetchOne.mockClear(); pipe.update.mockClear(); pipe.create.mockClear();
	requestClose.mockClear(); confirm.mockClear();
	commit.mockReset(); commit.mockImplementation(async () => { });
});
afterEach(() => cleanup());

/**
 * Новая форма (панель ThingForm-<tok>) → «Записать» (запись rec); затем та же запись второй
 * панелью ThingForm-<rec> — как из списка.
 */
async function openNewThenSameRecord(qc: QueryClient, tok: string, rec: string) {
	ids.next = rec;
	const A = renderHook(() => useF({ _paneToken: tok }, `ThingForm-${tok}`), { wrapper: wrap(qc) });
	await flush();
	act(() => A.result.current.setField("name", "первое"));
	await act(async () => { await A.result.current.submit(); });
	expect(pipe.create).toHaveBeenCalledTimes(1);
	const B = renderHook(() => useF({ uuid: rec }, `ThingForm-${rec}`), { wrapper: wrap(qc) });
	await flush();
	return { A, B };
}

describe("P3: черновики старого формата (без userId)", () => {
	it("первое открытие формы удаляет ключи formStore:<форма>:<uuid>, свои и служебные не трогает", async () => {
		localStorage.setItem("formStore:sales-form:0b1c2d3e", "{}");
		localStorage.setItem("formStore:user-1:sales-form:0b1c2d3e", "{}");
		localStorage.setItem("formStore:anon:things-form:new", "{}");
		localStorage.setItem("other:key", "1");
		renderHook(() => useF(undefined, "ThingForm-first"), { wrapper: wrap(new QueryClient()) });
		await flush();
		expect(localStorage.getItem("formStore:sales-form:0b1c2d3e")).toBeNull();
		expect(localStorage.getItem("formStore:user-1:sales-form:0b1c2d3e")).toBe("{}");
		expect(localStorage.getItem("formStore:anon:things-form:new")).toBe("{}");
		expect(localStorage.getItem("other:key")).toBe("1");
	});

	it("purgeLegacyFormDrafts: только ключи вида formStore:<…-form>:<id>", () => {
		localStorage.setItem("formStore:cash-receipt-orders-form:u1", "{}");
		localStorage.setItem("formStore:3f2a9c1e-1111-4222-8333-944455556666:sales-form:u2", "{}");
		localStorage.setItem("formStore:tabId", "x");
		expect(purgeLegacyFormDrafts()).toBe(1);
		expect(localStorage.getItem("formStore:cash-receipt-orders-form:u1")).toBeNull();
		expect(localStorage.getItem("formStore:3f2a9c1e-1111-4222-8333-944455556666:sales-form:u2")).toBe("{}");
		expect(localStorage.getItem("formStore:tabId")).toBe("x");
	});
});

describe("КР-4: две панели одной записи", () => {
	it("вторая панель не перечитывает живой store и не теряет правки первой", async () => {
		const qc = new QueryClient();
		ids.next = "rec-1";
		const A = renderHook(() => useF({ _paneToken: "tok1" }, "ThingForm-tok1"), { wrapper: wrap(qc) });
		await flush();
		act(() => A.result.current.setField("name", "первое"));
		await act(async () => { await A.result.current.submit(); });
		act(() => A.result.current.setField("name", "не записано"));
		const B = renderHook(() => useF({ uuid: "rec-1" }, "ThingForm-rec-1"), { wrapper: wrap(qc) });
		await flush();
		expect(pipe.fetchOne).not.toHaveBeenCalled();
		expect(A.result.current.fields.name).toBe("не записано");
		expect(B.result.current.fields.name).toBe("не записано");
		expect(B.result.current.isInitialLoading).toBe(false);
		expect(B.result.current.isEditMode).toBe(true);
	});

	it("закрыли первую — вторая цела: правки на месте, скелетона нет, «Записать» — PUT", async () => {
		const qc = new QueryClient();
		const { A, B } = await openNewThenSameRecord(qc, "tok2", "rec-2");
		const storeB = B.result.current.store;
		act(() => B.result.current.setField("name", "правка во второй"));
		// Первая «грязная» (store общий), но правки остаются во второй — вопроса нет.
		let closed: boolean | undefined;
		await act(async () => { closed = await guards.get("ThingForm-tok2")?.(); });
		expect(closed).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		A.unmount();
		B.rerender();
		await flush();
		expect(B.result.current.store).toBe(storeB);
		expect(B.result.current.fields.name).toBe("правка во второй");
		expect(B.result.current.isInitialLoading).toBe(false);
		expect(B.result.current.isEditMode).toBe(true);
		await act(async () => { await B.result.current.submit(); });
		expect(pipe.update).toHaveBeenCalledTimes(1);
		expect(pipe.update.mock.calls[0][1]).toBe("rec-2");
		expect(pipe.create).toHaveBeenCalledTimes(1);
	});

	it("закрыли вторую — первая остаётся записью: «Записать» — PUT, а не второй документ", async () => {
		const qc = new QueryClient();
		const { A, B } = await openNewThenSameRecord(qc, "tok3", "rec-3");
		await act(async () => { await guards.get("ThingForm-rec-3")?.(); });
		B.unmount();
		A.rerender();
		await flush();
		expect(A.result.current.fields.name).toBe("первое");
		expect(A.result.current.isEditMode).toBe(true);
		act(() => A.result.current.setField("name", "правка первой"));
		await act(async () => { await A.result.current.submit(); });
		expect(pipe.update).toHaveBeenCalledTimes(1);
		expect(pipe.update.mock.calls[0][1]).toBe("rec-3");
		expect(pipe.create).toHaveBeenCalledTimes(1);
	});

	it("«Записать и закрыть» в первой — вторая цела", async () => {
		const qc = new QueryClient();
		const { A, B } = await openNewThenSameRecord(qc, "tok4", "rec-4");
		const storeB = B.result.current.store;
		act(() => A.result.current.setField("name", "перед закрытием"));
		await act(async () => { await A.result.current.handleSaveAndClose(); });
		expect(pipe.update).toHaveBeenCalledTimes(1);
		expect(requestClose).toHaveBeenCalledWith("ThingForm-tok4", { force: true });
		A.unmount();
		B.rerender();
		await flush();
		expect(B.result.current.store).toBe(storeB);
		expect(B.result.current.fields.name).toBe("перед закрытием");
		expect(B.result.current.isInitialLoading).toBe(false);
		expect(B.result.current.isEditMode).toBe(true);
	});

	it("закрыли последнюю панель записи — черновик и кэш очищены, новое открытие грузит с сервера", async () => {
		const qc = new QueryClient();
		const { A, B } = await openNewThenSameRecord(qc, "tok5", "rec-5");
		await act(async () => { await guards.get("ThingForm-tok5")?.(); });
		A.unmount();
		act(() => B.result.current.setField("name", "черновик"));
		await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
		expect(localStorage.getItem("formStore:user-1:things-form:rec-5")).not.toBeNull();
		const storeB = B.result.current.store;
		// Последняя панель, правки не записаны — вопрос есть; ответ «да» чистит черновик.
		await act(async () => { await guards.get("ThingForm-rec-5")?.(); });
		expect(confirm).toHaveBeenCalledTimes(1);
		B.unmount();
		expect(localStorage.getItem("formStore:user-1:things-form:rec-5")).toBeNull();
		const C = renderHook(() => useF({ uuid: "rec-5" }, "ThingForm-rec-5"), { wrapper: wrap(qc) });
		await flush();
		expect(C.result.current.store).not.toBe(storeB);
		expect(pipe.fetchOne).toHaveBeenCalledTimes(1);
		expect(C.result.current.fields.name).toBe("srv");
	});

	it("store сменился (прежний выпал из кэша) — форма загружается заново, без вечного скелетона", async () => {
		const qc = new QueryClient();
		const B = renderHook(() => useF({ uuid: "doc-7" }, "ThingForm-doc-7"), { wrapper: wrap(qc) });
		await flush();
		expect(pipe.fetchOne).toHaveBeenCalledTimes(1);
		const first = B.result.current.store;
		act(() => B.result.current.clearFormStorage());
		B.rerender();
		await flush();
		expect(B.result.current.store).not.toBe(first);
		expect(pipe.fetchOne).toHaveBeenCalledTimes(2);
		expect(B.result.current.isInitialLoading).toBe(false);
		expect(B.result.current.fields.name).toBe("srv");
	});

	it("вторая панель не запускает запись, пока идёт запись первой (замок — в store)", async () => {
		const qc = new QueryClient();
		const { A, B } = await openNewThenSameRecord(qc, "tok8", "rec-8");
		let resolveUpdate: (v: unknown) => void = () => { };
		pipe.update.mockImplementationOnce(() => new Promise((res) => { resolveUpdate = res; }) as never);
		let first: Promise<boolean> | undefined;
		act(() => { first = A.result.current.submit(); });
		let second = true;
		await act(async () => { second = await B.result.current.submit(); });
		expect(second).toBe(false);
		await act(async () => { resolveUpdate({ item: { uuid: "rec-8", name: "первое" }, offline: false }); await first; });
		expect(pipe.update).toHaveBeenCalledTimes(1);
	});
});

describe("P3: сбой связи при записи строк", () => {
	it("вместо «Строки: Network Error» — понятный текст; строки остаются к повтору", async () => {
		const qc = new QueryClient();
		const { result } = renderHook(() => useF({ uuid: "doc-3" }, "ThingForm-doc-3", ROWS), { wrapper: wrap(qc) });
		await flush();
		act(() => result.current.store.setTablePending("items", [{ id: -1, uuid: "tmp-1", name: "r", _pendingAction: "create" } as TDataItem]));
		commit.mockImplementationOnce(async () => { await Promise.resolve(); throw new Error("Строки: Network Error"); });
		let ok = true;
		await act(async () => { ok = await result.current.submit(); });
		expect(ok).toBe(false);
		expect(result.current.error).not.toMatch(/Network Error/);
		expect(result.current.error).toMatch(/^«Строки»: не записано — (сервер временно недоступен|нет связи с сервером)/);
		expect(result.current.tables.items.pending.length).toBe(1);
	});

	it("отказ сервера по строкам показывается как есть", async () => {
		const qc = new QueryClient();
		const { result } = renderHook(() => useF({ uuid: "doc-4" }, "ThingForm-doc-4", ROWS), { wrapper: wrap(qc) });
		await flush();
		act(() => result.current.store.setTablePending("items", [{ id: -1, uuid: "tmp-1", name: "r", _pendingAction: "create" } as TDataItem]));
		commit.mockImplementationOnce(async () => { await Promise.resolve(); throw new Error("Строки: Не хватает остатка"); });
		await act(async () => { await result.current.submit(); });
		expect(result.current.error).toBe("Строки: Не хватает остатка");
	});
});

describe("КР-10: несохранённое в формах держит обновление приложения", () => {
	it("правка в открытой форме — есть несохранённое; закрыли без сохранения — нет", async () => {
		const qc = new QueryClient();
		const B = renderHook(() => useF({ uuid: "doc-10" }, "ThingForm-doc-10"), { wrapper: wrap(qc) });
		await flush();
		expect(hasUnsavedWork()).toBe(false);
		act(() => B.result.current.setField("name", "правка"));
		expect(hasUnsavedWork()).toBe(true);
		await act(async () => { await guards.get("ThingForm-doc-10")?.(); });
		B.unmount();
		expect(hasUnsavedWork()).toBe(false);
	});
});
