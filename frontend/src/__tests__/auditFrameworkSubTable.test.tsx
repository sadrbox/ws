/**
 * Регрессия аудита 26.09 (И8, И12): горячие клавиши табличной части при запретах,
 * Delete по модели выбора, id новых строк после черновика, ⟳ формы с новыми строками,
 * поздняя правка удалённой строки.
 */
import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import type { TColumn, TDataItem } from "src/components/Table/types";

const srv = vi.hoisted(() => ({ s: { items: [] as unknown[], at: 1 }, ls: new Set<() => void>() }));
vi.mock("src/hooks/useInfiniteModelList", async () => {
	const R = await import("react");
	return {
		GLOBAL_ADAPTIVE_LIMIT_REF: { current: 500 },
		useInfiniteModelList: () => {
			const s = R.useSyncExternalStore((cb: () => void) => { srv.ls.add(cb); return () => { srv.ls.delete(cb); }; }, () => srv.s);
			return {
				allItems: s.items, isAnythingLoading: false, isFetchingNextPage: false, hasNextPage: false, error: null,
				refetch: () => Promise.resolve(), fetchNextPage: () => Promise.resolve(), cancelAllRequests: () => { }, dataUpdatedAt: s.at,
			};
		},
	};
});
const { post } = vi.hoisted(() => ({ post: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock("src/services/api/client", () => ({ default: { post, get: vi.fn(), put: vi.fn(), delete: vi.fn() }, apiClient: { post } }));
const { del } = vi.hoisted(() => ({ del: vi.fn(() => Promise.resolve({ deletedIds: new Set<number>() })) }));
vi.mock("src/hooks/useModelDelete", () => ({ useModelDelete: () => del }));

import SubTable, { type SubTableApi } from "src/components/SubTable";
import { applyEditMarker, isSameRow } from "src/components/SubTable/rowModel";

const cols = [{ identifier: "name", type: "string", visible: true, inlist: true }] as unknown as TColumn[];
const setServer = (items: unknown[], at: number) => { srv.s = { items, at }; srv.ls.forEach((l) => l()); };
const wrap = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><TestWrapper>{node}</TestWrapper></QueryClientProvider>);
const scrollerOf = (c: HTMLElement) => c.querySelector('[tabindex="0"]') as HTMLElement;

afterEach(() => { cleanup(); post.mockClear(); del.mockClear(); srv.s = { items: [], at: 1 }; });

describe("Горячие клавиши табличной части (И8)", () => {
	it("Insert в disabled-таблице (предпросмотр) не шлёт POST", async () => {
		srv.s = { items: [{ id: 1, uuid: "u1", name: "A", saleUuid: "doc" }], at: 1 };
		const { container } = wrap(
			<SubTable model="saleitems" componentName="AuditST_ins" parentKey="saleUuid" parentUuid="doc"
				columnsJson={cols} disabled defaultNewRow={{ name: "" }} />,
		);
		await act(async () => { });
		await act(async () => { fireEvent.keyDown(scrollerOf(container), { key: "Insert" }); await new Promise((r) => setTimeout(r, 10)); });
		expect(post).not.toHaveBeenCalled();
	});

	it("Insert при блокировке основания (disableAdd) не добавляет строку", async () => {
		const onItemsChange = vi.fn();
		const { container } = wrap(
			<SubTable model="saleitems" componentName="AuditST_lock" parentKey="saleUuid" parentUuid=""
				columnsJson={cols} deferRemoteChanges disableAdd disableDelete defaultNewRow={{ name: "" }} initialPendingRows={[]} onItemsChange={onItemsChange} />,
		);
		await act(async () => { });
		await act(async () => { await Promise.resolve(); fireEvent.keyDown(scrollerOf(container), { key: "Insert" }); });
		expect(container.querySelectorAll("tbody tr[data-row-id]").length).toBe(0);
	});

	it("Space + Delete в disabled-таблице не удаляют на сервере", async () => {
		srv.s = { items: [{ id: 1, uuid: "u1", name: "A", saleUuid: "doc" }, { id: 2, uuid: "u2", name: "B", saleUuid: "doc" }], at: 1 };
		const { container } = wrap(
			<SubTable model="saleitems" componentName="AuditST_sp" parentKey="saleUuid" parentUuid="doc"
				columnsJson={cols} disabled defaultNewRow={{ name: "" }} />,
		);
		await act(async () => { });
		const scroller = scrollerOf(container);
		await act(async () => { await Promise.resolve(); fireEvent.keyDown(scroller, { key: "ArrowDown" }); });
		await act(async () => { await Promise.resolve(); fireEvent.keyDown(scroller, { key: "ArrowLeft" }); });
		await act(async () => { await Promise.resolve(); fireEvent.keyDown(scroller, { key: "ArrowLeft" }); });
		await act(async () => { await Promise.resolve(); fireEvent.keyDown(scroller, { key: " " }); });
		expect(container.querySelectorAll('tbody tr[data-selected="true"]').length).toBe(0);
		await act(async () => { fireEvent.keyDown(scroller, { key: "Delete" }); await new Promise((r) => setTimeout(r, 10)); });
		expect(del).not.toHaveBeenCalled();
	});
});

describe("Delete по модели выбора (И12)", () => {
	it("«выбраны все» из 100 — клавиша удаляет все 100, а не только отрисованные", async () => {
		srv.s = { items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, uuid: `u${i + 1}`, name: `N${i + 1}`, saleUuid: "doc" })), at: 1 };
		let pending: TDataItem[] = [];
		const { container } = wrap(
			<SubTable model="saleitems" componentName="AuditST_del" parentKey="saleUuid" parentUuid="doc"
				columnsJson={cols} deferRemoteChanges initialPendingRows={[]}
				onItemsChange={(items) => { pending = items.filter((r) => r._pendingAction === "delete"); }} />,
		);
		await act(async () => { });
		act(() => { fireEvent.click(container.querySelector('thead input[type="checkbox"]') as HTMLInputElement); });
		await act(async () => { fireEvent.keyDown(scrollerOf(container), { key: "Delete" }); await new Promise((r) => setTimeout(r, 10)); });
		expect(pending.length).toBe(100);
	});

	it("после Delete активной становится соседняя строка", async () => {
		srv.s = { items: [1, 2, 3].map((i) => ({ id: i, uuid: `u${i}`, name: `N${i}`, saleUuid: "doc" })), at: 1 };
		const { container } = wrap(
			<SubTable model="saleitems" componentName="AuditST_act" parentKey="saleUuid" parentUuid="doc"
				columnsJson={cols} deferRemoteChanges initialPendingRows={[]} onItemsChange={() => { }} />,
		);
		await act(async () => { });
		const tr2 = container.querySelector('tbody tr[data-row-id="2"]') as HTMLElement;
		act(() => { fireEvent.click(tr2.querySelector("td:not([data-col-id='__checkbox'])") ?? tr2); });
		act(() => { fireEvent.click(tr2.querySelector('input[type="checkbox"]')!); });
		await act(async () => { fireEvent.keyDown(scrollerOf(container), { key: "Delete" }); await new Promise((r) => setTimeout(r, 10)); });
		expect(container.querySelector("tbody tr[data-active]")?.getAttribute("data-row-id")).toBe("3");
	});
});

describe("Строки черновика и ⟳ формы (И12)", () => {
	it("новая строка после применения черновика получает свой id, правка не задевает восстановленную", async () => {
		let latest: TDataItem[] = [];
		const api: { current: SubTableApi | null } = { current: null };
		let setPending: (rows: TDataItem[]) => void = () => { };
		function Form() {
			const [pending, sp] = React.useState<TDataItem[]>([]);
			setPending = sp;
			const apiRef = React.useRef<SubTableApi | null>(null);
			React.useEffect(() => { api.current = apiRef.current; });
			return <SubTable model="saleitems" componentName="AuditST_tmp" parentKey="saleUuid" parentUuid=""
				columnsJson={cols} deferRemoteChanges initialPendingRows={pending} defaultNewRow={{ name: "" }} apiRef={apiRef}
				onItemsChange={(items) => sp(items.filter((r) => r._pendingAction))}
				onAllItemsChange={(rows) => { latest = rows; }} />;
		}
		const { container } = wrap(<Form />);
		await act(async () => { });
		await act(async () => { await Promise.resolve();
			setPending([
				{ id: -1, uuid: "tmp-old-1", name: "Старая-1", _pendingAction: "create" },
				{ id: -2, uuid: "tmp-old-2", name: "Старая-2", _pendingAction: "create" },
			] as TDataItem[]);
		});
		await act(async () => { });
		const add = Array.from(container.querySelectorAll("button")).find((b) => /Добав/.test(b.textContent || ""))!;
		await act(async () => { await Promise.resolve(); fireEvent.click(add); });
		const fresh = latest[latest.length - 1];
		expect(new Set(latest.map((r) => r.id)).size).toBe(3);
		await act(async () => { await Promise.resolve(); api.current!.updateRow(fresh, { name: "Новая" }); });
		expect(latest.map((r) => r.name)).toEqual(["Старая-1", "Старая-2", "Новая"]);
	});

	it("⟳ формы при пустой ТЧ на сервере: добавленные строки не остаются «призраками»", async () => {
		let pendingNow: TDataItem[] = [];
		let setPending: (rows: TDataItem[]) => void = () => { };
		function Form() {
			const [pending, sp] = React.useState<TDataItem[]>([]);
			setPending = sp; pendingNow = pending;
			return <SubTable model="saleitems" componentName="AuditST_ph" parentKey="saleUuid" parentUuid="doc"
				columnsJson={cols} deferRemoteChanges initialPendingRows={pending} defaultNewRow={{ name: "x" }}
				onItemsChange={(items) => sp(items.filter((r) => r._pendingAction))} />;
		}
		const { container } = wrap(<Form />);
		await act(async () => { });
		const add = Array.from(container.querySelectorAll("button")).find((b) => /Добав/.test(b.textContent || ""))!;
		await act(async () => { await Promise.resolve(); fireEvent.click(add); });
		expect(pendingNow.length).toBe(1);
		// load(): clearAllTablesPending → затем invalidate → refetch с тем же пустым составом
		await act(async () => { await Promise.resolve(); setPending([]); });
		await act(async () => { await Promise.resolve(); setServer([], 2); });
		expect(container.querySelectorAll("tbody tr[data-row-id]").length).toBe(0);
	});
});

describe("rowModel (И12)", () => {
	it("поздняя правка не воскрешает строку, помеченную на удаление", () => {
		const r = { id: 5, uuid: "u5", price: 10, _pendingAction: "delete" } as TDataItem;
		expect(applyEditMarker(r as never, { price: 20 })._pendingAction).toBe("delete");
	});
	it("isSameRow: при известных uuid совпадение id не считается той же строкой", () => {
		expect(isSameRow({ id: -1, uuid: "tmp-a" } as TDataItem, { id: -1, uuid: "tmp-b" } as TDataItem)).toBe(false);
		expect(isSameRow({ id: 3 } as TDataItem, { id: 3, uuid: "x" } as TDataItem)).toBe(true);
	});
});
