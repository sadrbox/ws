/**
 * Вкладка «Организации баз» (Б11 аудита 26.09): ожидающие БИНы видны с совпадением по ERP, одобрение и отказ идут
 * только через подтверждение, называющее организацию и базу.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import { translate } from "src/i18";

const api = vi.hoisted(() => ({
	fetchPendingBaseOrganizations: vi.fn(() => Promise.resolve({ items: [{
		baseId: "b1b1b1b1-0000-0000-0000-000000000001", baseKey: "buh_nord", baseName: "Nord Beer", server: "srv1c",
		bin: "180240037695", name: "ТОО Nord Beer", onecId: null, requestedAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
	}] })),
	fetchErpOrganizations: vi.fn(() => Promise.resolve({ items: [{ uuid: "o-1", name: "ТОО Nord Beer", bin: "180240037695" }] })),
	decideBaseOrganization: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));

import { BaseOrganizationsTab } from "src/models/OneCAdmin/BaseOrganizationsTab";

const confirm = vi.fn((_: string) => Promise.resolve(false));
const ctx: TypeAppContextProps = {
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
		setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
	},
	actions: { confirm },
	navbar: { props: [], setProps: () => { } },
	auth: { user: { uuid: "me", username: "me", isSuperAdmin: true }, logout: () => { } },
};

function setup() {
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<AppContextProvider value={ctx}><BaseOrganizationsTab /></AppContextProvider>
		</QueryClientProvider>,
	);
}

describe("вкладка «Организации баз»", () => {
	beforeEach(() => {
		confirm.mockClear();
		api.decideBaseOrganization.mockClear();
	});

	it("показывает ожидающий БИН и совпадение с организацией ERP", async () => {
		setup();
		expect(await screen.findByText("180240037695", undefined, { timeout: 5000 })).toBeTruthy();
		expect(await screen.findByText(`ТОО Nord Beer — ${translate("onecReqBinMatch")}`)).toBeTruthy();
	});

	it("«Одобрить» по активной строке — подтверждение с организацией и базой; «Нет» — запроса нет, «Да» — approve", async () => {
		setup();
		fireEvent.click(await screen.findByText("180240037695", undefined, { timeout: 5000 }));
		const approve = screen.getByRole<HTMLButtonElement>("button", { name: translate("onecReqApprove") });
		await waitFor(() => expect(approve.disabled).toBe(false));
		fireEvent.click(approve);
		await waitFor(() => expect(confirm).toHaveBeenCalled());
		expect(confirm.mock.calls[0][0]).toContain("180240037695");
		expect(confirm.mock.calls[0][0]).toContain("buh_nord");
		expect(api.decideBaseOrganization).not.toHaveBeenCalled();

		confirm.mockImplementationOnce(() => Promise.resolve(true));
		fireEvent.click(approve);
		await waitFor(() => expect(api.decideBaseOrganization).toHaveBeenCalledWith("b1b1b1b1-0000-0000-0000-000000000001", "180240037695", "approve"));
	});

	it("«Отклонить» — тот же путь с подтверждением", async () => {
		confirm.mockImplementationOnce(() => Promise.resolve(true));
		setup();
		fireEvent.click(await screen.findByText("180240037695", undefined, { timeout: 5000 }));
		const reject = screen.getByRole<HTMLButtonElement>("button", { name: translate("onecReqReject") });
		await waitFor(() => expect(reject.disabled).toBe(false));
		fireEvent.click(reject);
		await waitFor(() => expect(api.decideBaseOrganization).toHaveBeenCalledWith("b1b1b1b1-0000-0000-0000-000000000001", "180240037695", "reject"));
	});
});
