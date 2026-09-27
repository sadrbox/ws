/**
 * Опрос агентов 1С (О4 аудита 26.09): один таймер на всё приложение, а не на каждого наблюдателя,
 * и никакого опроса, пока панель скрыта.
 */
import type { FC } from "react";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchAgents: vi.fn(() => Promise.resolve({ items: [] })) }));
vi.mock("src/services/onec/api", async (orig) => {
	const real = await orig<typeof import("src/services/onec/api")>();
	return { ...real, fetchAgents: api.fetchAgents };
});

import { agentsWatchersOnScreen, AGENTS_POLL_MS, useAgents } from "src/models/OneCAdmin/agentsQuery";
import { PaneActiveContext, PaneActiveProvider, usePaneActive } from "src/hooks/usePaneActive";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";

const Watcher: FC = () => {
	useAgents();
	return null;
};

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("опрос агентов 1С", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		api.fetchAgents.mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("три наблюдателя — один запрос за интервал, а не три", async () => {
		const qc = client();
		const { unmount } = render(
			<QueryClientProvider client={qc}>
				<Watcher /><Watcher /><Watcher />
			</QueryClientProvider>,
		);
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(api.fetchAgents).toHaveBeenCalledTimes(1);
		await act(async () => { await vi.advanceTimersByTimeAsync(AGENTS_POLL_MS); });
		expect(api.fetchAgents).toHaveBeenCalledTimes(2);
		await act(async () => { await vi.advanceTimersByTimeAsync(AGENTS_POLL_MS); });
		expect(api.fetchAgents).toHaveBeenCalledTimes(3);
		unmount();
		expect(agentsWatchersOnScreen()).toBe(0);
	});

	it("скрытая панель не опрашивает", async () => {
		const qc = client();
		const { unmount } = render(
			<QueryClientProvider client={qc}>
				<PaneActiveContext.Provider value={false}>
					<Watcher />
				</PaneActiveContext.Provider>
			</QueryClientProvider>,
		);
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(api.fetchAgents).toHaveBeenCalledTimes(1);
		expect(agentsWatchersOnScreen()).toBe(0);
		await act(async () => { await vi.advanceTimersByTimeAsync(AGENTS_POLL_MS * 3); });
		expect(api.fetchAgents).toHaveBeenCalledTimes(1);
		unmount();
	});
});

describe("признак «панель активна»", () => {
	const ctx = (activePane: string | null): TypeAppContextProps => ({
		screenRef: { current: null },
		windows: {
			panes: [], paneOrder: [], activePane, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
			setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
		},
		actions: { confirm: () => Promise.resolve(true) },
		navbar: { props: [], setProps: () => { } },
		auth: { user: null, logout: () => { } },
	});
	const Probe: FC<{ id: string }> = ({ id }) => <span data-testid={id}>{String(usePaneActive())}</span>;

	it("активна только своя панель; встроенный без uniqId наследует внешнюю; вне панели — активна", () => {
		const { getByTestId } = render(
			<AppContextProvider value={ctx("p1")}>
				<PaneActiveProvider uniqId="p1"><Probe id="a" /></PaneActiveProvider>
				<PaneActiveProvider uniqId="p2">
					<Probe id="b" />
					<PaneActiveProvider><Probe id="c" /></PaneActiveProvider>
				</PaneActiveProvider>
				<Probe id="d" />
			</AppContextProvider>,
		);
		expect(getByTestId("a").textContent).toBe("true");
		expect(getByTestId("b").textContent).toBe("false");
		expect(getByTestId("c").textContent).toBe("false");
		expect(getByTestId("d").textContent).toBe("true");
	});
});
