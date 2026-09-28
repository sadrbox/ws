// «Управление 1С» → «Агенты 1С» (28.09): шесть кнопок командной панели — одним меню «Операции», как у списка баз
// кластера. Разделы: подключение (без отметок), работа отмеченных, служба агента (опасное — последним). У каждого
// пункта подсказка при наведении: что он сделает или почему сейчас недоступен.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import { translate } from "src/i18";
import type { OnecAgent } from "src/services/onec/api";
import { agentOperationsMenu, agentOpTargets } from "src/models/OneCAdmin/agentsOperations";

const agent = (id: string, over: Partial<OnecAgent> = {}) => ({
	id, name: id, role: "business", disabled: false, online: true, capabilities: ["agent.restart", "agent.update"],
	instances: [], lastSeenAt: null, os: null, ...over,
}) as unknown as OnecAgent;

const api = vi.hoisted(() => ({
	fetchAgents: vi.fn(() => Promise.resolve({ items: [] as unknown[], limits: { latestBuild: "2026-09-28 18:27" } })),
	fetchServers: vi.fn(() => Promise.resolve({ items: [] })),
	fetchErpOrganizations: vi.fn(() => Promise.resolve({ items: [] })),
	setAgentDisabled: vi.fn((_id: string, _disabled: boolean) => Promise.resolve({})),
	restartAgent: vi.fn((_id: string, _reason?: string) => Promise.resolve({})),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));

import { AgentsTab } from "src/models/OneCAdmin/AgentsTab";

afterEach(cleanup);

const byId = (opts: ReturnType<typeof agentOperationsMenu>) => Object.fromEntries(opts.map((o) => [o.id, o]));

describe("меню «Операции» списка агентов", () => {
	it("разделы по порядку, у каждого пункта — подсказка; служба агента — опасным разделом", () => {
		const opts = agentOperationsMenu([agent("a")], "2026-09-28 18:27");
		expect(opts.map((o) => o.id)).toEqual(["enroll", "create", "disable", "enable", "restart", "update"]);
		expect([...new Set(opts.map((o) => o.group))]).toEqual([
			translate("onecAgentOpsConnect"), translate("onecAgentOpsAccess"), translate("onecAgentOpsService"),
		]);
		for (const o of opts) expect(o.hint, o.id).toBeTruthy();
		expect(opts.filter((o) => o.danger).map((o) => o.id)).toEqual(["restart", "update"]);
		expect(byId(opts).update.hint).toContain("2026-09-28 18:27");
	});

	it("без отметок: подключение доступно, команды над отмеченными — нет, с причиной «отметьте агентов»", () => {
		const o = byId(agentOperationsMenu([]));
		expect(o.enroll.disabled).toBeFalsy();
		expect(o.create.disabled).toBeFalsy();
		for (const id of ["disable", "enable", "restart", "update"]) {
			expect(o[id].disabled, id).toBe(true);
			expect(o[id].hint, id).toContain(translate("onecAgentOpPick"));
		}
	});

	it("по состоянию отмеченных: «Отключить» — включённым, «Включить» — отключённым; число — сколько затронет", () => {
		const on = agent("on"), off = agent("off", { disabled: true });
		const o = byId(agentOperationsMenu([on, off]));
		expect(o.disable.label).toBe(`${translate("onecAgentDisable")} (1)`);
		expect(o.enable.label).toBe(`${translate("onecAgentEnable")} (1)`);
		expect(agentOpTargets([on, off]).disable.map((a) => a.id)).toEqual(["on"]);
		expect(byId(agentOperationsMenu([off])).disable.hint).toContain(translate("onecAgentOpAllDisabled"));
		expect(byId(agentOperationsMenu([on])).enable.hint).toContain(translate("onecAgentOpNoneDisabled"));
	});

	it("служба: только умеющим и на связи; иначе — причина: не умеет или не на связи", () => {
		const notService = agent("ns", { capabilities: [] });
		const offline = agent("off", { online: false });
		expect(byId(agentOperationsMenu([notService])).restart.hint).toContain(translate("onecAgentOpNotService"));
		expect(byId(agentOperationsMenu([offline])).update.hint).toContain(translate("onecAgentOpOffline"));
		const t = agentOpTargets([agent("ok"), notService, offline, agent("dis", { disabled: true })]);
		expect(t.restart.map((a) => a.id)).toEqual(["ok"]);
		expect(t.update.map((a) => a.id)).toEqual(["ok"]);
	});
});

describe("вкладка «Агенты 1С»", () => {
	const ctx: TypeAppContextProps = {
		screenRef: { current: null },
		windows: {
			panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
			setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
		},
		actions: { confirm: () => Promise.resolve(true) },
		navbar: { props: [], setProps: () => { } },
		auth: { user: { uuid: "me", username: "me", isSuperAdmin: true }, logout: () => { } },
	};

	it("в командной панели одна кнопка «Операции» вместо шести; пункты с подсказками при наведении", async () => {
		api.fetchAgents.mockResolvedValue({ items: [agent("a")], limits: { latestBuild: "2026-09-28 18:27" } });
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<AppContextProvider value={ctx}><AgentsTab /></AppContextProvider>
			</QueryClientProvider>,
		);
		const ops = await screen.findByRole("button", { name: new RegExp(translate("onecOperations")) });
		expect(ops.getAttribute("title")).toBe(translate("onecAgentOpsTitle"));
		for (const old of ["onecAgentCreate", "onecEnrollByCode", "onecAgentRestart", "onecAgentUpdate"]) {
			expect(screen.queryByRole("button", { name: translate(old) }), old).toBeNull();
		}
		fireEvent.click(ops);
		const items = await waitFor(() => {
			const list = screen.getAllByRole("menuitem");
			expect(list.length).toBe(6);
			return list;
		});
		for (const item of items) expect(item.getAttribute("title"), item.textContent ?? "").toBeTruthy();
		expect(items[0].textContent).toContain(translate("onecEnrollByCode"));
	});

	it("команда уходит только отмеченным агентам, а не всему списку (регрессия 28.09)", async () => {
		api.fetchAgents.mockResolvedValue({
			items: [agent("alpha"), agent("beta"), agent("gamma")], limits: { latestBuild: "2026-09-28 18:27" },
		});
		api.setAgentDisabled.mockClear();
		api.restartAgent.mockClear();
		const { container } = render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<AppContextProvider value={ctx}><AgentsTab /></AppContextProvider>
			</QueryClientProvider>,
		);
		await screen.findByText("beta");
		// Отмечаем одного — «beta».
		const row = [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("beta"))!;
		fireEvent.click(row.querySelector('input[type="checkbox"]')!);

		const ops = screen.getByRole("button", { name: new RegExp(translate("onecOperations")) });
		await waitFor(() => expect(ops.getAttribute("title")).toBe(`${translate("onecAgentsMarked")}: 1`));
		fireEvent.click(ops);
		const disable = await screen.findByRole("menuitem", { name: new RegExp(translate("onecAgentDisable")) });
		expect(disable.textContent).toContain("(1)");
		fireEvent.click(disable);
		fireEvent.click(await screen.findByRole("button", { name: translate("apply") }));
		await waitFor(() => expect(api.setAgentDisabled).toHaveBeenCalledTimes(1));
		expect(api.setAgentDisabled).toHaveBeenCalledWith("beta", true);

		// И служебная команда — тоже только ему.
		fireEvent.click(ops);
		fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(translate("onecAgentRestart")) }));
		fireEvent.click(await screen.findByRole("button", { name: translate("apply") }));
		await waitFor(() => expect(api.restartAgent).toHaveBeenCalledTimes(1));
		expect(api.restartAgent.mock.calls[0][0]).toBe("beta");
	});
});
