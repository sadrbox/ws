// Карточка агента 1С (28.09): после «Удалить агента» карточка закрывается. Раньше вызывался необязательный
// `paneProps.onClose`, которого у карточки нет (её открывают без него), и форма оставалась открытой с пустыми полями.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import { translate } from "src/i18";

const api = vi.hoisted(() => ({
	fetchAgents: vi.fn(() => Promise.resolve({
		items: [{
			id: "ag-1", name: "Сервер Алматы", role: "business", disabled: true, online: false, capabilities: [],
			instances: [], lastSeenAt: null, os: null, owner: null, organizationUuid: "", serverId: null,
		}],
		limits: {},
	})),
	fetchServers: vi.fn(() => Promise.resolve({ items: [] })),
	deleteAgent: vi.fn((_id: string) => Promise.resolve({ ok: true })),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));

import { AgentForm } from "src/models/OneCAdmin/AgentForm";

afterEach(cleanup);

describe("удаление агента закрывает его карточку", () => {
	it("после подтверждения — удаление и закрытие панели карточки (принудительно: сохранять нечего)", async () => {
		const requestClose = vi.fn((_id: string, _opts?: { force?: boolean }) => Promise.resolve());
		const ctx: TypeAppContextProps = {
			screenRef: { current: null },
			windows: {
				panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose, reloadPane: async () => { },
				setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
			},
			actions: { confirm: () => Promise.resolve(true) },
			navbar: { props: [], setProps: () => { } },
			auth: { user: { uuid: "me", username: "me", isSuperAdmin: true }, logout: () => { } },
		};
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<AppContextProvider value={ctx}>
					<AgentForm uniqId="pane-agent-1" data={{ agentId: "ag-1", uuid: "ag-1" }} />
				</AppContextProvider>
			</QueryClientProvider>,
		);
		const del = await screen.findByRole("button", { name: translate("onecAgentDelete") });
		await waitFor(() => expect((del as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(del);
		fireEvent.click(await screen.findByRole("button", { name: translate("apply") }));
		await waitFor(() => expect(api.deleteAgent).toHaveBeenCalledWith("ag-1"));
		await waitFor(() => expect(requestClose).toHaveBeenCalledWith("pane-agent-1", { force: true }));
	});
});
