/**
 * Регрессия аудита 26.09 (И9, И2): снятый из очереди запрос не подвешивает список;
 * офлайн-заглушка api-клиента — только по явному запросу.
 */
import React from "react";
import { render, act, renderHook, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";

const { get } = vi.hoisted(() => ({ get: vi.fn((..._a: unknown[]) => Promise.resolve({ data: { items: [{ id: 1 }], nextCursor: null, hasMore: false, total: 1 } })) }));

import { useRequestQueue, isRequestCancelled } from "src/hooks/useRequestQueue";

afterEach(() => cleanup());

describe("Очередь запросов (И9)", () => {
	it("снятый из очереди запрос отклоняется, а не висит", async () => {
		const a = renderHook(() => useRequestQueue()).result.current;
		const b = renderHook(() => useRequestQueue()).result.current;
		const releases: Array<() => void> = [];
		for (let i = 0; i < 6; i++) a.addRequest(`p${i}`, () => new Promise<void>((r) => releases.push(r)));
		let executed = false;
		const p = new Promise((resolve, reject) => b.addRequest("page", async () => { await Promise.resolve(); executed = true; resolve(1); }, reject));
		b.cancelAll();
		releases.forEach((r) => r());
		await expect(p).rejects.toSatisfy(isRequestCancelled);
		await new Promise((r) => setTimeout(r, 20));
		expect(executed).toBe(false);
	});

	it("отмена по AbortSignal снимает запрос из очереди", async () => {
		const a = renderHook(() => useRequestQueue()).result.current;
		const releases: Array<() => void> = [];
		for (let i = 0; i < 6; i++) a.addRequest(`q${i}`, () => new Promise<void>((r) => releases.push(r)));
		const ctrl = new AbortController();
		let executed = false;
		const p = new Promise((resolve, reject) => a.addRequest("sig", async () => { await Promise.resolve(); executed = true; resolve(1); }, reject, ctrl.signal));
		ctrl.abort();
		await expect(p).rejects.toSatisfy(isRequestCancelled);
		releases.forEach((r) => r());
		await new Promise((r) => setTimeout(r, 20));
		expect(executed).toBe(false);
	});
});

vi.mock("src/services/api/client", async (orig) => {
	const real = await orig<typeof import("src/services/api/client")>();
	return { ...real, default: { get, post: vi.fn(), delete: vi.fn() } };
});
import { useInfiniteModelList } from "src/hooks/useInfiniteModelList";

describe("Список после размонтирования в очереди (И9)", () => {
	it("повторно открытый список загружается, а не крутится вечно", async () => {
		const q = renderHook(() => useRequestQueue()).result.current;
		const releases: Array<() => void> = [];
		for (let i = 0; i < 6; i++) q.addRequest(`busy${i}`, () => new Promise<void>((r) => releases.push(r)));
		const qc = new QueryClient();
		let state: { isFetching: boolean; allItems: unknown[] } | null = null;
		const X = () => { state = useInfiniteModelList<unknown>({ model: "stuckmodel" }); return null; };
		const first = render(<QueryClientProvider client={qc}><X /></QueryClientProvider>);
		await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
		expect(state!.isFetching).toBe(true);
		first.unmount(); // закрыли панель, пока запрос ждал в очереди
		releases.forEach((r) => r());
		await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
		render(<QueryClientProvider client={qc}><X /></QueryClientProvider>); // открыли снова
		await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
		expect(get.mock.calls.filter((c) => c[0] === "stuckmodel").length).toBe(1);
		expect(state!.isFetching).toBe(false);
		expect(state!.allItems.length).toBe(1);
	});
});

describe("Офлайн-заглушка api-клиента (И2)", () => {
	it("без флага сетевой сбой POST — ошибка; с флагом — заглушка queued:false", async () => {
		const real = await vi.importActual<typeof import("src/services/api/client")>("src/services/api/client");
		const client = real.apiClient;
		const prevAdapter = client.defaults.adapter;
		client.defaults.adapter = async (config: InternalAxiosRequestConfig) => { await Promise.resolve();
			throw new AxiosError("Network Error", "ERR_NETWORK", config);
		};
		try {
			await expect(client.post("/sales", { a: 1 })).rejects.toBeTruthy();
			const r = await client.post("/sales", { a: 1 }, { offlineStub: true } as import("src/services/api/client").OfflineStubConfig);
			expect(real.isOfflineStubResponse(r.data)).toBe(true);
			expect((r.data as { queued: boolean }).queued).toBe(false);
		} finally {
			client.defaults.adapter = prevAdapter;
		}
	});
});
