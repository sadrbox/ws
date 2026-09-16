/**
 * Воспроизведение: удалить строки, не записывать, нажать «Обновить» — строки не должны дублироваться.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { useRef, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestWrapper } from "./utils/TestWrapper";
import type { TDataItem } from "src/components/Table/types";

type ServerState = { items: TDataItem[]; updatedAt: number };
const listeners = new Set<() => void>();
let server: ServerState = { items: [], updatedAt: 1 };
const setServer = (s: ServerState) => { server = s; listeners.forEach((l) => l()); };

vi.mock("src/hooks/useInfiniteModelList", () => ({
	GLOBAL_ADAPTIVE_LIMIT_REF: { current: 500 },
	useInfiniteModelList: () => {
		const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => server);
		return {
			allItems: s.items, isAnythingLoading: false, isFetchingNextPage: false, hasNextPage: false, error: null,
			refetch: () => Promise.resolve(), fetchNextPage: () => Promise.resolve(), cancelAllRequests: () => {},
			dataUpdatedAt: s.updatedAt,
		};
	},
}));
vi.mock("src/hooks/useModelDelete", () => ({ useModelDelete: () => () => Promise.resolve({ deletedIds: new Set<number>() }) }));

import SubTable, { type SubTableApi } from "src/components/SubTable";

const row = (id: number, name: string): TDataItem => ({ id, uuid: `u${id}`, name, saleUuid: "doc-1" } as unknown as TDataItem);

describe("SubTable: «Обновить» после несохранённого удаления", () => {
	it("строки не дублируются", async () => {
		setServer({ items: [row(1, "Альфа"), row(2, "Бета"), row(3, "Гамма"), row(4, "Дельта")], updatedAt: 1 });
		const qc = new QueryClient();
		// «Обновить»: сервис отдаёт тот же состав новым массивом.
		vi.spyOn(qc, "invalidateQueries").mockImplementation(() => {
			setServer({ items: server.items.map((r) => ({ ...r })), updatedAt: server.updatedAt + 1 });
			return Promise.resolve();
		});
		let latest: TDataItem[] = [];
		const apiHolder: { current: SubTableApi | null } = { current: null };

		function Form() {
			const [pending, setPending] = useState<TDataItem[]>([]);
			const apiRef = useRef<SubTableApi | null>(null);
			apiHolder.current = apiRef.current;
			return (
				<SubTable
					model="saleitems" componentName="T_refresh" parentKey="saleUuid" parentUuid="doc-1"
					columnsJson={[{ identifier: "name", type: "string", visible: true, inlist: true } as never]}
					deferRemoteChanges initialPendingRows={pending}
					onItemsChange={(items) => setPending(items.filter((r) => (r as { _pendingAction?: string })._pendingAction))}
					onAllItemsChange={(rows) => { latest = rows; }}
					apiRef={apiRef}
				/>
			);
		}

		render(<QueryClientProvider client={qc}><TestWrapper><Form /></TestWrapper></QueryClientProvider>);
		await act(async () => {});
		expect(latest.map((r) => r.uuid)).toEqual(["u1", "u2", "u3", "u4"]);

		// Удаляем две строки, не записывая.
		await act(async () => { await apiHolder.current?.removeRow(latest[1]); });
		await act(async () => { await apiHolder.current?.removeRow(latest.find((r) => r.uuid === "u3")!); });

		// «Обновить» в командной панели таблицы.
		const reload = screen.getAllByRole("button").find((b) => /обнов/i.test(`${b.getAttribute("title") ?? ""} ${b.getAttribute("aria-label") ?? ""}`));
		expect(reload).toBeTruthy();
		act(() => { fireEvent.click(reload!); });
		await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

		const uuids = latest.map((r) => r.uuid);
		expect(new Set(uuids).size).toBe(uuids.length);
		expect([...uuids].sort()).toEqual(["u1", "u2", "u3", "u4"]);
	});
});
