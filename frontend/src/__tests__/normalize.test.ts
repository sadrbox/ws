import { describe, it, expect } from "vitest";
import {
	normalizeValue,
	isEquivalent,
	stableStringify,
} from "src/utils/normalize";

describe("normalize / isEquivalent", () => {
	it("treats null/undefined/empty-string equivalently", () => {
		expect(isEquivalent(null, undefined)).toBe(true);
		expect(isEquivalent("", null)).toBe(true);
		expect(isEquivalent("   ", undefined)).toBe(true);
	});

	it("treats numeric strings and numbers as equal", () => {
		expect(isEquivalent("30", 30)).toBe(true);
		expect(isEquivalent("3.14", 3.14)).toBe(true);
		expect(isEquivalent(" -7 ", -7)).toBe(true);
	});

	it("trims surrounding whitespace in strings", () => {
		expect(isEquivalent("  hi  ", "hi")).toBe(true);
	});

	it("ignores key order in objects", () => {
		expect(isEquivalent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
	});

	it("treats missing key and null-valued key as equivalent", () => {
		expect(isEquivalent({ a: 1, b: null }, { a: 1 })).toBe(true);
		expect(isEquivalent({ a: 1, b: undefined }, { a: 1 })).toBe(true);
	});

	it("normalizes nested arrays/objects", () => {
		const a = { items: [{ qty: "1", price: 2 }, { qty: 0 }] };
		const b = { items: [{ qty: 1, price: "2" }, { qty: "0" }] };
		expect(isEquivalent(a, b)).toBe(true);
	});

	it("detects real differences", () => {
		expect(isEquivalent("30", 31)).toBe(false);
		expect(isEquivalent({ a: 1 }, { a: 2 })).toBe(false);
		expect(isEquivalent([1, 2], [1, 2, 3])).toBe(false);
	});

	it("normalizes Date to ISO string", () => {
		const d = new Date("2024-01-15T10:00:00Z");
		expect(normalizeValue(d)).toBe("2024-01-15T10:00:00.000Z");
		expect(isEquivalent(d, new Date("2024-01-15T10:00:00Z"))).toBe(true);
	});

	it("stableStringify is independent of key order", () => {
		expect(stableStringify({ a: 1, b: 2 })).toBe(
			stableStringify({ b: 2, a: 1 }),
		);
	});

	it("Decimal-like with toString returning numeric string is normalized to number", () => {
		const decimalLike = { toString: () => "12.5" };
		expect(normalizeValue(decimalLike)).toBe(12.5);
		expect(isEquivalent(decimalLike, "12.5")).toBe(true);
		expect(isEquivalent(decimalLike, 12.5)).toBe(true);
	});

	it("ignores server-managed timestamps (createdAt/updatedAt/deletedAt)", () => {
		// Разные значения этих ключей не должны давать различий
		expect(
			isEquivalent(
				{ id: 1, name: "A", updatedAt: "2024-01-01T00:00:00Z" },
				{ id: 1, name: "A", updatedAt: "2025-06-15T12:34:56Z" },
			),
		).toBe(true);
		expect(
			isEquivalent(
				{ id: 1, deletedAt: null },
				{ id: 1, deletedAt: "2025-01-01" },
			),
		).toBe(true);
		// И на вложенном уровне (организация, контрагент и т.п.)
		expect(
			isEquivalent(
				{ org: { uuid: "x", name: "A", createdAt: "2024-01-01" } },
				{ org: { uuid: "x", name: "A", createdAt: "2025-09-09" } },
			),
		).toBe(true);
	});
});
