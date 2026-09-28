/**
 * Регрессия аудита критических ошибок 27.09 — фронтенд, КР-22 и P3:
 * офлайн-подсказки с общими записями; подтверждения без двойного экранирования; отметка прихода
 * в приватном режиме; сообщение об отклонённых офлайн-изменениях; таблицы, которые /sync/pull
 * отдал не целиком (КР-18).
 */
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const RECORDS = vi.hoisted(() => [
	{ uuid: "w1", id: 1, name: "Склад А", organizationUuid: "org-A", ownerUuid: "o1" },
	{ uuid: "w2", id: 2, name: "Общий склад", organizationUuid: null, ownerUuid: null },
	{ uuid: "w3", id: 3, name: "Склад Б", organizationUuid: "org-B", ownerUuid: "o2" },
]);
const pending = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
const net = vi.hoisted(() => ({ online: false }));
const mocks = vi.hoisted(() => ({
	post: vi.fn(),
	notify: vi.fn(() => ""),
	update: vi.fn(async () => { await Promise.resolve(); return 1; }),
	markWorkDay: vi.fn(),
	fetchFirmCandidates: vi.fn(),
	saveQualitySettings: vi.fn(),
}));
vi.mock("src/services/networkStatus", () => ({ getIsOnline: () => net.online }));
vi.mock("src/services/api/client", () => ({ default: { get: vi.fn(), post: mocks.post }, api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("src/components/TechMessages/store", async (orig) => ({ ...(await orig<object>()), notify: mocks.notify }));
vi.mock("src/services/offlineDb", () => ({
	offlineDb: { _pendingChanges: { update: mocks.update } },
	SYNCABLE_TABLES: ["warehouses", "sales", "counterparties", "organizations"],
	ensureOfflineDb: vi.fn(),
	getLastSyncAt: vi.fn(async () => { await Promise.resolve(); return null; }),
	setLastSyncAt: vi.fn(async () => { }),
	getAllPendingChanges: vi.fn(async () => { await Promise.resolve(); return pending.list; }),
	removePendingChange: vi.fn(async () => { }),
	upsertRecords: vi.fn(async () => { }),
	addPendingChange: vi.fn(),
	getRecordByUuid: vi.fn(),
	countActiveRecords: vi.fn(async () => { await Promise.resolve(); return RECORDS.length; }),
	getActiveRecords: vi.fn(async () => { await Promise.resolve(); return RECORDS; }),
	searchRecords: vi.fn(async () => { await Promise.resolve(); return RECORDS; }),
}));
vi.mock("src/services/quality/api", () => ({
	markWorkDay: mocks.markWorkDay,
	fetchNotifications: vi.fn(),
	fetchFirmCandidates: mocks.fetchFirmCandidates,
	saveQualitySettings: mocks.saveQualitySettings,
}));
vi.mock("src/services/auth", () => ({ getCurrentUser: () => ({ uuid: "u-1" }), isAuthenticated: () => true, verifyToken: () => null, logout: () => { } }));

import { fetchList } from "src/services/offlineDataService";
import { fullSync, resetPullScopeNoteForTests } from "src/services/syncManager";
import { markOnLoginOncePerDay, resetLoginMarkState } from "src/hooks/useQualityNotifications";
import { FirmSection } from "src/models/QualitySettings/FirmSection";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("КР-22: офлайн-подсказки — общие записи", () => {
	it("фильтр по организации отдаёт её записи и общие (как сервер: X + общие)", async () => {
		const r = await fetchList("warehouses", undefined, { limit: 200, organizationUuid: "org-A" });
		expect(r.items.map((i) => (i as { uuid: string }).uuid)).toEqual(["w1", "w2"]);
	});
	it("organizationUuid=null — только общие", async () => {
		const r = await fetchList("warehouses", undefined, { limit: 200, organizationUuid: "null" });
		expect(r.items.map((i) => (i as { uuid: string }).uuid)).toEqual(["w2"]);
	});
	it("другие поля фильтра пустое значение по-прежнему отсекают", async () => {
		const r = await fetchList("warehouses", undefined, { limit: 200, ownerUuid: "o1" });
		expect(r.items.map((i) => (i as { uuid: string }).uuid)).toEqual(["w1"]);
	});
});

describe("КР-22: отметка прихода в приватном режиме", () => {
	beforeEach(() => { resetLoginMarkState(); mocks.markWorkDay.mockReset(); });
	it("localStorage недоступен — отметка уходит раз в день, а не на каждом круге опроса", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError"); });
		mocks.markWorkDay.mockResolvedValue({ data: { success: true } });
		const MORNING = Date.parse("2026-09-26T09:00:00+05:00");
		markOnLoginOncePerDay(MORNING);
		await new Promise((r) => setTimeout(r, 0));
		markOnLoginOncePerDay(MORNING + 60_000);
		markOnLoginOncePerDay(MORNING + 120_000);
		await new Promise((r) => setTimeout(r, 0));
		expect(mocks.markWorkDay).toHaveBeenCalledTimes(1);
	});
});

describe("P3 и КР-18: сообщения обмена", () => {
	const pulled = (extra: Record<string, unknown> = {}) => ({ data: { success: true, serverTime: "2026-09-26T00:00:00.000Z", data: {}, ...extra } });
	beforeEach(() => {
		net.online = true;
		mocks.notify.mockClear();
		mocks.post.mockReset();
		resetPullScopeNoteForTests();
		pending.list = [];
	});
	afterEach(() => { net.online = false; });

	it("отклонённый офлайн-документ: не «откройте документ», а где данные — очередь синхронизации", async () => {
		pending.list = [{ id: 1, table: "sales", uuid: "s1", action: "create", data: {}, clientUpdatedAt: "x", createdAt: "x" }];
		mocks.post.mockResolvedValue(pulled());
		await fullSync();
		const call = mocks.notify.mock.calls.map((c) => (c as unknown[])[0] as { text: string; severity: string }).find((o) => o.severity === "error");
		expect(call?.text).not.toMatch(/откройте документ/);
		expect(call?.text).toMatch(/очереди синхронизации: «Синхронизация и оффлайн-данные» → «Очередь»/);
		expect(call?.text).toMatch(/\(Продажи\)/);
	});

	it("таблицы, отданные не целиком, — запись в журнале без тоста, один раз на состав", async () => {
		mocks.post.mockResolvedValue(pulled({ skipped: ["products"], limited: ["organizations"] }));
		await fullSync();
		await fullSync();
		const infos = mocks.notify.mock.calls.map((c) => (c as unknown[])[0] as { text: string; severity: string; toast?: unknown }).filter((o) => o.severity === "info");
		expect(infos).toHaveLength(1);
		expect(infos[0].toast).toBe(false);
		expect(infos[0].text).toMatch(/не попали .*products/);
		expect(infos[0].text).toMatch(/сокращённые данные .*Организации/);
	});

	it("всё отдано целиком — сообщать нечего", async () => {
		mocks.post.mockResolvedValue(pulled());
		await fullSync();
		expect(mocks.notify.mock.calls.filter((c) => ((c as unknown[])[0] as { severity: string }).severity === "info")).toHaveLength(0);
	});
});

describe("КР-22: подтверждение назначения фирмы — текст как есть", () => {
	it("«&» в имени фирмы не превращается в «&amp;»", async () => {
		mocks.fetchFirmCandidates.mockResolvedValue({ items: [{ uuid: "f1", name: "ТОО «Рога & Копыта»", bin: null, kind: "service", isAdmin: true, members: 3 }] });
		const confirm = vi.fn(() => Promise.resolve(false));
		const value = {
			screenRef: { current: null },
			windows: { panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { }, setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { } },
			actions: { confirm },
			navbar: { props: [], setProps: () => { } },
			auth: { user: null, logout: () => { } },
		} as unknown as TypeAppContextProps;
		render(
			<QueryClientProvider client={new QueryClient()}>
				<AppContextProvider value={value}><FirmSection firmName={null} firmExplicit={false} isAdmin /></AppContextProvider>
			</QueryClientProvider>,
		);
		// Кандидат приходит запросом — ждём его строку и жмём «Назначить» в ней.
		const item = await screen.findByRole("listitem");
		fireEvent.click(item.querySelector("button")!);
		await waitFor(() => expect(confirm).toHaveBeenCalled());
		const msg = (confirm.mock.calls[0] as unknown[])[0] as string;
		expect(msg).toContain("Рога & Копыта");
		expect(msg).not.toContain("&amp;");
	});
});

void React;
