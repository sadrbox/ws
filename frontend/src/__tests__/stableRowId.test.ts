/**
 * Номер строки из её постоянного ключа (18.09): строка исчезла — у остальных номера не поехали.
 */
import { describe, it, expect } from "vitest";
import { stableRowId, withStableIds } from "src/utils/stableRowId";

const rows = (keys: string[]) => withStableIds(keys.map((uuid) => ({ uuid })), (r) => r.uuid);

describe("stableRowId", () => {
	it("один ключ — один номер, разные ключи — разные", () => {
		expect(stableRowId("s-1")).toBe(stableRowId("s-1"));
		expect(stableRowId("s-1")).not.toBe(stableRowId("s-2"));
	});

	it("номер положительный и не ноль", () => {
		for (const k of ["", "a", "сеанс-42", "x".repeat(300)]) {
			expect(stableRowId(k)).toBeGreaterThan(0);
			expect(Number.isSafeInteger(stableRowId(k))).toBe(true);
		}
	});
});

describe("withStableIds", () => {
	it("строка исчезла — у остальных номера прежние", () => {
		const before = rows(["a", "b", "c", "d"]);
		const after = rows(["b", "c", "d"]);
		for (const key of ["b", "c", "d"]) {
			expect(after.find((r) => r.uuid === key)!.id).toBe(before.find((r) => r.uuid === key)!.id);
		}
	});

	it("порядок строк номер не меняет", () => {
		const straight = rows(["a", "b", "c"]);
		const reversed = rows(["c", "b", "a"]);
		expect(reversed.map((r) => r.id).sort()).toEqual(straight.map((r) => r.id).sort());
	});

	it("номера уникальны даже при пустых и одинаковых ключах", () => {
		const list = withStableIds([{ k: "" }, { k: "" }, { k: "x" }], (r) => r.k);
		expect(new Set(list.map((r) => r.id)).size).toBe(3);
	});

	it("поля строки сохраняются", () => {
		expect(withStableIds([{ uuid: "u", name: "База" }], (r) => r.uuid)[0]).toMatchObject({ uuid: "u", name: "База" });
	});
});
