/**
 * Действия над задачей в форме (E17 СК1): «Принять в работу», «Нужна помощь», «Действия ▾».
 * Сервер — заглушки services/quality/api: проверяется, что форма зовёт нужное действие с нужными
 * данными, не отправляет заведомый отказ и перечитывает задачу после успеха.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";
import TodoActions from "src/models/Todos/TodoActions";
import type { StatusLike } from "src/models/Todos/todoRules";

const api = vi.hoisted(() => ({
	acceptTodo: vi.fn(() => Promise.resolve({ success: true })),
	remindTodo: vi.fn(() => Promise.resolve({ success: true })),
	returnTodo: vi.fn(() => Promise.resolve({ success: true })),
	helpTodo: vi.fn(() => Promise.resolve({ success: true, notified: 1 })),
	rateTodo: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock("src/services/quality/api", () => api);

const STATUSES: StatusLike[] = [
	{ code: "new", name: "Новая", isFinal: false },
	{ code: "in_progress", name: "В работе", isFinal: false },
	{ code: "done", name: "Выполнена", isFinal: true },
];

const wrap = (ui: ReactNode) => {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<QueryClientProvider client={qc}><TestWrapper>{ui}</TestWrapper></QueryClientProvider>);
};

const props = (over: Partial<Parameters<typeof TodoActions>[0]> = {}) => ({
	uuid: "t-1", kind: "client_request", status: "new", acceptedAt: "", statuses: STATUSES,
	busy: false, dirty: false, onNotices: vi.fn(), onDone: vi.fn(), ...over,
});

describe("TodoActions — действия над задачей", () => {
	beforeEach(() => Object.values(api).forEach((f) => f.mockClear()));

	it("непринятое обращение: «Принять в работу» зовёт accept и перечитывает задачу", async () => {
		const p = props();
		wrap(<TodoActions {...p} />);
		fireEvent.click(screen.getByRole("button", { name: translate("todoAccept") }));
		await waitFor(() => expect(p.onDone).toHaveBeenCalled());
		expect(api.acceptTodo).toHaveBeenCalledWith("t-1");
	});

	it("несохранённые правки: действия недоступны и говорят почему", () => {
		wrap(<TodoActions {...props({ dirty: true })} />);
		const accept = screen.getByRole("button", { name: translate("todoAccept") });
		expect(accept).toBeDisabled();
		expect(accept.getAttribute("title")).toBe(translate("todoActionSaveFirst"));
	});

	it("закрытая задача: нет «Принять» и «Нужна помощь», возврат без причины не уходит на сервер", async () => {
		const p = props({ status: "done", acceptedAt: "2026-09-25T05:00:00Z" });
		wrap(<TodoActions {...p} />);
		expect(screen.queryByRole("button", { name: translate("todoAccept") })).toBeNull();
		expect(screen.queryByRole("button", { name: translate("todoHelp") })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: new RegExp(translate("todoActions")) }));
		fireEvent.click(screen.getByRole("menuitem", { name: translate("todoReturn") }));
		fireEvent.click(screen.getByRole("button", { name: translate("todoReturnApply") }));
		expect(await screen.findByText(translate("todoReturnReasonRequired"))).toBeTruthy();
		expect(api.returnTodo).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText(translate("todoReturnReason"), { exact: false }), { target: { value: "Акт сверки не подписан" } });
		fireEvent.click(screen.getByRole("button", { name: translate("todoReturnApply") }));
		await waitFor(() => expect(api.returnTodo).toHaveBeenCalledWith("t-1", "Акт сверки не подписан"));
		await waitFor(() => expect(p.onDone).toHaveBeenCalled());
	});

	it("«Нужна помощь» отправляет комментарий главбуху", async () => {
		const p = props({ kind: "task", status: "in_progress" });
		wrap(<TodoActions {...p} />);
		fireEvent.click(screen.getByRole("button", { name: translate("todoHelp") }));
		fireEvent.change(screen.getByLabelText(translate("todoHelpNote"), { exact: false }), { target: { value: "Не понимаю, как отразить аванс" } });
		fireEvent.click(screen.getByRole("button", { name: translate("todoHelpApply") }));
		await waitFor(() => expect(api.helpTodo).toHaveBeenCalledWith("t-1", "Не понимаю, как отразить аванс"));
	});

	it("новая (несохранённая) задача — действий нет вовсе", () => {
		const { container } = wrap(<TodoActions {...props({ uuid: "" })} />);
		expect(container.querySelectorAll("button")).toHaveLength(0);
	});
});
