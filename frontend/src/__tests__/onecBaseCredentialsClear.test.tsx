/**
 * «Очистить» служебный вход базы — только после подтверждения (И26 аудита 26.09): пароль не
 * восстановить, агент откатывается на общего администратора баз.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import { translate } from "src/i18";

const api = vi.hoisted(() => ({
	fetchBaseCredentials: vi.fn(() => Promise.resolve({ baseKey: "buh1", user: "svc_admin", hasPassword: true, updatedAt: null, updatedBy: null })),
	clearBaseCredentials: vi.fn(() => Promise.resolve({ ok: true })),
	saveBaseCredentials: vi.fn(),
	fetchAgents: vi.fn(() => Promise.resolve({ items: [] })),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));
vi.mock("src/hooks/useAccessPermission", () => ({
	useAccessPermission: () => ({ canRead: true, canWrite: true, canDelete: true, canCreate: true }),
}));

import { BaseCredentialsTab } from "src/models/OneCBases/BaseCredentials";

const confirm = vi.fn((_: string) => Promise.resolve(false));

const ctx: TypeAppContextProps = {
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
		setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
	},
	actions: { confirm },
	navbar: { props: [], setProps: () => { } },
	auth: { user: { uuid: "me", username: "me" }, logout: () => { } },
};

function setup() {
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<AppContextProvider value={ctx}><BaseCredentialsTab baseKey="buh1" embedded /></AppContextProvider>
		</QueryClientProvider>,
	);
}

describe("очистка служебного входа базы", () => {
	beforeEach(() => {
		confirm.mockClear();
		api.clearBaseCredentials.mockClear();
	});

	it("спрашивает, называя базу и пользователя; «Нет» — ничего не стирается", async () => {
		setup();
		const btn = await screen.findByRole("button", { name: translate("onecCredsClear") });
		await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(btn);
		await waitFor(() => expect(confirm).toHaveBeenCalled());
		expect(confirm.mock.calls[0][0]).toContain("buh1");
		expect(confirm.mock.calls[0][0]).toContain("svc_admin");
		expect(api.clearBaseCredentials).not.toHaveBeenCalled();
	});

	it("«Да» — стирает", async () => {
		confirm.mockImplementationOnce(() => Promise.resolve(true));
		setup();
		const btn = await screen.findByRole("button", { name: translate("onecCredsClear") });
		await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(btn);
		await waitFor(() => expect(api.clearBaseCredentials).toHaveBeenCalledWith("buh1"));
	});
});
