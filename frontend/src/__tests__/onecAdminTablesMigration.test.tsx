/**
 * Таблицы «Управления 1С» на общих компонентах (28.09): команды, журнал, базы бизнес-агента, время и отказы — Table;
 * базы сводки HEALTH, процессы сервера и виджет «Кто держит очередь» — SubTableSheets. Самодельные <table> обходили
 * общий вид ячейки: текст — единственным дочерним span у TableBodyCell.
 *
 * Проверяем разметку (заголовки из словаря, span в ячейке) и поведение, которое нельзя потерять при переводе:
 * отметка только у ждущих команд и «Снять» с отмеченными, «Прервать» у чтений, включение/выключение БИНа,
 * «сверх лимита» на ячейках вместо подсветки строки, «сирота» — тоном ячейки «Что делает».
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import { translate } from "src/i18";
import tableStyles from "src/components/Table/Table.module.scss";
import styles from "src/models/OneCAdmin/OneCAdmin.module.scss";

const api = vi.hoisted(() => ({
	fetchAgentCommands: vi.fn(() => Promise.resolve({ items: [
		{ id: "c1", type: "IB_LIST_USERS", baseKey: "buh1", state: "queued", requestId: null, error: null, createdAt: "2026-09-28T10:00:00Z", dispatchedAt: null, finishedAt: null },
		{ id: "c2", type: "IB_INFO", baseKey: "buh2", state: "queued", requestId: null, error: null, createdAt: "2026-09-28T10:01:00Z", dispatchedAt: null, finishedAt: null },
		{ id: "c3", type: "IB_UPDATE", baseKey: "buh1", state: "dispatched", requestId: null, error: null, createdAt: "2026-09-28T09:00:00Z", dispatchedAt: "2026-09-28T09:01:00Z", finishedAt: null },
		{ id: "c4", type: "IB_READ", baseKey: null, state: "failed", requestId: null, error: { code: "IB_BUSY", message: "База занята" }, createdAt: "2026-09-28T08:00:00Z", dispatchedAt: "2026-09-28T08:00:05Z", finishedAt: "2026-09-28T08:00:30Z" },
	] })),
	cancelCommands: vi.fn((ids: string[]) => Promise.resolve({ canceled: ids.length, asked: ids.length })),
	fetchAgentAudit: vi.fn(() => Promise.resolve({ items: [
		{ at: "2026-09-28T10:00:00Z", event: "agent.rename", userUuid: "u1", userName: "Админ", details: { name: "Сервер-2" } },
		{ at: "2026-09-28T09:00:00Z", event: "agent.register", userUuid: null, userName: null, details: {} },
	] })),
	fetchAgentBases: vi.fn(() => Promise.resolve({
		limits: { maxBases: 1 },
		usage: { bases: 2, bins: 2 },
		role: "business" as const,
		canEditLimits: true,
		bases: [
			{
				key: "buh_main", pos: 0, status: "ONLINE", transport: "http" as const, extVersion: "1.8.3", overLimit: false, overLimitService: false, seenAt: null,
				organizations: [
					{ id: "o1", name: "ТОО Альфа", bin: "111111111111", overLimit: false, alsoIn: ["buh_extra"] },
					{ id: "o2", name: "ТОО Бета", bin: "222222222222", overLimit: false, alsoIn: [] },
				],
			},
			{
				key: "buh_extra", pos: 1, status: "ONLINE", transport: "com" as const, extVersion: null, overLimit: true, overLimitService: true,
				limitMismatch: true, seenAt: null, organizations: null,
			},
		],
	})),
	abortCommand: vi.fn(() => Promise.resolve({ aborted: true })),
	fetchAgents: vi.fn(() => Promise.resolve({ items: [], limits: {} })),
}));
// Частичный мок: модули панели 1С по цепочке импортов берут из api и другие функции.
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));

import { AgentAuditTab, AgentCommandsTab, BusinessHealthTab } from "src/models/OneCAdmin/AgentActivityTabs";
import { AgentBasesTab } from "src/models/OneCAdmin/AgentBasesTab";
import { AgentStatsTab } from "src/models/OneCAdmin/AgentStatsTab";
import { AgentHealthTab } from "src/models/OneCAdmin/AgentHealthTab";
import { QueueHolders } from "src/models/OneCAdmin/QueueHolders";
import { agentBaseRows, commandRows, durationTableRows, processRows } from "src/models/OneCAdmin/agentTablesView";

afterEach(cleanup);

const ctx = (superAdmin: boolean): TypeAppContextProps => ({
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
		setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
	},
	actions: { confirm: () => Promise.resolve(true) },
	navbar: { props: [], setProps: () => { } },
	auth: { user: superAdmin ? { uuid: "me", username: "me", isSuperAdmin: true } : null, logout: () => { } },
});

function renderWith(node: ReactNode, opts: { superAdmin?: boolean; seed?: (qc: QueryClient) => void } = {}) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	opts.seed?.(qc);
	return render(
		<QueryClientProvider client={qc}>
			<AppContextProvider value={ctx(opts.superAdmin ?? true)}>{node}</AppContextProvider>
		</QueryClientProvider>,
	);
}

/** Ячейка (div.TableBodyCell) по тексту её td. */
function cellOf(container: HTMLElement, match: (text: string) => boolean): HTMLElement {
	const td = [...container.querySelectorAll("tbody td")].find((el) => match(el.textContent ?? ""));
	if (!td) throw new Error("ячейка не найдена");
	return td.firstElementChild as HTMLElement;
}

/** Общий вид ячейки: единственный дочерний узел TableBodyCell — span (на `.TableBodyCell > span` держится вид). */
function spanOf(container: HTMLElement, text: string | ((t: string) => boolean)): HTMLElement {
	const cell = cellOf(container, typeof text === "string" ? (t) => t === text : text);
	expect(cell.className).toContain(tableStyles.TableBodyCell);
	const kids = [...cell.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
	expect(kids).toHaveLength(1);
	expect((kids[0] as HTMLElement).tagName).toBe("SPAN");
	return kids[0] as HTMLElement;
}

/** Самодельных <table> нет: каждая таблица экрана — внутри области прокрутки Table/SubTableSheets. */
const expectOnlySharedTables = (container: HTMLElement) => {
	const tables = [...container.querySelectorAll("table")];
	expect(tables.length).toBeGreaterThan(0);
	for (const t of tables) expect(t.closest(`.${tableStyles.TableScrollWrapper}`)).not.toBeNull();
};

const expectHeaders = (keys: string[]) => {
	for (const k of keys) expect(screen.getAllByText(translate(k)).length).toBeGreaterThan(0);
};

it("классы модулей в тестах — настоящие имена: иначе проверки тона и «не содержит» проходили бы впустую", () => {
	for (const c of [tableStyles.TableBodyCell, tableStyles.TableWrapperFit, styles.OverLimit, styles.Mono, styles.ReqWait, styles.ReqOff, styles.ReqBad, styles.BaseOrg, tableStyles.TableScrollWrapper]) {
		expect(typeof c === "string" && c.length > 0).toBe(true);
	}
});

describe("строки таблиц (agentTablesView)", () => {
	it("команды: текст колонок, тон и отказ — служебными полями, устойчивые id", async () => {
		const { items } = await api.fetchAgentCommands();
		const rows = commandRows(items);
		expect(rows.map((r) => [r.uuid, r.onecBase, r.__tone])).toEqual([
			["c1", "buh1", "wait"], ["c2", "buh2", "wait"], ["c3", "buh1", "wait"], ["c4", "—", "bad"],
		]);
		expect(rows[3].__error).toBe("IB_BUSY: База занята");
		expect(new Set(rows.map((r) => r.id)).size).toBe(4);
		expect(commandRows(items).map((r) => r.id)).toEqual(rows.map((r) => r.id));
	});

	it("базы агента: номер — порядок в настройках, организации одной строкой, состояние словом", async () => {
		const v = await api.fetchAgentBases();
		const rows = agentBaseRows(v.bases);
		expect(rows.map((r) => [r.lineNumber, r.onecBase, r.organizations, r.__state])).toEqual([
			[1, "buh_main", "ТОО Альфа 111111111111, ТОО Бета 222222222222", "online"],
			[2, "buh_extra", translate("onecOrgsUnknown"), "overLimit"],
		]);
	});

	it("время по типам: числа — для сортировки, подписи агента — для показа; порядок — по убыванию среднего", () => {
		const rows = durationTableRows({
			FAST: { count: 3, avgMs: 1500, maxMs: 2000, p95LeSecs: 5 },
			SLOW: { count: 12, avgMs: 28200, maxMs: 61000, p95LeSecs: null },
		});
		expect(rows.map((r) => [r.onecStatType, r.onecStatAvg, r.onecStatP95])).toEqual([["SLOW", 28200, null], ["FAST", 1500, 5]]);
		expect(rows[0].__text).toMatchObject({ onecStatAvg: "28,2 с", onecStatP95: "> 300 с" });
	});

	it("процессы: сирота помечен, PID — число, возраст — секундами", () => {
		const rows = processRows([{ pid: 12345, tool: "ibcmd", ageSecs: 0 }, { pid: 7, what: "сеансы", orphan: true }]);
		expect(rows.map((r) => [r.pid, r.onecHealthWhat, r.onecQueueAge, r.__orphan])).toEqual([
			[12345, "—", 0, false], [7, `сеансы (${translate("onecHealthOrphan")})`, null, true],
		]);
	});
});

describe("Команды агента — Table", () => {
	beforeEach(() => { api.cancelCommands.mockClear(); });

	it("заголовки из словаря, текст ячейки — в span, отказ — в том же корневом span", async () => {
		const { container } = renderWith(<AgentCommandsTab agentId="ag1" canManage />);
		await screen.findByText("IB_LIST_USERS");
		expectHeaders(["onecCmdCreated", "onecCmdType", "onecBase", "status", "onecCmdFinished"]);
		expectOnlySharedTables(container);
		expect(spanOf(container, "IB_LIST_USERS").className).toContain(styles.Mono);
		const failed = spanOf(container, (t) => t.includes("IB_BUSY: База занята"));
		expect(failed.querySelector(`.${styles.ReqBad}`)?.textContent).toBe(translate("onecCmdFailed"));
		// Незавершённая, но взятая агентом — «начата …» вместо времени завершения.
		expect(spanOf(container, (t) => t.startsWith(translate("onecCmdStartedAt"))).textContent).toMatch(/\d{2}:\d{2}$/);
	});

	it("отметка — только у ждущих команд; «Снять» уходит с отмеченными id", async () => {
		renderWith(<AgentCommandsTab agentId="ag1" canManage />);
		await screen.findByText("IB_LIST_USERS");
		const boxes = screen.getAllByRole<HTMLInputElement>("checkbox");
		expect(boxes.map((b) => b.getAttribute("aria-label")).sort()).toEqual(["c1", "c2"]);
		const cancelButton = () => screen.getAllByRole<HTMLButtonElement>("button")
			.find((b) => b.textContent?.startsWith(translate("onecAgentCommandsCancel")))!;
		expect(cancelButton().disabled).toBe(true);
		fireEvent.click(screen.getByRole("checkbox", { name: "c2" }));
		await waitFor(() => expect(cancelButton().textContent).toBe(`${translate("onecAgentCommandsCancel")} (1)`));
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "c2" }).checked).toBe(true);
		fireEvent.click(cancelButton());
		await waitFor(() => expect(api.cancelCommands).toHaveBeenCalledWith(["c2"]));
	});

	it("без права изменения — ни отметок, ни «Снять»", async () => {
		renderWith(<AgentCommandsTab agentId="ag1" canManage={false} />);
		await screen.findByText("IB_LIST_USERS");
		expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
		expect(screen.queryAllByRole("button").some((b) => b.textContent?.startsWith(translate("onecAgentCommandsCancel")))).toBe(false);
	});
});

describe("Журнал агента — Table", () => {
	it("события словами, автор или «служба», подробности строкой", async () => {
		const { container } = renderWith(<AgentAuditTab agentId="ag1" />);
		await screen.findByText("Админ");
		expectOnlySharedTables(container);
		expectHeaders(["onecAuditAt", "onecAuditEvent", "onecAuditWho", "onecAuditDetails"]);
		spanOf(container, translate("onecAuditRename"));
		spanOf(container, translate("onecAuditSystem"));
		expect(spanOf(container, "name: Сервер-2").className).toContain(styles.ReqOff);
	});
});

describe("Сводка бизнес-агента — базы на SubTableSheets", () => {
	it("«свойство: значение» осталось, список баз — простыня; сверх лимита — тоном ячейки", () => {
		const { container } = renderWith(<BusinessHealthTab agentId="ag1" agentName="Агент" />, {
			seed: (qc) => qc.setQueryData(["onec", "agent-health", "ag1"], {
				version: "2.0.1",
				bases: [
					{ baseKey: "buh1", status: "ONLINE", reachable: true, transport: "http", extVersion: "1.8.3", lastOkAt: "2026-09-28T10:00:00Z" },
					{ baseKey: "buh2", status: "OVER_LIMIT", overLimit: true, lastError: { at: "2026-09-28T09:00:00Z", message: "timeout" } },
				],
			}),
		});
		expect(screen.getByText("version")).toBeTruthy();
		expectHeaders(["onecBase", "status", "onecTransport", "onecExtVersion", "onecHealthLastOk", "onecHealthLastError"]);
		expect(spanOf(container, "buh1").className).toContain(styles.Mono);
		spanOf(container, "HTTP");
		expect(spanOf(container, "OVER_LIMIT").className).toContain(styles.OverLimit);
		expect(spanOf(container, (t) => t.endsWith(" timeout")).className).toContain(styles.ReqOff);
	});
});

describe("Базы бизнес-агента — Table", () => {
	it("сверх лимита — на ключе базы и состоянии; организации — строками с пометками", async () => {
		const { container } = renderWith(<AgentBasesTab agentId="ag1" agentName="Агент" />);
		await screen.findByText("ТОО Альфа");
		expectHeaders(["lineNumber", "onecBase", "onecTransport", "onecExtVersion", "organizations", "status"]);
		expectOnlySharedTables(container);
		const extra = spanOf(container, "buh_extra");
		expect(extra.className).toContain(styles.OverLimit);
		expect(extra.className).toContain(styles.Mono);
		expect(spanOf(container, "buh_main").className).not.toContain(styles.OverLimit);
		const state = spanOf(container, (t) => t.startsWith(translate("onecOverLimit")) && t.includes(translate("onecLimitMismatch")));
		expect(state.className).toContain(styles.OverLimit);
		// Ячейка организаций — один корневой span, в нём по строке на организацию.
		const orgs = spanOf(container, (t) => t.startsWith("ТОО Альфа"));
		expect(orgs.querySelectorAll(`.${styles.BaseOrg}`)).toHaveLength(2);
		// Организация и в другой базе агента — названа; кнопок включения БИН нет: допуск отменён (В8).
		expect(screen.getByText(`${translate("onecBinAlsoIn")}: buh_extra`)).toBeTruthy();
		expect(screen.queryAllByRole("button").some((b) => /БИН/.test(b.textContent ?? ""))).toBe(false);
		spanOf(container, translate("onecOrgsUnknown"));
	});
});

describe("Время и отказы — две Table, делящие высоту", () => {
	const stats = {
		durationsByType: {
			IB_INFO: { count: 3, avgMs: 1500, maxMs: 2000, p95LeSecs: 5 },
			IB_LIST_USERS: { count: 12, avgMs: 28200, maxMs: 61000, p95LeSecs: 60 },
		},
		failuresByCode: { IB_BUSY: 87 },
		seenAt: null,
	};

	it("обе таблицы с fitHeight, подписи времени — агентские, самое медленное сверху", async () => {
		const { container } = renderWith(<AgentStatsTab stats={stats} />);
		await screen.findByText("IB_BUSY");
		expectOnlySharedTables(container);
		expect(container.querySelectorAll(`.${tableStyles.TableWrapperFit}`)).toHaveLength(2);
		expectHeaders(["onecStatType", "onecStatCount", "onecStatAvg", "onecStatP95", "onecStatMax", "onecStatCode"]);
		spanOf(container, "28,2 с");
		spanOf(container, "≤ 60 с");
		spanOf(container, "87");
		const types = [...container.querySelectorAll("tbody td")].map((td) => td.textContent).filter((t) => t?.startsWith("IB_"));
		expect(types.indexOf("IB_LIST_USERS")).toBeLessThan(types.indexOf("IB_INFO"));
	});

	it("нет статистики — объяснение вместо таблиц", () => {
		const { container } = renderWith(<AgentStatsTab stats={undefined} />);
		expect(screen.getByText(translate("onecAgentStatsNone"))).toBeTruthy();
		expect(container.querySelector("table")).toBeNull();
	});
});

describe("Состояние сервера — процессы на SubTableSheets", () => {
	it("PID без разрядов, возраст словами, сирота — тоном ячейки «Что делает»; разделы «свойство: значение» на месте", () => {
		const { container } = renderWith(<AgentHealthTab agentId="ag1" agentName="Агент" />, {
			seed: (qc) => qc.setQueryData(["onec", "agent-health", "ag1"], {
				agent: { version: "2.0.1" },
				processes: [
					{ pid: 12345, tool: "ibcmd", what: "выгрузка", base: "buh1", ageSecs: 0 },
					{ pid: 777, tool: "rac", what: "сеансы", orphan: true, ageSecs: 3600 },
				],
			}),
		});
		expect(screen.getByText(translate("onecHealthProcesses"))).toBeTruthy();
		expectHeaders(["pid", "onecHealthTool", "onecHealthWhat", "onecQueueBase", "onecQueueAge"]);
		spanOf(container, "12345");
		spanOf(container, `0 ${translate("secShort")}`);
		expect(spanOf(container, `сеансы (${translate("onecHealthOrphan")})`).className).toContain(styles.ReqWait);
		expect(spanOf(container, "выгрузка").className).not.toContain(styles.ReqWait);
	});
});

describe("Кто держит очередь — SubTableSheets", () => {
	const stats = {
		types: [], queued: 0, running: 2, oldestQueuedSecs: 0, agentsOnline: 1, agentsBusy: 1, ibParallel: 1,
		runningCommands: [
			{ commandId: "cmd-1", type: "IB_LIST_USERS", baseKey: "buh1", agentId: "a", ageSecs: 90, abortable: true },
			{ commandId: "cmd-2", type: "IB_UPDATE", baseKey: null, agentId: "a", ageSecs: 30, abortable: false },
		],
		agentDurations: { IB_READ: { count: 5, avgMs: 1000, maxMs: 2000, p95LeSecs: 5 } },
	};
	beforeEach(() => { api.abortCommand.mockClear(); });

	it("«Прервать» — только у чтения и уходит с его id; время по типам — по кнопке", async () => {
		const { container } = renderWith(<QueueHolders stats={stats} />);
		expectOnlySharedTables(container);
		expectHeaders(["onecStatType", "onecQueueBase", "onecQueueAge"]);
		spanOf(container, "IB_UPDATE");
		spanOf(container, `2 ${translate("minShort")}`);
		const abort = screen.getAllByRole("button", { name: translate("onecQueueAbort") });
		expect(abort).toHaveLength(1);
		fireEvent.click(abort[0]);
		await waitFor(() => expect(api.abortCommand).toHaveBeenCalledWith("cmd-1"));

		expect(screen.queryByText("IB_READ")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: translate("onecQueueTypeTimes") }));
		spanOf(container, "IB_READ");
		spanOf(container, "1,0 с");
	});

	it("без права изменения — кнопки «Прервать» нет", () => {
		renderWith(<QueueHolders stats={stats} />, { superAdmin: false });
		expect(screen.getByText("IB_LIST_USERS")).toBeTruthy();
		expect(screen.queryAllByRole("button", { name: translate("onecQueueAbort") })).toHaveLength(0);
	});
});
