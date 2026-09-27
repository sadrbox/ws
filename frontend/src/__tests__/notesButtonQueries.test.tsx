/**
 * Кнопка заметок: бейдж и окно читают один запрос (аудит 26.09, О4).
 *
 * Раньше бейдж держал свой ключ («…, count»), и тот же GET notes уходил ещё раз при открытии
 * окна и дважды после каждой правки.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn<(url: string, config?: unknown) => Promise<unknown>>();
vi.mock("src/services/api/client", () => ({
	__esModule: true,
	default: { get: (url: string, config?: unknown) => getMock(url, config), post: vi.fn(), delete: vi.fn() },
}));
vi.mock("src/i18", () => ({ translate: (key: string) => key }));
vi.mock("src/components/Modal", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <div data-testid="modal">{children}</div>,
}));
vi.mock("src/app/context", () => ({
	useAppContext: () => ({ windows: { addPane: vi.fn() } }),
	useAppActions: () => ({ windows: { addPane: vi.fn() } }),
}));

import NotesButton from "src/components/Notes/NotesButton";

const notesCalls = () => getMock.mock.calls.filter(([url]) => url === "notes").length;

describe("NotesButton", () => {
	beforeEach(() => {
		getMock.mockReset();
		getMock.mockImplementation((url: string) => Promise.resolve(url === "notes"
			? { data: { items: [{ uuid: "n1", body: "Позвонить клиенту", createdAt: "2026-09-01T00:00:00Z" }] } }
			: { data: { items: [] } }));
	});

	it("бейдж и открытое окно — один запрос заметок", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(<QueryClientProvider client={client}><NotesButton endpoint="sales" uuid="s1" /></QueryClientProvider>);
		await waitFor(() => expect(screen.getByText("1")).toBeTruthy());
		expect(notesCalls()).toBe(1);

		fireEvent.click(screen.getByRole("button", { name: "notes" }));
		expect(await screen.findByText("Позвонить клиенту")).toBeTruthy();
		expect(notesCalls()).toBe(1);
	});
});
