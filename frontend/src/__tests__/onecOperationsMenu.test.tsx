/**
 * Меню «Операции» базы 1С (28.09).
 *
 * Группа «Доступность базы» и кнопка входа ушли из карточки: их команды живут в меню «Операции». Скрыть и показать —
 * только базу, которая есть в кластере; базе без регистрации доступна одна команда — удалить её запись, и карточка
 * удалённой базы закрывается. У каждого пункта — подсказка: что сделает команда, а у недоступного — почему.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import { translate } from "src/i18";

const api = vi.hoisted(() => ({
	setBaseHidden: vi.fn((_key: string, hidden: boolean) => Promise.resolve({ ok: true, hidden })),
	removeBaseFromRegistry: vi.fn(() => Promise.resolve({ ok: true, removed: true })),
	setSessionsLock: vi.fn((_key: string, enabled: boolean) => Promise.resolve({ ok: true, state: { lock: { enabled, active: enabled } } })),
}));
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));
vi.mock("src/hooks/useAccessPermission", () => ({
	useAccessPermission: () => ({ canRead: true, canWrite: true, canDelete: true, canCreate: true }),
}));
vi.mock("src/models/OneCAdmin/progress", async (orig) => ({
	...(await orig<typeof import("src/models/OneCAdmin/progress")>()),
	withOp: (_op: unknown, fn: () => Promise<unknown>) => fn(),
}));

import { BaseGroupCommands } from "src/models/OneCAdmin/BaseGroupCommands";

const confirm = vi.fn((_: string) => Promise.resolve(true));

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

const base = (over: Record<string, unknown> = {}) =>
	({ baseKey: "buh1", status: "ONLINE", clusterStatus: "ONLINE", disabled: false, ...over }) as unknown as TDataItem;

function open(row: TDataItem, onRecordsRemoved = vi.fn(), card = true) {
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<AppContextProvider value={ctx}><BaseGroupCommands selected={[row]} card={card} onRecordsRemoved={onRecordsRemoved} /></AppContextProvider>
		</QueryClientProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: new RegExp(translate("onecOperations")) }));
	return onRecordsRemoved;
}
const item = (key: string) => screen.getByRole("menuitem", { name: translate(key) });
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true;
const notFor = (reasonKey: string) => `${translate("onecOpNotForBase")}: ${translate(reasonKey)}`;

describe("видимость базы и запись панели в «Операциях»", () => {
	beforeEach(() => {
		confirm.mockClear();
		api.setBaseHidden.mockClear();
		api.removeBaseFromRegistry.mockClear();
		api.setSessionsLock.mockClear();
	});

	it("у каждого пункта есть подсказка; кнопка меню в карточке называет базу", () => {
		open(base({ sessionsDenied: false, published: true, scheduledJobsDenied: false }));
		expect(screen.getByRole("button", { name: new RegExp(translate("onecOperations")) }).getAttribute("title"))
			.toBe(translate("onecOpsForBase").replace("{base}", "buh1"));
		const items = screen.getAllByRole("menuitem");
		expect(items.length).toBeGreaterThan(10);
		for (const el of items) expect(el.getAttribute("title"), el.textContent ?? "").toBeTruthy();
		expect(item("onecBaseInfoRefresh").getAttribute("title")).toBe(translate("onecOpHintInfo"));
		// Проверка из меню идёт без исправления — и называется так же.
		expect(item("onecMaintCheckTestOnly").getAttribute("title")).toBe(translate("onecOpHintCheck"));
		expect(screen.queryByRole("menuitem", { name: translate("onecMaintCheck") })).toBeNull();
		// Недоступное объясняет себя причиной этой базы, а не общим «отметьте базы».
		expect(isDisabled(item("onecPublish"))).toBe(true);
		expect(item("onecPublish").getAttribute("title")).toBe(notFor("onecAlreadyPublished"));
		expect(item("onecScheduledJobsAllow").getAttribute("title")).toBe(notFor("onecJobsAlreadyAllowed"));
	});

	it("«Блокировка сеансов»: открытый вход закрывают после подтверждения; открыть нечего", async () => {
		open(base({ sessionsDenied: false }));
		expect(screen.getByText(translate("onecSessionsLockState"))).toBeTruthy();
		expect(isDisabled(item("onecSessionsLockOpen"))).toBe(true);
		expect(item("onecSessionsLockOpen").getAttribute("title")).toBe(notFor("onecLockAlreadyOpen"));
		expect(item("onecSessionsLockClose").getAttribute("title")).toBe(translate("onecOpHintLockClose"));
		fireEvent.click(item("onecSessionsLockClose"));
		await waitFor(() => expect(api.setSessionsLock).toHaveBeenCalledWith("buh1", true));
		expect(confirm).toHaveBeenCalledWith(translate("onecSessionsLockConfirm"));
	});

	it("закрытый вход открывают; вход не читали — доступны оба пункта", async () => {
		open(base({ sessionsDenied: true, sessionsDeniedActive: true }));
		expect(isDisabled(item("onecSessionsLockClose"))).toBe(true);
		fireEvent.click(item("onecSessionsLockOpen"));
		await waitFor(() => expect(api.setSessionsLock).toHaveBeenCalledWith("buh1", false));
	});

	it("вход не читали — закрыть и открыть можно оба раза", () => {
		open(base());
		expect(isDisabled(item("onecSessionsLockClose"))).toBe(false);
		expect(isDisabled(item("onecSessionsLockOpen"))).toBe(false);
	});

	it("рабочую базу можно скрыть — после подтверждения; вернуть в работу нечего", async () => {
		open(base());
		expect(screen.getByText(translate("onecBaseVisibility"))).toBeTruthy();
		expect(isDisabled(item("onecBaseUnhide"))).toBe(true);
		expect(item("onecBaseUnhide").getAttribute("title")).toBe(notFor("onecBaseNotHidden"));
		fireEvent.click(item("onecBaseHide"));
		await waitFor(() => expect(api.setBaseHidden).toHaveBeenCalledWith("buh1", true));
		expect(confirm).toHaveBeenCalledTimes(1);
	});

	it("скрытую базу возвращают в работу без вопроса", async () => {
		open(base({ status: "DISABLED", disabled: true }));
		expect(isDisabled(item("onecBaseHide"))).toBe(true);
		expect(item("onecBaseHide").getAttribute("title")).toBe(notFor("onecBaseAlreadyHidden"));
		fireEvent.click(item("onecBaseUnhide"));
		await waitFor(() => expect(api.setBaseHidden).toHaveBeenCalledWith("buh1", false));
		expect(confirm).not.toHaveBeenCalled();
	});

	it("базы нет в кластере: скрывать нечего, запись удаляется — и карточке сообщают, какая", async () => {
		const removed = open(base({ status: "DISABLED", clusterStatus: "MISSING", disabled: true }));
		expect(isDisabled(item("onecBaseHide"))).toBe(true);
		expect(isDisabled(item("onecBaseUnhide"))).toBe(true);
		expect(item("onecBaseHide").getAttribute("title")).toBe(notFor("onecOpReasonMissing"));
		expect(item("onecBaseDropRegistration").getAttribute("title")).toBe(notFor("onecOpReasonNoRegistration"));
		fireEvent.click(item("onecBaseRemoveFromList"));
		await waitFor(() => expect(api.removeBaseFromRegistry).toHaveBeenCalledWith("buh1"));
		await waitFor(() => expect(removed).toHaveBeenCalledWith(["buh1"]));
	});

	it("в списке без отметок команды панели и входа недоступны и просят отметить базы", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<AppContextProvider value={ctx}><BaseGroupCommands selected={[]} /></AppContextProvider>
			</QueryClientProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: new RegExp(translate("onecOperations")) }));
		for (const k of ["onecSessionsLockClose", "onecBaseHide", "onecBaseRemoveFromList"]) {
			expect(isDisabled(item(k))).toBe(true);
			expect(item(k).getAttribute("title")).toBe(translate("onecOpPickApplicable"));
		}
		// Задания без отметок ведут в помощник — пункт доступен и объясняет, что сделает.
		expect(isDisabled(item("onecPublish"))).toBe(false);
		expect(item("onecPublish").getAttribute("title")).toBe(translate("onecOpHintPublish"));
	});
});
