/**
 * Карточка «База 1С»: наименование правится, остальное — только показывается (28.09).
 *
 * Имя в панели записывает сервис (PUT /bases/:key/name): пустое поле и имя, совпавшее с кластерным, снимают правку —
 * дальше имя снова идёт из кластера. Несохранённое наименование держит закрытие вопросом, как в любой форме. Кнопки,
 * дублировавшие меню «Операции» и вкладки формы, из «Основного» убраны.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import { translate } from "src/i18";

const registry = vi.hoisted(() => ({
	base: {
		id: "reg-1", serverId: "srv-1", serverName: "SERVER", key: "buh1", name: "Бухгалтерия (основная)",
		clusterName: "buh1 descr", nameCustom: true, status: "ONLINE", clusterStatus: "ONLINE", disabled: false,
	} as Record<string, unknown>,
}));
const api = vi.hoisted(() => ({
	fetchBases: vi.fn(() => Promise.resolve({ items: [registry.base] })),
	fetchAgents: vi.fn(() => Promise.resolve({ items: [] })),
	fetchBaseExtensionsCached: vi.fn(() => Promise.resolve({ items: [] })),
	fetchBaseUsersCached: vi.fn(() => Promise.resolve({ items: [] })),
	fetchSessions: vi.fn(() => Promise.resolve({ items: [] })),
	renameBase: vi.fn((_key: string, name: string) => Promise.resolve({ ok: true, name: name || null })),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));
vi.mock("src/hooks/useAccessPermission", () => ({
	useAccessPermission: () => ({ canRead: true, canWrite: true, canDelete: true, canCreate: true }),
}));
vi.mock("src/models/OneCAdmin/progress", async (orig) => ({
	...(await orig<typeof import("src/models/OneCAdmin/progress")>()),
	withOp: (_op: unknown, fn: () => Promise<unknown>) => fn(),
}));
// Вкладки и таблицы карточки к наименованию отношения не имеют: каждая ходила бы в сервис своими запросами.
vi.mock("src/components/Table", () => ({ default: () => null }));
vi.mock("src/models/OneCBases/BaseMaintenance", () => ({ default: () => null }));
vi.mock("src/models/OneCBases/BaseChatTokens", () => ({ default: () => null }));
vi.mock("src/models/OneCBases/BaseChatCalls", () => ({ default: () => null }));
vi.mock("src/models/OneCBases/BaseCredentials", () => ({ default: () => null }));

import { OneCBasesForm } from "src/models/OneCBases";

const confirm = vi.fn((_: string) => Promise.resolve(false));
const guards = new Map<string, () => Promise<boolean> | boolean>();

const ctx: TypeAppContextProps = {
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
		setActivePane: () => { }, updatePaneLabel: () => { },
		registerBeforeClose: (id: string, fn: () => Promise<boolean> | boolean) => { guards.set(id, fn); return () => { guards.delete(id); }; },
	},
	actions: { confirm },
	navbar: { props: [], setProps: () => { } },
	auth: { user: { uuid: "me", username: "me" }, logout: () => { } },
};

function setup() {
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<AppContextProvider value={ctx}>
				<OneCBasesForm uniqId="pane-buh1" data={{ baseKey: "buh1", name: "Бухгалтерия (основная)" } as unknown as TDataItem} />
			</AppContextProvider>
		</QueryClientProvider>,
	);
	return screen.getByRole<HTMLInputElement>("textbox", { name: translate("name") });
}

describe("карточка базы: наименование", () => {
	beforeEach(() => {
		api.renameBase.mockClear();
		confirm.mockClear();
		guards.clear();
	});

	it("новое имя записывается по Enter", async () => {
		const input = setup();
		await waitFor(() => expect(input.value).toBe("Бухгалтерия (основная)"));
		fireEvent.change(input, { target: { value: "  Бухгалтерия 2026  " } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(api.renameBase).toHaveBeenCalledWith("buh1", "Бухгалтерия 2026"));
	});

	it("пустое поле и имя из кластера снимают правку: уходит пустое имя", async () => {
		const input = setup();
		await waitFor(() => expect(input.placeholder).toBe("buh1 descr"));
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(api.renameBase).toHaveBeenLastCalledWith("buh1", ""));
		fireEvent.change(input, { target: { value: "buh1 descr" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(api.renameBase).toHaveBeenCalledTimes(2));
		expect(api.renameBase).toHaveBeenLastCalledWith("buh1", "");
	});

	it("без правки записывать нечего; несохранённое имя держит закрытие вопросом", async () => {
		const input = setup();
		await waitFor(() => expect(input.value).toBe("Бухгалтерия (основная)"));
		fireEvent.keyDown(input, { key: "Enter" });
		expect(api.renameBase).not.toHaveBeenCalled();
		const guard = guards.get("pane-buh1")!;
		expect(await guard()).toBe(true);
		expect(confirm).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: "Другое" } });
		let allowed: boolean | undefined;
		await act(async () => { allowed = await guards.get("pane-buh1")!(); });
		expect(confirm).toHaveBeenCalledWith(translate("confirmCloseUnsaved"));
		expect(allowed).toBe(false);
		// Escape — вернуть имя из реестра: правки нет, и закрытие снова ничего не спрашивает.
		fireEvent.keyDown(input, { key: "Escape" });
		expect(input.value).toBe("Бухгалтерия (основная)");
	});

	it("своих кнопок у «Основного» нет: команды над базой — в «Операциях», переходы — вкладками формы", async () => {
		setup();
		await waitFor(() => expect(api.fetchBases).toHaveBeenCalled());
		const main = screen.getAllByRole("tabpanel")[0];
		const labels = Array.from(main.querySelectorAll("button")).map((b) => b.textContent?.trim());
		for (const gone of ["onecBaseInfoRefresh", "onecTabSessions", "onecTabUsers", "onecTabUsersList", "onecTabExtensions", "onecPublish", "onecUnpublish"]) {
			expect(labels).not.toContain(translate(gone));
		}
		expect(labels).not.toContain("Проверить");
		// Вход в базу закрывают и открывают из «Операции» → «Блокировка сеансов» (28.09).
		expect(labels).not.toContain("Открыть");
		expect(labels).not.toContain("Закрыть");
		// «Служебный вход» здесь заглушен — остальные кнопки вкладки были бы только его.
		expect(labels).toEqual([]);
		expect(main.textContent).not.toContain("Доступность базы");
	});
});
