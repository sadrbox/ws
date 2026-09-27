/**
 * Регрессия аудита 26.09 (И11, И12, И13, И15): потеря данных формы, ключ черновика после
 * записи, текст 409, новая форма с периодом по умолчанию.
 */
import React from "react";
import { render, renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("src/services/auth", () => ({ getCurrentUser: () => ({ uuid: "user-1" }), isAuthenticated: () => true, verifyToken: () => null, logout: () => { } }));

const pipe = vi.hoisted(() => ({
	fetchOne: vi.fn(async (_ep: string, uuid: string) => { await Promise.resolve(); return ({ item: { uuid, name: "srv" }, fromCache: false }); }),
	update: vi.fn(async (_ep: string, uuid: string, payload: Record<string, unknown>) => { await Promise.resolve(); return ({ item: { uuid, ...payload }, offline: false }); }),
	create: vi.fn(async (_ep: string, payload: Record<string, unknown>) => { await Promise.resolve(); return ({ item: { uuid: "new-uuid", ...payload }, offline: false }); }),
}));
vi.mock("src/services/persistencePipe", () => ({
	pipeFetchOne: (...a: unknown[]) => (pipe.fetchOne as (...x: unknown[]) => unknown)(...a),
	pipeUpdate: (...a: unknown[]) => (pipe.update as (...x: unknown[]) => unknown)(...a),
	pipeCreate: (...a: unknown[]) => (pipe.create as (...x: unknown[]) => unknown)(...a),
	isOfflineFirst: () => false,
}));
const commit = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => { }));
vi.mock("src/services/commitPendingRows", () => ({ commitPendingRows: (...a: unknown[]) => commit(...a) }));

import { useFormStore } from "src/hooks/useFormStore";
import { getAllFormStoreEntries } from "src/hooks/useFormSessionStore";
import { FieldPeriod } from "src/components/Field/FieldPeriod";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import type { TDataItem } from "src/components/Table/types";

type F = { uuid?: string; name: string };
const wrap = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => (
	<QueryClientProvider client={qc}><TestWrapper>{children}</TestWrapper></QueryClientProvider>
);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function useF(tables: Record<string, { endpoint: string; parentField: string; label: string }>, uuid: string | undefined, uniq: string) {
	return useFormStore<F>({
		endpoint: "things", storageKey: "things-form", defaultFields: { name: "" },
		tables, paneProps: { uniqId: uniq, data: uuid ? { uuid } : undefined } as never,
		mapServerToForm: (d: { uuid?: string; name?: string }) => ({ uuid: d.uuid, name: d.name ?? "" }),
		buildPayload: (f) => ({ name: f.name }), buildPaneLabel: () => "x",
	});
}

beforeEach(() => { localStorage.clear(); commit.mockReset(); commit.mockImplementation(async () => { }); pipe.update.mockClear(); pipe.fetchOne.mockClear(); });
afterEach(() => cleanup());

describe("useFormStore (И11)", () => {
	it("⟳ во время записи не выполняется: строки коммитятся, форма чистая", async () => {
		const qc = new QueryClient();
		const { result } = renderHook(() => useF({ items: { endpoint: "thingitems", parentField: "thingUuid", label: "Строки" } }, "doc-2", "p2"), { wrapper: wrap(qc) });
		await flush();
		act(() => result.current.store.setTablePending("items", [{ id: -1, uuid: "tmp-1", name: "row", _pendingAction: "create" } as TDataItem]));
		let resolveUpdate: (v: unknown) => void = () => { };
		pipe.update.mockImplementationOnce(() => new Promise((res) => { resolveUpdate = res; }) as never);
		let saved: Promise<boolean> | undefined;
		act(() => { saved = result.current.submit(); });
		await flush();
		const fetchesBefore = pipe.fetchOne.mock.calls.length;
		await act(async () => { await result.current.handleReload(); });
		expect(pipe.fetchOne.mock.calls.length).toBe(fetchesBefore);
		await act(async () => { resolveUpdate({ item: { uuid: "doc-2", name: "srv" }, offline: false }); await saved; });
		expect(commit).toHaveBeenCalledTimes(1);
		expect(result.current.store.getSnapshot().tables.items.pending.length).toBe(0);
	});

	it("упала вторая таблица — повторная запись не шлёт строки первой ещё раз", async () => {
		const qc = new QueryClient();
		const { result } = renderHook(() => useF({
			a: { endpoint: "aitems", parentField: "thingUuid", label: "A" },
			b: { endpoint: "bitems", parentField: "thingUuid", label: "B" },
		}, "doc-3", "p3"), { wrapper: wrap(qc) });
		await flush();
		act(() => {
			result.current.store.setTablePending("a", [{ id: -1, uuid: "tmp-a", name: "A1", _pendingAction: "create" } as TDataItem]);
			result.current.store.setTablePending("b", [{ id: -2, uuid: "tmp-b", name: "B1", _pendingAction: "create" } as TDataItem]);
		});
		commit.mockImplementationOnce(async () => { }).mockImplementationOnce(async () => { await Promise.resolve(); throw new Error("B: ошибка валидации"); });
		let ok1 = true;
		await act(async () => { ok1 = await result.current.submit(); });
		expect(ok1).toBe(false);
		let ok2 = false;
		await act(async () => { ok2 = await result.current.submit(); });
		expect(ok2).toBe(true);
		expect(commit.mock.calls.filter((c) => c[0] === "aitems").length).toBe(1);
		expect(commit.mock.calls.filter((c) => c[0] === "bitems").length).toBe(2);
	});

	it("черновик из «Несохранённых» не затирается автозагрузкой", async () => {
		const KEY = "formStore:user-1:things-form:doc-9";
		localStorage.setItem(KEY, JSON.stringify({ fields: { uuid: "doc-9", name: "черновик" }, tables: { items: { pending: [{ id: 7, uuid: "r7", _pendingAction: "update", q: 5 }] } } }));
		const qc = new QueryClient();
		const { result } = renderHook(() => useFormStore<F>({
			endpoint: "things", storageKey: "things-form", defaultFields: { name: "" },
			tables: { items: { endpoint: "thingitems", parentField: "thingUuid", label: "Строки" } },
			paneProps: { uniqId: "p9", data: { uuid: "doc-9", _formStorageKey: KEY } } as never,
			mapServerToForm: (d: { uuid?: string; name?: string }, prev?: F) => ({ ...(prev ?? { name: "" }), uuid: d.uuid, name: d.name ?? "" }),
			buildPayload: (f) => ({ name: f.name }), buildPaneLabel: () => "x",
		}), { wrapper: wrap(qc) });
		await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
		expect(result.current.isFromUnsaved).toBe(true);
		expect(result.current.fields.name).toBe("черновик");
		expect(result.current.tables.items.pending.length).toBe(1);
		expect(result.current.isDirty).toBe(true);
		expect(result.current.unsavedFields.has("name")).toBe(true);
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { fields?: { name?: string } } | null;
		expect(saved?.fields?.name).toBe("черновик");
	});
});

describe("useFormStore: ключ черновика и 409 (И12, И13)", () => {
	it("после первой записи ключ сохраняет userId — правки видны в «Несохранённых»", async () => {
		const qc = new QueryClient();
		const { result } = renderHook(() => useF({}, undefined, "p-new"), { wrapper: wrap(qc) });
		await flush();
		act(() => result.current.setField("name", "первое"));
		await act(async () => { await result.current.submit(); });
		expect(result.current.store.getStorageKey()).toBe("formStore:user-1:things-form:new-uuid");
		act(() => result.current.setField("name", "черновик"));
		await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
		expect(getAllFormStoreEntries().map((e) => e.storageKey)).toContain("formStore:user-1:things-form:new-uuid");
	});

	it("409 без текста сервера не выдаётся за «Запись уже существует»", async () => {
		const qc = new QueryClient();
		const { result } = renderHook(() => useF({}, "doc-4", "p4"), { wrapper: wrap(qc) });
		await flush();
		pipe.update.mockImplementationOnce(async () => { await Promise.resolve(); throw Object.assign(new Error("Request failed with status code 409"), { response: { status: 409, data: {} } }); });
		await act(async () => { await result.current.submit(); });
		expect(result.current.error).not.toBe("Запись уже существует");
		expect(result.current.error).toMatch(/Конфликт/);
	});

	it("409 с признаком конфликта версии просит обновить форму", async () => {
		const qc = new QueryClient();
		const { result } = renderHook(() => useF({}, "doc-5", "p5"), { wrapper: wrap(qc) });
		await flush();
		pipe.update.mockImplementationOnce(async () => { await Promise.resolve(); throw Object.assign(new Error("x"), { response: { status: 409, data: { code: "VERSION_CONFLICT", message: "Запись изменена другим пользователем" } } }); });
		await act(async () => { await result.current.submit(); });
		expect(result.current.error).toMatch(/Обновите форму/);
	});
});

describe("Новая форма с периодом по умолчанию (И15)", () => {
	it("FieldPeriod выставил текущий месяц — нетронутая форма не «грязная»", async () => {
		const qc = new QueryClient();
		let dirty: boolean | undefined;
		let period: string | undefined;
		function Form() {
			const form = useFormStore<{ period: string }>({
				endpoint: "payroll", storageKey: "payroll-form", defaultFields: { period: "" },
				paneProps: { uniqId: "p-period" } as never,
				mapServerToForm: (d: { period?: string }) => ({ period: d.period ?? "" }),
				buildPayload: (f) => ({ period: f.period }), buildPaneLabel: () => "x",
			});
			dirty = form.isDirty;
			period = form.fields.period;
			return <FieldPeriod name="p" value={form.fields.period} onChange={(e) => form.setField("period", e.target.value)} />;
		}
		render(<QueryClientProvider client={qc}><TestWrapper><Form /></TestWrapper></QueryClientProvider>);
		await flush();
		expect(period).toMatch(/^\d{4}-\d{2}$/);
		expect(dirty).toBe(false);
	});
});
