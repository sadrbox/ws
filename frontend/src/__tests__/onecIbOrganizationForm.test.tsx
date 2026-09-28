/**
 * «Организация базы 1С» (28.09): строка вкладки «Организации» открывается карточкой со всеми реквизитами 1С. Шапка —
 * полями, табличные части (счета, договоры, контактные лица, контакты) — вложенными таблицами: реквизиты текстом и
 * LookupField-ссылка на объект ERP, уже заполненная найденным. Вкладка «Организации» — тоже вложенная таблица из пяти
 * колонок; «Основная» — не колонкой: строка полужирная, звёздочка на панели горит, когда курсор на основной.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import { translate } from "src/i18";

const fixtures = vi.hoisted(() => {
	const details = {
		legalName: "ТОО «Nord Beer»", kind: "legal", kbe: "17",
		vatSeries: "60001", vatNumber: "0012345", vatDate: "2020-01-15",
		okedCode: "11050", okedName: "Производство пива",
		legalAddress: "г. Алматы, ул. Абая, 1", actualAddress: "г. Алматы, ул. Абая, 1",
		phones: ["+7 701 000 00 00"], emails: ["office@nordbeer.kz"], website: "nordbeer.kz",
		director: { fullName: "Иванов Иван Иванович", position: "Директор" },
		chiefAccountant: { fullName: "Петрова Анна", position: null },
		bankAccounts: [
			{ iban: "KZ11 1111", bik: null, bankName: "Kaspi", currency: "usd", isPrimary: false },
			{ iban: "KZ222", bik: "HSBKKZKX", bankName: "Народный банк", currency: "KZT", isPrimary: true },
		],
		contracts: [
			{ id: "k1", name: "Договор поставки", number: "15/24", date: "2024-01-15", validUntil: null, kind: "С поставщиком",
				currency: "KZT", counterparty: { id: "cp", name: "ТОО Бета", bin: "990140000123" } },
			{ id: "k2", name: "Прочий", number: "99", date: null, validUntil: null, kind: null, currency: null,
				counterparty: { id: "cp2", name: "ТОО Гамма", bin: "111111111111" } },
		],
	};
	const items = [
		{ id: "b", name: "ТОО Бета", bin: "990140000123", erp: null, seenAt: "2026-09-28T09:00:00Z" },
		{ id: "a", name: "ТОО Nord Beer", bin: "180240037695", main: true, details, erp: { uuid: "o-1", name: "Nord Beer (ERP)", bin: "180240037695" }, seenAt: "2026-09-28T09:00:00Z" },
	];
	return { details, items };
});

const onec = vi.hoisted(() => ({
	fetchBaseOrganizationsCached: vi.fn(() => Promise.resolve({ items: fixtures.items })),
	fetchBaseOrganizations: vi.fn(() => Promise.resolve({ items: fixtures.items })),
	fetchAgents: vi.fn(() => Promise.resolve({ items: [] })),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...onec }));

// Справочники ERP, по которым форма ищет связанные объекты.
const erp = vi.hoisted(() => ({
	get: vi.fn((url: string) => Promise.resolve({
		items: url === "/currencies" ? [{ uuid: "c-kzt", code: "KZT", name: "Тенге" }, { uuid: "c-usd", code: "USD", name: "Доллар США" }]
			: url === "/bankaccounts" ? [{ uuid: "ba-2", iban: "kz 222" }]
				: url === "/contactpersons" ? [{ uuid: "p-1", fullName: "иванов  Иван иванович" }]
					: url === "/contacts" ? [{ uuid: "cn-1", contactType: "telephone", value: "+7 (701) 000-00-00" }]
						: url === "/contracts" ? [{ uuid: "ct-1", name: "Поставка (ERP)", contractNumber: "15 / 24", counterparty: { bin: "990140000123" } }]
							: url === "/counterparties" ? [{ uuid: "cp-1", name: "ТОО Бета", bin: "990140000123" }]
								: [],
	})),
}));
vi.mock("src/services/api/client", async (orig) => {
	const m = await orig<typeof import("src/services/api/client")>();
	return { ...m, api: { ...m.api, get: erp.get } };
});
vi.mock("src/hooks/useAccessPermission", () => ({
	useAccessPermission: () => ({ canRead: true, canWrite: true, canDelete: true, canCreate: true }),
}));

import { IbOrganizationsTab } from "src/models/OneCBases/IbOrganizations";
import IbOrganizationForm from "src/models/OneCBases/IbOrganizationForm";
import IbOrgPartCard from "src/models/OneCBases/IbOrgPartCard";
import { organizationNotes } from "src/models/OneCBases/ibOrganizationsView";
import { getByEndpoint } from "src/registry/modelRegistry";
import {
	accountRows, bankAccountCreateDefaults, contactCreateDefaults, contactPersonCreateDefaults, contactRows, contractCreateDefaults,
	contractRows, currencyCreateDefaults, matchBankAccount, matchContact, matchContactPerson, matchContract, matchCurrency,
	organizationCreateDefaults,
} from "src/models/OneCBases/ibOrganizationFormView";
import type { OnecOrgContract } from "src/services/onec/api";

const addPane = vi.fn();
const ctx: TypeAppContextProps = {
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null, addPane, requestClose: async () => { }, reloadPane: async () => { },
		setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
	},
	actions: { confirm: () => Promise.resolve(true) },
	navbar: { props: [], setProps: () => { } },
	auth: { user: { uuid: "me", username: "me", isSuperAdmin: true }, logout: () => { } },
};
const wrap = (node: React.ReactNode) => render(
	<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
		<AppContextProvider value={ctx}>{node}</AppContextProvider>
	</QueryClientProvider>,
);

describe("сопоставление с объектами ERP", () => {
	it("валюта — по коду без регистра; подпись — код, как у поля валют", () => {
		const list = [{ uuid: "c-kzt", code: "KZT", name: "Тенге" }];
		expect(matchCurrency(list, " kzt ")).toEqual({ uuid: "c-kzt", name: "KZT" });
		expect(matchCurrency(list, "EUR").uuid).toBe("");
		expect(matchCurrency(list, null).uuid).toBe("");
	});

	it("счёт — по IBAN без пробелов и регистра; подпись — IBAN из ERP", () => {
		expect(matchBankAccount([{ uuid: "ba", iban: "KZ12 3456" }], "kz123456")).toEqual({ uuid: "ba", name: "KZ12 3456" });
		expect(matchBankAccount([{ uuid: "ba", iban: "KZ12" }], "").uuid).toBe("");
	});

	it("контактное лицо — по ФИО без регистра, «ё», лишних пробелов и точек", () => {
		const list = [{ uuid: "p", fullName: "Сёмин  С. С." }];
		expect(matchContactPerson(list, "семин с с").uuid).toBe("p");
		expect(matchContactPerson(list, "Семина С. С.").uuid).toBe("");
	});

	it("контакт — того же вида; телефон — по цифрам, прочее — без регистра", () => {
		const list = [
			{ uuid: "t", contactType: "telephone", value: "+7 (701) 000-00-00" },
			{ uuid: "e", contactType: "email", value: "Office@NordBeer.kz" },
		];
		expect(matchContact(list, "telephone", "+77010000000").uuid).toBe("t");
		expect(matchContact(list, "email", "office@nordbeer.kz").uuid).toBe("e");
		expect(matchContact(list, "website", "office@nordbeer.kz").uuid).toBe("");
	});

	it("договор — у того же контрагента по БИН: по номеру, без номера — по наименованию", () => {
		const c = fixtures.details.contracts[0] as OnecOrgContract;
		const list = [
			{ uuid: "x", name: "Договор поставки", contractNumber: "15/24", counterparty: { bin: "000000000000" } },
			{ uuid: "y", name: "Иное имя", contractNumber: "№ 15 / 24", counterparty: { bin: "990140000123" } },
		];
		expect(matchContract(list, c)).toEqual({ uuid: "y", name: "Иное имя" });
		expect(matchContract([{ uuid: "z", name: "договор  ПОСТАВКИ", counterparty: { bin: "990140000123" } }], { ...c, number: null }).uuid).toBe("z");
		// Без БИН контрагента по имени не связываем.
		expect(matchContract(list, { ...c, counterparty: { id: null, name: "ТОО Бета", bin: null } }).uuid).toBe("");
	});
});

describe("строки табличных частей: главное — колонками, все реквизиты — в карточке строки", () => {
	it("счёт: наименование из 1С, пока агент его не шлёт — банк; основной — первым", () => {
		const rows = accountRows(fixtures.details as never);
		expect(rows.map((r) => [r.name, r.iban, r.isPrimary])).toEqual([["Народный банк", "KZ222", true], ["Kaspi", "KZ11 1111", false]]);
		expect(accountRows({ ...fixtures.details, bankAccounts: [{ ...fixtures.details.bankAccounts[1], name: "Основной тенговый" }] } as never)[0].name)
			.toBe("Основной тенговый");
		const card = Object.fromEntries(rows[0].card.map((f) => [f.label, f.value]));
		expect(card).toMatchObject({ [translate("iban")]: "KZ222", [translate("bik")]: "HSBKKZKX", [translate("isPrimary")]: translate("yes") });
		// Наименования в 1С пока нет — в карточке «—», а не название банка под чужой подписью.
		expect(card[translate("name")]).toBe("—");
	});

	it("договор: наименование, номер, дата и контрагент — колонками; вид, срок и БИН — в карточке", () => {
		const r = contractRows(fixtures.details as never)[0];
		expect([r.name, r.contractNumber, r.date, r.counterparty]).toEqual(["Договор поставки", "15/24", "15.01.2024", "ТОО Бета"]);
		const card = Object.fromEntries(r.card.map((f) => [f.label, f.value]));
		expect(card).toMatchObject({ [translate("onecOrgContractKind")]: "С поставщиком", [translate("binIin")]: "990140000123" });
	});

	it("контакты: по строке на значение, фактический адрес-повтор не дублируется, первое значение вида — основное", () => {
		const rows = contactRows(fixtures.details as never);
		expect(rows.map((r) => r.kind)).toEqual(["legal_address", "telephone", "email", "website"]);
		expect(rows.every((r) => r.isPrimary)).toBe(true);
		expect([rows[1].contactType, rows[1].value]).toEqual([translate("ct_telephone"), "+7 701 000 00 00"]);
	});
});

describe("записка агента о сбое блока «договоры» (сборка 2026-09-28 18:27)", () => {
	it("агент уже назвал блок в тексте — название не повторяется; без названия — добавляется", () => {
		const label = translate("onecOrgNoteContracts");
		expect(organizationNotes([{ block: "contracts", message: `${label}: таймаут` }]).details).toBe(`${label}: таймаут`);
		expect(organizationNotes([{ block: "contracts", message: "таймаут" }]).details).toBe(`${label}: таймаут`);
	});
});

describe("«Создать» в поле — объект ERP, заполненный из 1С", () => {
	const org = { uuid: "o-1", name: "Nord Beer (ERP)" };

	it("организация — БИН цифрами, наименования и НДС, как у «Создать организацию»", () => {
		expect(organizationCreateDefaults({ name: "ТОО Nord Beer", bin: "1802 4003 7695", details: fixtures.details as never })).toEqual({
			bin: "180240037695", name: "ТОО Nord Beer", legalName: "ТОО «Nord Beer»", vatSeries: "60001", vatNumber: "0012345",
		});
	});

	it("счёт — IBAN, банк, КБе и найденная валюта; владелец — организация ERP", () => {
		const a = fixtures.details.bankAccounts[1];
		expect(bankAccountCreateDefaults(a, "17", { uuid: "c-kzt", name: "KZT", title: "KZT — Тенге" }, org)).toEqual({
			iban: "KZ222", bik: "HSBKKZKX", bankName: "Народный банк", kbe: "17", currencyUuid: "c-kzt", currencyName: "KZT — Тенге",
			ownerType: "organization", ownerUuid: "o-1", ownerName: "Nord Beer (ERP)",
		});
		// Не КБе — не переносим; валюты в ERP нет — поле пустое; организации ERP нет — без владельца.
		expect(bankAccountCreateDefaults(fixtures.details.bankAccounts[0], "x", { uuid: "", name: "" }, { uuid: "", name: "" }))
			.toEqual({ iban: "KZ111111", bankName: "Kaspi" });
	});

	it("контактное лицо — ФИО и должность «(из 1С)», без должности — роль", () => {
		expect(contactPersonCreateDefaults({ fullName: " Петрова Анна ", position: null }, "Главный бухгалтер", org)).toEqual({
			fullName: "Петрова Анна", comment: "Главный бухгалтер (из 1С)", ownerType: "organization", ownerUuid: "o-1", ownerName: "Nord Beer (ERP)",
		});
	});

	it("контакт — вид и значение, владелец — организация ERP", () => {
		expect(contactCreateDefaults("email", "a@b.kz", org)).toEqual({
			contactType: "email", value: "a@b.kz", ownerType: "organization", ownerUuid: "o-1", ownerName: "Nord Beer (ERP)",
		});
	});

	it("договор — наименование, номер, даты формы, организация и найденный контрагент", () => {
		const c = fixtures.details.contracts[0] as OnecOrgContract;
		expect(contractCreateDefaults({ ...c, validUntil: "2025-12-31" }, org, { uuid: "cp-1", name: "ТОО Бета" })).toEqual({
			name: "Договор поставки", contractNumber: "15/24", startDate: "2024-01-15", endDate: "2025-12-31",
			organizationUuid: "o-1", organizationName: "Nord Beer (ERP)", counterpartyUuid: "cp-1", counterpartyName: "ТОО Бета",
		});
		// Контрагента в ERP нет — поле пустое, а не выдуманное.
		expect(contractCreateDefaults(c, org, { uuid: "", name: "" })).not.toHaveProperty("counterpartyUuid");
	});

	it("валюта — код заглавными", () => {
		expect(currencyCreateDefaults("usd")).toEqual({ code: "USD" });
		expect(currencyCreateDefaults(null)).toEqual({});
	});
});

describe("вкладка «Организации»: основная и открытие карточки", () => {
	beforeEach(() => { addPane.mockClear(); });

	it("колонки «Основная» нет; основная строка — полужирная; звёздочка горит на ней и переводит к ней курсор", async () => {
		const { container } = wrap(<IbOrganizationsTab baseKey="nordbeer" />);
		const body = await waitFor(() => {
			const b = container.querySelector("tbody");
			expect(b && within(b as HTMLElement).queryByText("ТОО Nord Beer")).toBeTruthy();
			return b as HTMLElement;
		});
		// Вложенная таблица: только то, по чему организацию узнают, — остальное в карточке.
		expect(body.closest("[data-subtable]")).toBeTruthy();
		const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent?.trim()).filter(Boolean);
		expect(headers).toEqual(["name", "binIin", "onecReqErpOrg", "legalName", "seenAtLabel"].map((k) => translate(k)));
		const rowOf = (name: string) => within(body).getByText(name).closest("tr")!;
		expect(rowOf("ТОО Nord Beer").getAttribute("data-primary")).toBe("true");
		expect(rowOf("ТОО Бета").getAttribute("data-primary")).toBeNull();

		// Организация ERP — текстом: значение ячейки выделяется и копируется (ссылка-кнопка этого не давала).
		expect(within(rowOf("ТОО Nord Beer")).getByText("Nord Beer (ERP)").closest("button")).toBeNull();

		const star = screen.getByRole("button", { name: translate("makePrimary") });
		expect(star.getAttribute("title")).toBe(translate("onecOrgMainPick"));
		fireEvent.click(within(body).getByText("ТОО Бета"));
		await waitFor(() => expect(star.getAttribute("title")).toBe(translate("onecOrgNotMainHint")));
		expect(star.getAttribute("aria-pressed")).toBe("false");
		// Щелчок по звёздочке — курсор к основной, и звёздочка загорается.
		fireEvent.click(star);
		await waitFor(() => expect(star.getAttribute("aria-pressed")).toBe("true"));
		expect(star.getAttribute("title")).toBe(translate("onecOrgIsMainHint"));
	});

	it("двойной щелчок — карточка «Организация базы 1С» с ключами базы и строки", async () => {
		const { container } = wrap(<IbOrganizationsTab baseKey="nordbeer" />);
		const cell = await waitFor(() => within(container.querySelector("tbody") as HTMLElement).getByText("ТОО Nord Beer"));
		fireEvent.doubleClick(cell);
		await waitFor(() => expect(addPane).toHaveBeenCalled());
		const pane = addPane.mock.calls[0][0] as { label: string; component: unknown; data: unknown };
		expect(pane.component).toBe(IbOrganizationForm);
		expect(pane.data).toEqual({ baseKey: "nordbeer", orgKey: "a" });
		expect(pane.label).toBe(`${translate("onecBaseOrgForm")}: ТОО Nord Beer`);
	});
});

describe("карточка «Организация базы 1С»", () => {
	const input = (c: HTMLElement, suffix: string) => c.querySelector<HTMLInputElement>(`input[name$="${suffix}"]`)!;

	it("шапка — полями 1С; организация ERP — полем-ссылкой, уже заполненным", async () => {
		const { container } = wrap(<IbOrganizationForm uniqId="p1" data={{ baseKey: "nordbeer", orgKey: "a" } as never} />);
		await waitFor(() => expect(input(container, "_legal").value).toBe("ТОО «Nord Beer»"));
		expect(input(container, "_okedn").value).toBe("Производство пива");
		expect(input(container, "_legal").disabled).toBe(true);
		expect(input(container, "_erp").value).toBe("Nord Beer (ERP)");
		// Контакты и ответственные лица — вкладками, не полями шапки.
		expect(container.querySelector('input[name$="_laddr"]')).toBeNull();
	});

	it("табличные части — SubTable: колонки 1С одной строкой, ссылка ERP найдена заранее, поле — в режиме «в таблице»", async () => {
		const { container } = wrap(<IbOrganizationForm uniqId="p3" data={{ baseKey: "nordbeer", orgKey: "a" } as never} />);
		await waitFor(() => expect(input(container, "_erp").value).toBe("Nord Beer (ERP)"));
		expect(container.querySelectorAll("[data-subtable]").length).toBe(4);
		expect(container.querySelector("textarea")).toBeNull();
		const [, accounts, contracts, persons, contacts] = screen.getAllByRole("tabpanel");
		const headers = (panel: HTMLElement) => Array.from(panel.querySelectorAll("thead th")).map((th) => th.textContent?.trim()).filter(Boolean);
		expect(headers(accounts)).toEqual(["name", "iban", "onecOrgAccountErp"].map((k) => translate(k)));
		// Режим «через форму»: ссылка ERP — текстом (счёт — по IBAN, договор — по номеру и БИН, лицо — по ФИО, контакт — по значению).
		const body = (panel: HTMLElement) => panel.querySelector("tbody")?.textContent ?? "";
		await waitFor(() => expect(body(accounts)).toContain("kz 222"));
		await waitFor(() => expect(body(contracts)).toContain("Поставка (ERP)"));
		await waitFor(() => expect(body(persons)).toContain("иванов  Иван иванович"));
		await waitFor(() => expect(body(contacts)).toContain("+7 (701) 000-00-00"));
		expect(accounts.querySelector("input")).toBeNull();
		// «Редактирование в таблице» — в ячейке LookupField с тем же значением.
		fireEvent.click(within(accounts).getByRole("button", { name: translate("inlineEdit") }));
		await waitFor(() => expect(input(accounts, "_acc:KZ222").value).toBe("kz 222"));
		expect(input(accounts, "_acc:KZ111111").value).toBe("");
		// Правка в ячейке доходит до строки: очистили поле — в режиме «через форму» ссылки у строки нет.
		fireEvent.change(input(accounts, "_acc:KZ222"), { target: { value: "" } });
		fireEvent.click(within(accounts).getByRole("button", { name: translate("inlineEdit") }));
		await waitFor(() => expect(accounts.querySelector("input")).toBeNull());
		expect(body(accounts)).not.toContain("kz 222");
		expect(erp.get).toHaveBeenCalledWith("/contracts", { params: { organizationUuid: "o-1", limit: 500 } });
		expect(erp.get).toHaveBeenCalledWith("/counterparties", { params: { filter: { organizationUuid: { equals: "o-1" } }, limit: 500 } });
		// Каждый запрошенный список — модель ERP из реестра: имя эндпоинта с опечаткой («bank-accounts») давало 404.
		const urls = new Set(erp.get.mock.calls.map(([url]) => url.slice(1)));
		expect([...urls].sort()).toEqual(["bankaccounts", "contactpersons", "contacts", "contracts", "counterparties", "currencies"]);
		for (const u of urls) expect(getByEndpoint(u), u).toBeTruthy();
	});

	it("двойной щелчок по строке — карточка строки: все реквизиты 1С и поле-ссылка со значением из таблицы", async () => {
		addPane.mockClear();
		wrap(<IbOrganizationForm uniqId="p4" data={{ baseKey: "nordbeer", orgKey: "a" } as never} />);
		const accounts = await waitFor(() => screen.getAllByRole("tabpanel")[1]);
		const cell = await waitFor(() => within(accounts).getByText("kz 222"));
		fireEvent.doubleClick(cell);
		await waitFor(() => expect(addPane).toHaveBeenCalled());
		const pane = addPane.mock.calls[0][0] as { label: string; component: unknown; data: Record<string, unknown> };
		expect(pane.component).toBe(IbOrgPartCard);
		expect(pane.label).toBe(`${translate("onecOrgAccountCard")}: Народный банк`);
		expect(pane.data).toMatchObject({
			erp: { endpoint: "bankaccounts", value: { uuid: "ba-2", name: "kz 222" }, extraParams: { ownerType: "organization", ownerUuid: "o-1" } },
		});
		// Поле-ссылка — на модель ERP из реестра: иначе «Открыть» и «Создать» в нём не работают.
		expect(getByEndpoint((pane.data.erp as { endpoint: string }).endpoint)).toBeTruthy();
		// Карточка — сериализуемые данные: пейн восстанавливается из ссылки.
		expect(() => JSON.stringify(pane.data)).not.toThrow();
		const { container } = wrap(<IbOrgPartCard uniqId="c1" data={pane.data as never} />);
		expect(Array.from(container.querySelectorAll("input")).map((i) => i.value)).toEqual(
			expect.arrayContaining(["KZ222", "HSBKKZKX", "Народный банк", "kz 222"]));
	});

	it("строки нет в кэше — карточка говорит об этом, а не показывает пустые поля молча", async () => {
		wrap(<IbOrganizationForm uniqId="p2" data={{ baseKey: "nordbeer", orgKey: "нет-такой" } as never} />);
		expect(await screen.findByText(translate("onecOrgFormNotFound"))).toBeTruthy();
	});
});
