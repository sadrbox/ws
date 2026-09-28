// «Долги и остатки из 1С» в карточке организации (28.09): обе таблицы — общий компонент Table, а не самодельные
// <table>. Суммы остаются числами (сортировка, итог в подвале), показываются с разрядами; итог — свой по показанным
// строкам, а если 1С прислала итоги по всем контрагентам — они; просрочка красная.
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrganizationFinance } from "src/services/onec/api";

let finance: OrganizationFinance;

vi.mock("src/services/onec/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/services/onec/api")>()),
	fetchOrganizationFinance: () => Promise.resolve(finance),
}));

import { balanceTableRows, debtFooterValues, debtTableRows, debtRows, balanceRows } from "src/models/Organizations/financeView";
import OnecFinanceTab from "src/models/Organizations/OnecFinanceTab";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

afterEach(cleanup);

const debtsData = {
	rows: [
		{ counterparty: { name: "ТОО Альфа", bin: "111111111111" }, receivable: "12 500,00", payable: null, overdue: 2000 },
		{ name: "ИП Бета", receivable: 500, payable: "1 000", overdue: 0 },
	],
};
const base = (debts: unknown): OrganizationFinance => ({
	onDate: "2026-09-28", bin: "123456789012", baseKey: "buh", agentId: "a1", readAt: "2026-09-28T10:00:00Z",
	debts: { ok: true, data: debts },
	balances: { ok: true, data: [{ account: "1030", name: "Расчётный счёт", balance: 1234567.5 }, { code: "1010", title: "Касса" }] },
} as OrganizationFinance);

const renderTab = async () => {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const r = render(<QueryClientProvider client={qc}><OnecFinanceTab organizationUuid="org-1" /></QueryClientProvider>);
	fireEvent.click(screen.getByText("Прочитать из 1С"));
	await waitFor(() => expect(screen.getByText("ТОО Альфа")).toBeTruthy());
	return r;
};
// Разряды ru-RU — неразрывным пробелом: сравниваем с обычным.
const norm = (t: string | null) => (t ?? "").replace(/[\u00a0\u202f]/g, " ");
const footerTexts = (container: HTMLElement) =>
	[...container.querySelectorAll("tfoot")].map((f) => [...f.querySelectorAll("td")].map((td) => norm(td.textContent)));
const bodySpans = (container: HTMLElement, text: string) =>
	[...container.querySelectorAll("tbody td span")].filter((e) => norm(e.textContent) === text) as HTMLElement[];

describe("Долги и остатки из 1С в карточке организации", () => {
	it("строки: колонки по идентификаторам, суммы числами, пустое — «—», устойчивые id", () => {
		const rows = debtTableRows(debtRows(debtsData));
		expect(rows.map((r) => [r.counterparty, r.binIin, r.onecOrgDebtReceivable, r.onecOrgDebtPayable, r.onecOrgDebtOverdue])).toEqual([
			["ТОО Альфа", "111111111111", 12500, null, 2000],
			["ИП Бета", "—", 500, 1000, 0],
		]);
		expect(debtTableRows(debtRows(debtsData)).map((r) => r.id)).toEqual(rows.map((r) => r.id));
		expect(balanceTableRows(balanceRows([{ code: "1010" }])).map((r) => [r.account, r.name, r.onecOrgBalance])).toEqual([["1010", "—", null]]);
	});

	it("подвал: без итогов 1С — только подпись (суммы считает Table), с итогами 1С — они", () => {
		expect(debtFooterValues(debtsData, "Итого")).toEqual({ counterparty: "Итого" });
		const own = debtFooterValues({ ...debtsData, totals: { receivable: 99000, payable: "1 000", overdue: null } }, "Итого");
		expect(Object.fromEntries(Object.entries(own).map(([k, v]) => [k, norm(v)]))).toEqual({
			counterparty: "Итого", onecOrgDebtReceivable: "99 000", onecOrgDebtPayable: "1 000", onecOrgDebtOverdue: "—",
		});
	});

	it("вкладка рисует две таблицы Table: заголовки из словаря, суммы с разрядами, итог по строкам, красная просрочка", async () => {
		finance = base(debtsData);
		const { container } = await renderTab();
		for (const title of ["Контрагент", "БИН / ИНН", "Нам должны", "Мы должны", "Просрочено", "Счёт", "Наименование", "Остаток"]) {
			expect(screen.getAllByText(title).length).toBeGreaterThan(0);
		}
		expect(bodySpans(container, "12 500")).toHaveLength(1);
		expect(bodySpans(container, "1 234 567,5")).toHaveLength(1);
		expect(screen.getByText("Касса")).toBeTruthy();
		// Просрочка 2000 — красным, нулевая — обычным текстом.
		expect(bodySpans(container, "2 000")[0].className).toContain(admin.ReqOff);
		expect(bodySpans(container, "0")[0].className).toBe("");
		// Итог долгов — подпись и суммы по показанным строкам; у остатков итога нет.
		const [debtFooter, ...rest] = footerTexts(container);
		expect(rest).toEqual([]);
		expect(debtFooter.filter(Boolean)).toEqual(["Итого", "13 000", "1 000", "2 000"]);
	});

	it("итоги 1С (по всем контрагентам) важнее суммы показанных строк", async () => {
		finance = base({ ...debtsData, total: 120, totals: { receivable: 99000, payable: 5000, overdue: 7000 } });
		const { container } = await renderTab();
		expect(footerTexts(container)[0].filter(Boolean)).toEqual(["Итого", "99 000", "5 000", "7 000"]);
		expect(screen.getByText(/показано 2 из 120/i)).toBeTruthy();
	});
});
