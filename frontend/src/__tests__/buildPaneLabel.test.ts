import { describe, it, expect, vi } from "vitest";

vi.mock("src/i18", () => ({
	translate: (key: string) => {
		const dict: Record<string, string> = {
			SaleItemsList: "Товары реализации",
			SalesList: "Реализация товара и услуг",
			CashboxesList: "Кассы",
			new: "Новый",
		};
		return dict[key] ?? "";
	},
}));

vi.mock("src/utils/main.module", () => ({
	getFormatDateOnly: (s: string) =>
		s.slice(0, 10).split("-").reverse().join("."),
}));

import {
	makePaneLabel,
	makeDocLabel,
	makePaneLabelFromData,
} from "src/utils/buildPaneLabel";

describe("makePaneLabel", () => {
	it("формирует метку с id и displayValue", () => {
		expect(
			makePaneLabel(
				"SaleItemsList",
				"fallback",
				{ id: 7 },
				"Товар A · 1 × 100",
			),
		).toBe("Товары реализации: №7 · Товар A · 1 × 100");
	});

	it("если displayValue не задан — берёт saved.name", () => {
		expect(
			makePaneLabel("SaleItemsList", "fallback", { id: 5, name: "X" }),
		).toBe("Товары реализации: №5 · X");
	});

	it("без detail — только №id", () => {
		expect(makePaneLabel("SaleItemsList", "fallback", { id: 3 })).toBe(
			"Товары реализации: №3",
		);
	});

	it("если ключ перевода неизвестен — fallback", () => {
		expect(makePaneLabel("UnknownKey", "Резерв", { id: 1 })).toBe("Резерв: №1");
	});

	it("без id — №?", () => {
		expect(makePaneLabel("SaleItemsList", "fallback", {})).toBe(
			"Товары реализации: №?",
		);
	});
});

describe("makeDocLabel", () => {
	it("формирует метку документа с датой", () => {
		expect(
			makeDocLabel("SalesList", "fallback", { id: 42, date: "2026-04-21" }),
		).toBe("Реализация товара и услуг: №42 · 21.04.2026");
	});

	it("если даты нет — только №id", () => {
		expect(makeDocLabel("SalesList", "fallback", { id: 12 })).toBe(
			"Реализация товара и услуг: №12",
		);
	});

	it("использует кастомное имя поля даты", () => {
		expect(
			makeDocLabel(
				"SalesList",
				"fallback",
				{ id: 8, postedAt: "2026-01-10" },
				"postedAt",
			),
		).toBe("Реализация товара и услуг: №8 · 10.01.2026");
	});
});

describe("makePaneLabelFromData", () => {
	it("без данных — Новый", () => {
		expect(makePaneLabelFromData("SaleItemsList", "fallback")).toBe(
			"Товары реализации: Новый",
		);
	});

	it("с null — Новый", () => {
		expect(makePaneLabelFromData("SaleItemsList", "fallback", null)).toBe(
			"Товары реализации: Новый",
		);
	});

	it("с данными и displayValue", () => {
		expect(
			makePaneLabelFromData(
				"SaleItemsList",
				"fallback",
				{ id: 9, uuid: "u" },
				"Реализация товара и услуг: №7 · 21.04.2026 · Товар",
			),
		).toBe("Товары реализации: №9 · Реализация: №7 · 21.04.2026 · Товар");
	});

	it("без displayValue — берёт name", () => {
		expect(
			makePaneLabelFromData("SaleItemsList", "fallback", {
				id: 1,
				uuid: "u",
				name: "Альфа",
			}),
		).toBe("Товары реализации: №1 · Альфа");
	});
});
