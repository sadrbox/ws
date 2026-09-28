/**
 * Регрессия аудита критических ошибок 27.09, КР-6: выбор контрагента (покупателя), пока идёт запрос
 * дефолтов новой организации, не должен отбрасывать эти дефолты — склад, касса, договор, счёт, тип
 * цен прежней организации не уходят в документ новой. Основа — repro/insp_fe/lateGuard.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { apiMock } = vi.hoisted(() => ({
	apiMock: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("src/services/api/client", () => ({ __esModule: true, api: apiMock, default: {} }));

import { useLateResponseGuard, useFormLateResponseGuard, orgResetPatch } from "src/models/_shared/lateResponseGuard";
import { useTerminalRequisites, useTerminalOrgBuyer, type TerminalRequisites, type TerminalContractLookup } from "src/models/SalesTerminal/terminalSale";

type F = { organizationUuid: string; counterpartyUuid: string; warehouseUuid: string; contractUuid: string };

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

function fakeForm(initial: F) {
	let fields = initial;
	const setFields = vi.fn((patch: Partial<F>) => { fields = { ...fields, ...patch }; });
	return { store: { getSnapshot: () => ({ fields }) }, setFields, get fields() { return fields; } };
}

describe("КР-6: у обработчика организации и контрагента — свои счётчики запросов", () => {
	it("один guard на форму: контрагент, выбранный во время запроса дефолтов организации, их не отбрасывает", async () => {
		let fields: F = { organizationUuid: "A", counterpartyUuid: "", warehouseUuid: "whA", contractUuid: "" };
		const get = () => fields;
		const apply = (p: Partial<F>) => { fields = { ...fields, ...p }; };
		const { result } = renderHook(() => useLateResponseGuard<F>(get, apply));
		const guard = result.current;

		// Выбрали организацию B: поле записано, запрос дефолтов B идёт (медленный).
		apply({ organizationUuid: "B" });
		const org = deferred<object>();
		const orgP = guard(() => org.promise, ["organizationUuid"]);
		// Пока он идёт — выбрали контрагента (быстрый ответ: основной договор).
		apply({ counterpartyUuid: "C1" });
		const cpP = guard(() => Promise.resolve({ contractUuid: "ctr-C1-B" }), ["counterpartyUuid", "organizationUuid"]);
		await act(async () => { await cpP; });
		// Пришли дефолты организации B.
		await act(async () => { org.resolve({ warehouseUuid: "whB", contractUuid: "ctrB-default" }); await orgP; });

		expect(await orgP).toEqual({ warehouseUuid: "whB" });
		expect(fields).toEqual({ organizationUuid: "B", counterpartyUuid: "C1", warehouseUuid: "whB", contractUuid: "ctr-C1-B" });
	});

	it("отдельные guard у обработчиков (как в формах): оба ответа применяются", async () => {
		const form = fakeForm({ organizationUuid: "A", counterpartyUuid: "", warehouseUuid: "whA", contractUuid: "" });
		const { result } = renderHook(() => ({ org: useFormLateResponseGuard<F>(form), cp: useFormLateResponseGuard<F>(form) }));
		form.setFields({ organizationUuid: "B", ...orgResetPatch([{ uuidKey: "warehouseUuid", nameKey: "warehouseName" }]) } as Partial<F>);
		expect(form.fields.warehouseUuid).toBe("");
		const org = deferred<object>();
		const orgP = result.current.org(() => org.promise, ["organizationUuid"]);
		form.setFields({ counterpartyUuid: "C1" });
		await act(async () => { await result.current.cp(() => Promise.resolve({ contractUuid: "ctr-C1-B" }), ["counterpartyUuid", "organizationUuid"]); });
		await act(async () => { org.resolve({ warehouseUuid: "whB", contractUuid: "ctrB-default" }); await orgP; });
		expect(form.fields.warehouseUuid).toBe("whB");
		expect(form.fields.contractUuid).toBe("ctr-C1-B");
	});

	it("тот же обработчик: поздний ответ по прежней организации по-прежнему отбрасывается", async () => {
		const form = fakeForm({ organizationUuid: "", counterpartyUuid: "", warehouseUuid: "", contractUuid: "" });
		const { result } = renderHook(() => useFormLateResponseGuard<F>(form));
		const a = deferred<object>();
		const b = deferred<object>();
		form.setFields({ organizationUuid: "A" });
		const pA = result.current(() => a.promise, ["organizationUuid"]);
		form.setFields({ organizationUuid: "A2" });
		form.setFields({ organizationUuid: "A" });
		const pB = result.current(() => b.promise, ["organizationUuid"]);
		b.resolve({ warehouseUuid: "wh-2" });
		await pB;
		a.resolve({ warehouseUuid: "wh-1" });
		expect(await pA).toBeNull();
		expect(form.fields.warehouseUuid).toBe("wh-2");
	});

	it("orgResetPatch: поля организации — пустые строки", () => {
		expect(orgResetPatch([
			{ uuidKey: "warehouseUuid", nameKey: "warehouseName" },
			{ uuidKey: "cashboxUuid", nameKey: "cashboxName" },
		])).toEqual({ warehouseUuid: "", warehouseName: "", cashboxUuid: "", cashboxName: "" });
	});
});

describe("КР-6: терминал — организация и покупатель", () => {
	// Дефолты пользователя по организации: ответ /user-defaults ждёт, пока тест его не отпустит.
	const pending = new Map<string, (items: object[]) => void>();
	beforeEach(() => {
		localStorage.clear();
		pending.clear();
		apiMock.get.mockReset();
		apiMock.get.mockImplementation((url: string, cfg?: { params?: { organizationUuid?: string } }) => {
			if (url !== "/user-defaults") return Promise.resolve({ items: [] });
			const org = cfg?.params?.organizationUuid ?? "";
			return new Promise((resolve) => { pending.set(org, (items) => resolve({ items })); });
		});
	});
	const defaults = (org: string) => [
		{ valueType: "warehouse", valueUuid: `wh-${org}`, valueName: `Склад ${org}` },
		{ valueType: "cashbox", valueUuid: `cb-${org}`, valueName: `Касса ${org}` },
		{ valueType: "salePriceType", valueUuid: `pt-${org}`, valueName: `Цены ${org}` },
	];

	function setup() {
		const onOrgReset = vi.fn();
		const onOrgApplied = vi.fn((_req: TerminalRequisites) => { });
		const syncContract = vi.fn<TerminalContractLookup>(({ counterpartyUuid, organizationUuid }) => Promise.resolve({
			contractUuid: `ctr-${counterpartyUuid}-${organizationUuid ?? ""}`, contractName: "Основной",
		}));
		const hook = renderHook(() => {
			const r = useTerminalRequisites({ orgUuid: "A", orgName: "Орг A" });
			const h = useTerminalOrgBuyer({ getRequisites: r.getRequisites, setRequisites: r.setRequisites, userUuid: "u-1", syncContract, onOrgReset, onOrgApplied });
			return { r, h };
		});
		// Реквизиты организации A — как после её выбора.
		act(() => hook.result.current.r.setRequisites({ warehouseUuid: "wh-A", warehouseName: "Склад A", cashboxUuid: "cb-A", cashboxName: "Касса A", priceTypeUuid: "pt-A", priceTypeName: "Цены A" }));
		return { hook, onOrgReset, onOrgApplied, syncContract };
	}

	it("смена организации сразу чистит склад, кассу и тип цен прежней", async () => {
		const { hook, onOrgReset } = setup();
		let p!: Promise<void>;
		act(() => { p = hook.result.current.h.handleOrgChange("B", "Орг B"); });
		expect(onOrgReset).toHaveBeenCalledTimes(1);
		expect(hook.result.current.r.getRequisites()).toMatchObject({ orgUuid: "B", warehouseUuid: "", cashboxUuid: "", priceTypeUuid: "" });
		await act(async () => { pending.get("B")?.(defaults("B")); await p; });
	});

	it("покупатель выбран, пока грузились дефолты новой организации: дефолты применены, прайс перечитан", async () => {
		const { hook, onOrgApplied } = setup();
		let orgP!: Promise<void>;
		act(() => { orgP = hook.result.current.h.handleOrgChange("B", "Орг B"); });
		await act(async () => { await hook.result.current.h.selectBuyer("C1", "Покупатель"); });
		expect(hook.result.current.r.getRequisites().contractUuid).toBe("ctr-C1-B");
		await act(async () => { pending.get("B")?.(defaults("B")); await orgP; });
		expect(hook.result.current.r.getRequisites()).toMatchObject({
			orgUuid: "B", buyerUuid: "C1", contractUuid: "ctr-C1-B",
			warehouseUuid: "wh-B", cashboxUuid: "cb-B", priceTypeUuid: "pt-B",
		});
		expect(hook.result.current.r.warehouseUuid).toBe("wh-B");
		expect(onOrgApplied).toHaveBeenCalledTimes(1);
		expect(onOrgApplied.mock.calls[0][0]).toMatchObject({ orgUuid: "B", priceTypeUuid: "pt-B" });
	});

	it("дефолтов у новой организации нет — прайс всё равно перечитывается (тип цен выберет сервер)", async () => {
		const { hook, onOrgApplied } = setup();
		let p!: Promise<void>;
		act(() => { p = hook.result.current.h.handleOrgChange("B", "Орг B"); });
		await act(async () => { pending.get("B")?.([]); await p; });
		expect(onOrgApplied).toHaveBeenCalledTimes(1);
		expect(onOrgApplied.mock.calls[0][0]).toMatchObject({ orgUuid: "B", priceTypeUuid: "", warehouseUuid: "" });
	});

	it("организацию сменили дважды, ответы пришли наоборот: применены дефолты последней, прайс — один раз", async () => {
		const { hook, onOrgApplied } = setup();
		let pB!: Promise<void>;
		let pC!: Promise<void>;
		act(() => { pB = hook.result.current.h.handleOrgChange("B", "Орг B"); });
		act(() => { pC = hook.result.current.h.handleOrgChange("C", "Орг C"); });
		await act(async () => { pending.get("C")?.(defaults("C")); await pC; });
		await act(async () => { pending.get("B")?.(defaults("B")); await pB; });
		expect(hook.result.current.r.getRequisites()).toMatchObject({ orgUuid: "C", warehouseUuid: "wh-C", priceTypeUuid: "pt-C" });
		expect(onOrgApplied).toHaveBeenCalledTimes(1);
		expect(onOrgApplied.mock.calls[0][0]).toMatchObject({ orgUuid: "C" });
	});

	it("склад, выбранный вручную за время запроса, ответ не перетирает", async () => {
		const { hook } = setup();
		let p!: Promise<void>;
		act(() => { p = hook.result.current.h.handleOrgChange("B", "Орг B"); });
		act(() => hook.result.current.r.setRequisites({ warehouseUuid: "wh-manual", warehouseName: "Мой" }));
		await act(async () => { pending.get("B")?.(defaults("B")); await p; });
		expect(hook.result.current.r.getRequisites()).toMatchObject({ warehouseUuid: "wh-manual", cashboxUuid: "cb-B" });
	});
});
