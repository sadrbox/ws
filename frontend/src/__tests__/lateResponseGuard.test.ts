import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { keepManualEdits, useFormLateResponseGuard } from "src/models/_shared/lateResponseGuard";

// Аудит 26.09, И13: гонки поздних ответов при смене организации/контрагента в формах документов.

interface Fields {
	organizationUuid: string; counterpartyUuid: string;
	contractUuid: string; contractName: string;
	warehouseUuid: string; warehouseName: string;
}
const EMPTY: Fields = { organizationUuid: "", counterpartyUuid: "", contractUuid: "", contractName: "", warehouseUuid: "", warehouseName: "" };

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

/** Форма как у useFormStore: синхронный снимок и setFields. */
function fakeForm(initial: Fields) {
	let fields = initial;
	const setFields = vi.fn((patch: Partial<Fields>) => { fields = { ...fields, ...patch }; });
	return { store: { getSnapshot: () => ({ fields }) }, setFields, get fields() { return fields; } };
}

describe("И13 — поздний ответ по прежнему выбору отбрасывается", () => {
	it("организация A→B: ответ по A пришёл позже и склад A в документ B не попал", async () => {
		const form = fakeForm(EMPTY);
		const { result } = renderHook(() => useFormLateResponseGuard<Fields>(form));
		const a = deferred<object>();
		const b = deferred<object>();
		form.setFields({ organizationUuid: "A" });
		const pA = result.current(() => a.promise, ["organizationUuid"]);
		form.setFields({ organizationUuid: "B" });
		const pB = result.current(() => b.promise, ["organizationUuid"]);
		b.resolve({ warehouseUuid: "wh-B", warehouseName: "Склад B" });
		expect(await pB).toEqual({ warehouseUuid: "wh-B", warehouseName: "Склад B" });
		a.resolve({ warehouseUuid: "wh-A", warehouseName: "Склад A" });
		expect(await pA).toBeNull();
		expect(form.fields.warehouseUuid).toBe("wh-B");
	});

	it("договор контрагента: за время запроса сменили организацию — ответ мимо", async () => {
		const form = fakeForm({ ...EMPTY, organizationUuid: "A", counterpartyUuid: "cp" });
		const { result } = renderHook(() => useFormLateResponseGuard<Fields>(form));
		const d = deferred<object>();
		const p = result.current(() => d.promise, ["counterpartyUuid", "organizationUuid"]);
		form.setFields({ organizationUuid: "B" });
		d.resolve({ contractUuid: "c-A", contractName: "Договор орг. A" });
		expect(await p).toBeNull();
		expect(form.fields.contractUuid).toBe("");
	});
});

describe("И13 — изменённое вручную за время запроса не перетирается", () => {
	it("склад выбрали, пока грузились дефолты: склад остаётся свой, договор из ответа применяется", async () => {
		const form = fakeForm({ ...EMPTY, organizationUuid: "B" });
		const { result } = renderHook(() => useFormLateResponseGuard<Fields>(form));
		const d = deferred<object>();
		const p = result.current(() => d.promise, ["organizationUuid"]);
		form.setFields({ warehouseUuid: "wh-manual", warehouseName: "Мой склад" });
		d.resolve({ warehouseUuid: "wh-B", warehouseName: "Склад B", contractUuid: "c-B", contractName: "Договор B" });
		expect(await p).toEqual({ contractUuid: "c-B", contractName: "Договор B" });
		expect(form.fields.warehouseUuid).toBe("wh-manual");
		expect(form.fields.contractUuid).toBe("c-B");
	});

	it("ответ без изменений (null) — setFields не зовётся, но ответ не считается поздним", async () => {
		const form = fakeForm({ ...EMPTY, counterpartyUuid: "cp" });
		const { result } = renderHook(() => useFormLateResponseGuard<Fields>(form));
		form.setFields.mockClear();
		expect(await result.current(() => Promise.resolve(null), ["counterpartyUuid"])).toEqual({});
		expect(form.setFields).not.toHaveBeenCalled();
	});

	it("keepManualEdits", () => {
		const before = { a: 1, b: 2, c: 3 };
		const now = { a: 1, b: 20, c: 3 };
		expect(keepManualEdits({ a: 10, b: 200, c: 30 }, before, now)).toEqual({ a: 10, c: 30 });
	});
});
