/**
 * Доска задач (E17): задачи со статусом вне справочника видны, у карточек — значки, щелчок по
 * карточке открывает задачу. Сервер — подменённый apiClient.get, открытие формы — заглушка реестра.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRef, type FC, type ReactNode } from "react";
import { translate } from "src/i18";
import { apiClient } from "src/services/api/client";
import { AppContextProvider } from "src/app/context";
import type { TPane, TypeAppContextProps } from "src/app/types";
import TaskBoard from "src/models/TaskBoard";

const reg = vi.hoisted(() => {
	const FakeTodoForm = () => null;
	return { FakeTodoForm, loadFormByEndpoint: vi.fn(() => Promise.resolve(FakeTodoForm)) };
});
vi.mock("src/registry/modelRegistry", () => ({ loadFormByEndpoint: reg.loadFormByEndpoint }));

const STATUSES = [
	{ uuid: "s1", code: "new", name: "Новая", sortOrder: 10, isFinal: false },
	{ uuid: "s2", code: "waiting_client", name: "Ждём клиента", sortOrder: 24, isFinal: false, isWaiting: true },
	{ uuid: "s3", code: "done", name: "Выполнена", sortOrder: 30, isFinal: true },
];
const TODOS = [
	{ uuid: "t1", id: 1, status: "new", description: "Обращение без реакции", kind: "client_request", acceptedAt: null, reactionDueAt: "2020-01-01T00:00:00Z", reminderCount: 2 },
	{ uuid: "t2", id: 2, status: "legacy_status", description: "Задача со старым статусом", kind: "task" },
	{ uuid: "t3", id: 3, status: "done", description: "Закрытая ошибка", kind: "error", result: "Исправлено и проверено" },
];

const addPane = vi.fn();
const Ctx: FC<{ children: ReactNode }> = ({ children }) => {
	const screenRef = useRef<HTMLDivElement | null>(null);
	const value = {
		screenRef,
		windows: {
			panes: [], paneOrder: [], activePane: null, addPane,
			requestClose: async () => { }, reloadPane: async () => { }, setActivePane: () => { }, updatePaneLabel: () => { },
			registerBeforeClose: () => () => { },
		},
		actions: { confirm: () => Promise.resolve(true) },
		navbar: { props: [], setProps: () => { } },
		auth: { user: null, logout: () => { } },
	} as unknown as TypeAppContextProps;
	return <AppContextProvider value={value}>{children}</AppContextProvider>;
};

const renderBoard = () => {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<QueryClientProvider client={qc}><Ctx><TaskBoard /></Ctx></QueryClientProvider>);
};

describe("TaskBoard — доска задач", () => {
	beforeEach(() => {
		addPane.mockClear();
		vi.spyOn(apiClient, "get").mockImplementation((url: string) => {
			if (url === "todo-statuses") return Promise.resolve({ data: { items: STATUSES } });
			if (url === "todos") return Promise.resolve({ data: { items: TODOS } });
			return Promise.reject(new Error(`unexpected ${url}`));
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("задача со статусом вне справочника не пропадает — у неё своя колонка", async () => {
		renderBoard();
		expect(await screen.findByText("Задача со старым статусом")).toBeTruthy();
		expect(screen.getByText(`legacy_status · ${translate("taskStatusUnknown")}`)).toBeTruthy();
		// Колонки справочника — на месте, в своём порядке.
		expect(screen.getByText("Ждём клиента")).toBeTruthy();
	});

	it("значки: обращение, просроченная реакция, напоминания; у закрытой ошибки — только вид", async () => {
		renderBoard();
		const card = (await screen.findByText("Обращение без реакции")).closest("[role='button']") as HTMLElement;
		expect(within(card).getByText(translate("taskBadgeClientRequest"))).toBeTruthy();
		expect(within(card).getByText(translate("taskBadgeSla"))).toBeTruthy();
		expect(within(card).getByText(translate("taskBadgeReminders").replace("{n}", "2"))).toBeTruthy();
		const closed = screen.getByText("Закрытая ошибка").closest("[role='button']") as HTMLElement;
		expect(within(closed).getByText(translate("taskBadgeError"))).toBeTruthy();
		expect(within(closed).queryByText(translate("taskBadgeSla"))).toBeNull();
	});

	it("щелчок по карточке открывает задачу", async () => {
		renderBoard();
		fireEvent.click(await screen.findByText("Задача со старым статусом"));
		await waitFor(() => expect(addPane).toHaveBeenCalled());
		const pane = addPane.mock.calls[0][0] as Partial<TPane>;
		expect(pane.component).toBe(reg.FakeTodoForm);
		expect(pane.data).toEqual({ uuid: "t2" });
		expect(pane.restore).toEqual({ kind: "form", endpoint: "todos", uuid: "t2" });
	});
});
