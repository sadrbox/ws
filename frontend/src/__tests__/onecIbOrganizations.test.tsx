/**
 * Вкладка «Организации» карточки базы 1С (28.09): организации самой базы с полным набором реквизитов, отметкой
 * «Основная» (только показ, из 1С) и связью со справочником «Организации» ERP по БИН. Читает агент по «Обновить».
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import { translate } from "src/i18";
import type { IbOrganization } from "src/services/onec/api";

const fixtures = vi.hoisted(() => {
	const details = {
		legalName: "Товарищество с ограниченной ответственностью «Nord Beer»", kind: "legal", kbe: "17",
		vatSeries: "60001", vatNumber: "0012345", vatDate: "2020-01-15",
		okedCode: "11050", okedName: "Производство пива",
		legalAddress: "г. Алматы, ул. Абая, 1", actualAddress: "г. Алматы, ул. Абая, 1",
		phones: ["+7 701 000 00 00", "+7 727 000 00 00"], emails: ["office@nordbeer.kz"], website: "nordbeer.kz",
		director: { fullName: "Иванов Иван", position: "Директор" },
		chiefAccountant: { fullName: "Петрова Анна", position: null },
		bankAccounts: [
			{ iban: "KZ111", bik: null, bankName: "Kaspi", currency: "KZT", isPrimary: false },
			{ iban: "KZ222", bik: "HSBKKZKX", bankName: "Народный банк", currency: "KZT", isPrimary: true },
		],
	};
	const items = [
		{ id: "b", name: "ТОО Бета", bin: "990140000123", erp: null, seenAt: "2026-09-28T09:00:00Z" },
		{ id: "a", name: "ТОО Nord Beer", bin: "180240037695", main: true, details, erp: { uuid: "o-1", name: "Nord Beer (ERP)", bin: "180240037695" }, seenAt: "2026-09-28T09:00:00Z" },
		{ id: "c", name: "ИП Без БИН", bin: null, erp: null, seenAt: "2026-09-28T09:00:00Z" },
	];
	return { details, items };
});

const api = vi.hoisted(() => ({
	fetchBaseOrganizationsCached: vi.fn((): Promise<{ items: unknown[]; mainSource?: string | null; notes?: { block: string | null; message: string }[] }> => Promise.resolve({ items: fixtures.items })),
	fetchBaseOrganizations: vi.fn(() => Promise.resolve({ items: fixtures.items })),
	fetchAgents: vi.fn(() => Promise.resolve({ items: [] })),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));
const created = vi.hoisted(() => ({
	createOrganizationFromOnec: vi.fn(() => Promise.resolve({ success: true, item: { uuid: "o-2", name: "ТОО Бета", bin: "990140000123" }, created: { contacts: 0, contactPersons: 0, bankAccounts: 0 } })),
}));
vi.mock("src/services/onec/orgFromOnec", () => created);

import { IbOrganizationsTab } from "src/models/OneCBases/IbOrganizations";
import { erpText, ibOrganizationRows, mainSourceText, organizationNotes } from "src/models/OneCBases/ibOrganizationsView";

const confirm = vi.fn((_: string) => Promise.resolve(true));
const ctx = (isSuperAdmin: boolean): TypeAppContextProps => ({
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
		setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
	},
	actions: { confirm },
	navbar: { props: [], setProps: () => { } },
	auth: { user: { uuid: "me", username: "me", isSuperAdmin }, logout: () => { } },
});

function mount(isSuperAdmin = true) {
	return render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<AppContextProvider value={ctx(isSuperAdmin)}><IbOrganizationsTab baseKey="nordbeer" /></AppContextProvider>
		</QueryClientProvider>,
	);
}

describe("строки вкладки «Организации»", () => {
	const rows = ibOrganizationRows(fixtures.items as IbOrganization[]);

	it("основная — первой, дальше по наименованию", () => {
		expect(rows.map((r) => r.name)).toEqual(["ТОО Nord Beer", "ИП Без БИН", "ТОО Бета"]);
		expect(rows.map((r) => r.isPrimary)).toEqual([true, false, false]);
	});

	it("в строке — только то, по чему организацию узнают; остальные реквизиты — в карточке (28.09)", () => {
		const r = rows[0];
		expect(r.legalName).toBe(fixtures.details.legalName);
		expect(r.seenAtLabel).not.toBe("—");
		for (const gone of ["kind", "kbe", "onecReqOrgVat", "onecOrgOked", "phone", "email", "onecOrgWebsite",
			"onecReqOrgDirector", "onecReqOrgChiefAccountant", "BankAccountsList", "onecReqOrgLegalAddress"]) {
			expect(r, gone).not.toHaveProperty(gone);
		}
		// Реквизитов нет — прочерк, а не пустота.
		expect(rows[2].legalName).toBe("—");
	});

	it("связь с ERP: имя связанной, «нет в ERP» — только если ERP ответила; без БИН и без ответа — прочерк", () => {
		expect(rows[0].onecReqErpOrg).toBe("Nord Beer (ERP)");
		expect(rows[0].__erpUuid).toBe("o-1");
		expect(rows[2].onecReqErpOrg).toBe(translate("onecReqOrgMissing"));
		expect(rows[2].__erpMissing).toBe(true);
		expect(rows[1].onecReqErpOrg).toBe("—");
		expect(rows[1].__erpMissing).toBe(false);
		expect(erpText({ bin: "990140000123" })).toBe("—");
	});
});

describe("откуда отметка «Основная» (ответ агента 28.09)", () => {
	it("отметка есть — источник словами; источник не назван — молчим", () => {
		const items = [{ main: true }, { main: false }];
		expect(mainSourceText(items, "single")).toBe(translate("onecOrgMainSourceSingle"));
		expect(mainSourceText(items, "extension")).toBe(translate("onecOrgMainSourceExtension"));
		expect(mainSourceText(items, "users")).toBe(translate("onecOrgMainSourceUsers"));
		expect(mainSourceText(items, null)).toBeNull();
		expect(mainSourceText(items, undefined)).toBeNull();
	});

	it("отметки нет: при нескольких организациях — «не определена», при одной и без организаций — молчим", () => {
		expect(mainSourceText([{ main: false }, {}], null)).toBe(translate("onecOrgMainSourceNone"));
		expect(mainSourceText([{}], null)).toBeNull();
		expect(mainSourceText([], null)).toBeNull();
	});

	it("записки: блоки реквизитов — в предупреждение словами, «main» — отдельно, без блока — к реквизитам", () => {
		expect(organizationNotes(undefined)).toEqual({ details: null, main: null });
		expect(organizationNotes([
			{ block: "responsible", message: "срез не прочитан" },
			{ block: "main", message: "настройки пользователей не прочитаны" },
			{ block: null, message: "что-то ещё" },
		])).toEqual({
			details: `${translate("onecOrgNoteResponsible")}: срез не прочитан; что-то ещё`,
			main: "настройки пользователей не прочитаны",
		});
		expect(organizationNotes([{ block: "main", message: "константа не прочитана" }]).details).toBeNull();
	});
});

describe("вкладка «Организации» карточки базы", () => {
	beforeEach(() => {
		confirm.mockClear();
		api.fetchBaseOrganizations.mockClear();
		api.fetchBaseOrganizationsCached.mockClear();
		created.createOrganizationFromOnec.mockClear();
	});

	it("открывается кэшем: связанная организация ERP — текстом (копируется), отсутствующая — «нет в ERP»", async () => {
		mount();
		expect(await screen.findByText("Nord Beer (ERP)")).toBeTruthy();
		expect(screen.getByText(translate("onecReqOrgMissing"))).toBeTruthy();
		expect(api.fetchBaseOrganizationsCached).toHaveBeenCalledWith("nordbeer");
		expect(api.fetchBaseOrganizations).not.toHaveBeenCalled();
	});

	it("«Создать организацию» — для строки без организации в ERP, после подтверждения, с реквизитами из 1С", async () => {
		const { container } = mount();
		await screen.findByText(translate("onecReqOrgMissing"));
		const create = screen.getByRole<HTMLButtonElement>("button", { name: translate("onecReqOrgCreate") });
		expect(create.disabled).toBe(true);
		// Связанная строка — создавать нечего.
		fireEvent.click(within(container.querySelector("tbody")!).getByText("ТОО Nord Beer"));
		expect(create.disabled).toBe(true);
		fireEvent.click(within(container.querySelector("tbody")!).getByText("ТОО Бета"));
		await waitFor(() => expect(create.disabled).toBe(false));
		fireEvent.click(create);
		await waitFor(() => expect(created.createOrganizationFromOnec).toHaveBeenCalledWith({ bin: "990140000123", name: "ТОО Бета", details: null }));
		expect(confirm.mock.calls[0][0]).toContain("ТОО Бета");
		expect(confirm.mock.calls[0][0]).toContain("990140000123");
	});

	it("источник отметки — строкой под подсказкой; недочитанные реквизиты — предупреждением с причиной", async () => {
		api.fetchBaseOrganizationsCached.mockResolvedValueOnce({ items: fixtures.items, mainSource: "users", notes: [
			{ block: "contacts", message: "таймаут" }, { block: "bankAccounts", message: "нет прав" },
		] });
		mount();
		expect(await screen.findByText(translate("onecOrgMainSourceUsers"))).toBeTruthy();
		expect(screen.getByText(`${translate("onecOrgsPartialRead")}: ${translate("onecOrgNoteContacts")}: таймаут; ${translate("onecOrgNoteBankAccounts")}: нет прав`)).toBeTruthy();
	});

	it("не прочитался только источник «Основной» — пояснение, а не предупреждение о реквизитах", async () => {
		api.fetchBaseOrganizationsCached.mockResolvedValueOnce({ items: fixtures.items.map((o) => ({ ...o, main: false })), mainSource: null, notes: [
			{ block: "main", message: "настройки пользователей не прочитаны" },
		] });
		mount();
		expect(await screen.findByText(`${translate("onecOrgMainNotRead")}: настройки пользователей не прочитаны`)).toBeTruthy();
		expect(screen.queryByText(new RegExp(translate("onecOrgsPartialRead")))).toBeNull();
	});

	it("полное чтение — предупреждения нет", async () => {
		api.fetchBaseOrganizationsCached.mockResolvedValueOnce({ items: fixtures.items, mainSource: "extension", notes: [] });
		mount();
		expect(await screen.findByText(translate("onecOrgMainSourceExtension"))).toBeTruthy();
		expect(screen.queryByText(new RegExp(translate("onecOrgsPartialRead")))).toBeNull();
	});

	it("не администратор BuhProf — кнопки создания нет", async () => {
		mount(false);
		await screen.findByText(translate("onecReqOrgMissing"));
		expect(screen.queryByRole("button", { name: translate("onecReqOrgCreate") })).toBeNull();
	});

	it("«Обновить» читает организации у самой 1С и перечитывает кэш сервиса", async () => {
		mount();
		await screen.findByText(translate("onecReqOrgMissing"));
		const calls = api.fetchBaseOrganizationsCached.mock.calls.length;
		fireEvent.click(screen.getByTitle(translate("onecOrgsCheck")));
		await waitFor(() => expect(api.fetchBaseOrganizations).toHaveBeenCalledWith("nordbeer"));
		await waitFor(() => expect(api.fetchBaseOrganizationsCached.mock.calls.length).toBeGreaterThan(calls));
	});
});
