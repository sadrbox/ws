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

vi.mock("src/utils/datetime", () => ({
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
				"Товар A - 1 × 100",
			),
		).toBe("Товары реализации: ID 7 - Товар A - 1 × 100");
	});

	it("если displayValue не задан — берёт saved.name", () => {
		expect(
			makePaneLabel("SaleItemsList", "fallback", { id: 5, name: "X" }),
		).toBe("Товары реализации: ID 5 - X");
	});

	it("без detail — только ID id", () => {
		expect(makePaneLabel("SaleItemsList", "fallback", { id: 3 })).toBe(
			"Товары реализации: ID 3",
		);
	});

	it("если ключ перевода неизвестен — fallback", () => {
		expect(makePaneLabel("UnknownKey", "Резерв", { id: 1 })).toBe(
			"Резерв: ID 1",
		);
	});

	it("без id — Новый", () => {
		expect(makePaneLabel("SaleItemsList", "fallback", {})).toBe(
			"Товары реализации: Новый",
		);
	});
});

describe("makeDocLabel", () => {
	it("формирует метку документа с датой", () => {
		expect(
			makeDocLabel("SalesList", "fallback", { id: 42, date: "2026-04-21" }),
		).toBe("Реализация товара и услуг: ID 42 - 21.04.2026");
	});

	it("если даты нет — только ID id", () => {
		expect(makeDocLabel("SalesList", "fallback", { id: 12 })).toBe(
			"Реализация товара и услуг: ID 12",
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
		).toBe("Реализация товара и услуг: ID 8 - 10.01.2026");
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

	it("с данными и displayValue (displayValue добавляется как есть)", () => {
		expect(
			makePaneLabelFromData(
				"SaleItemsList",
				"fallback",
				{ id: 9, uuid: "u" },
				"Реализация товара и услуг: ID 7 - 21.04.2026 - Товар",
			),
		).toBe(
			"Товары реализации: ID 9 - Реализация товара и услуг: ID 7 - 21.04.2026 - Товар",
		);
	});

	it("без displayValue — берёт name", () => {
		expect(
			makePaneLabelFromData("SaleItemsList", "fallback", {
				id: 1,
				uuid: "u",
				name: "Альфа",
			}),
		).toBe("Товары реализации: ID 1 - Альфа");
	});

	// Регрессия: список строил «ID 965 - 15.07.2026», а форма после загрузки
	// переименовывала панель в «№ РЕАЛ-2 - 15.07.2026». Заголовок вкладки прыгал,
	// а повторное открытие той же строки выглядело для addPane как конфликт подписей.
	it("у документа с номером ссылка — номер, а не ID (как в makeDocLabel)", () => {
		const doc = { id: 965, uuid: "u", number: "РЕАЛ-2", date: "2026-07-15" };

		expect(makePaneLabelFromData("SalesList", "fallback", doc, "15.07.2026")).toBe(
			"Реализация товара и услуг: № РЕАЛ-2 - 15.07.2026",
		);
		// Обе функции обязаны давать одну и ту же подпись — иначе панель переименуется.
		expect(makePaneLabelFromData("SalesList", "fallback", doc, "15.07.2026")).toBe(
			makeDocLabel("SalesList", "fallback", doc),
		);
	});

	it("без номера — прежний вид с ID", () => {
		expect(
			makePaneLabelFromData("SalesList", "fallback", { id: 965, uuid: "u" }, "15.07.2026"),
		).toBe("Реализация товара и услуг: ID 965 - 15.07.2026");
	});
});
