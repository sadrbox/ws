// «Базы 1С» в карточке организации (28.09): таблица — общий компонент Table, а не самодельная <table>.
// Строки несут значения колонок текстом (поиск и сортировка по ним), отключённая база помечается, статус чата
// раскрашивается, БИН без объявления — «—».
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrganizationBase } from "src/services/onec/api";

const items: OrganizationBase[] = [
	{ baseKey: "buh_alma", name: "Бухгалтерия Алматы", serverName: "SERVER", disabled: false, chat: "active", declaredBin: "123456789012", declaredAt: null, lastSeenAt: "2026-09-27T10:00:00Z" },
	{ baseKey: "old_base", name: "", serverName: null, disabled: true, chat: "revoked", declaredBin: null, declaredAt: null, lastSeenAt: null },
];

// Частичный мок: модули панели 1С по цепочке импортов берут из api и другие функции.
vi.mock("src/services/onec/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/services/onec/api")>()),
	fetchOrganizationBases: () => Promise.resolve({ bin: "123456789012", items }),
}));

import { organizationBaseRows } from "src/models/Organizations/onecBasesView";
import OnecBasesTab from "src/models/Organizations/OnecBasesTab";

describe("Базы 1С в карточке организации", () => {
	it("строки: текст колонок, признаки для раскраски, пустые значения — «—», устойчивые id", () => {
		const rows = organizationBaseRows(items);
		expect(rows.map((r) => [r.onecBase, r.onecServer, r.binIin, r.__disabled, r.__chat])).toEqual([
			["Бухгалтерия Алматы", "SERVER", "123456789012", false, "active"],
			["old_base", "—", "—", true, "revoked"],
		]);
		expect(rows[0].onecOrgBaseLastSeen).toBe("2026-09-27T10:00:00Z");
		expect(rows[1].onecOrgBaseLastSeen).toBeNull();
		expect(new Set(rows.map((r) => r.id)).size).toBe(2);
		expect(organizationBaseRows(items).map((r) => r.id)).toEqual(rows.map((r) => r.id));
	});

	it("вкладка рисует общий Table: заголовки колонок из словаря, строки баз, пометка отключённой", async () => {
		const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { container } = render(<QueryClientProvider client={qc}><OnecBasesTab organizationUuid="org-1" /></QueryClientProvider>);
		await waitFor(() => expect(screen.getByText("Бухгалтерия Алматы")).toBeTruthy());
		// Самодельной таблицы со старыми классами больше нет — только разметка Table.
		expect(container.querySelectorAll("table").length).toBeGreaterThan(0);
		for (const title of ["База", "Сервер 1С", "Чат в 1С", "БИН / ИНН", "Была на связи"]) {
			expect(screen.getAllByText(title).length).toBeGreaterThan(0);
		}
		expect(screen.getByText("old_base")).toBeTruthy();
		expect(screen.getByText(/Скрыта/)).toBeTruthy();
		expect(screen.getByText("123456789012")).toBeTruthy();
	});
});
