import { describe, expect, it } from "vitest";
import {
	recalcSaleItemAmounts,
	withSaleItemRecalc,
	withSaleItemRecalcFromDiscountAmount,
} from "src/models/Sales/saleItemDraft";

describe("saleItemDraft", () => {
	it("recalculates discount, VAT included and total amount", () => {
		// 2×100 = 200, скидка 10% → 180, НДС 12% INCLUDED → vat=19.29
		// amountWithoutVat = 180 − 19.29 = 160.71
		expect(recalcSaleItemAmounts("2", "100", "12", "10")).toEqual({
			discountAmount: 20,
			exciseAmount: 0,
			vatAmount: 19.29,
			amount: 180,
			amountWithoutVat: 160.71,
		});
	});

	it("returns zeros for empty values", () => {
		expect(recalcSaleItemAmounts("", "", "", "")).toEqual({
			discountAmount: 0,
			exciseAmount: 0,
			vatAmount: 0,
			amount: 0,
			amountWithoutVat: 0,
		});
	});

	it("merges patch and recalculated fields for draft row updates", () => {
		const row = {
			quantity: "1",
			price: "50",
			vatRate: "12",
			discountPercent: "0",
			amount: "50",
			vatAmount: "5.36",
			discountAmount: "0",
		};

		expect(
			withSaleItemRecalc(row, { quantity: "3", discountPercent: "5" }),
		).toEqual({
			quantity: "3",
			discountPercent: "5",
			discountAmount: 7.5,
			exciseAmount: 0,
			vatAmount: 15.27,
			amount: 142.5,
			amountWithoutVat: 127.23,
		});
	});

	it("без НДС (vatRate=0): vatAmount=0, amountWithoutVat = amount", () => {
		expect(recalcSaleItemAmounts("2", "100", "0", "0")).toEqual({
			discountAmount: 0,
			exciseAmount: 0,
			vatAmount: 0,
			amount: 200,
			amountWithoutVat: 200,
		});
	});

	it("отрицательная сумма скидки приводится к 0", () => {
		const row = { quantity: "1", price: "100", vatRate: "0" };
		expect(withSaleItemRecalcFromDiscountAmount(row, "-10")).toEqual({
			discountAmount: 0,
			discountPercent: 0,
			exciseAmount: 0,
			vatAmount: 0,
			amount: 100,
			amountWithoutVat: 100,
		});
	});

	it("сумма скидки не превышает базы", () => {
		const row = { quantity: "1", price: "100", vatRate: "0" };
		expect(withSaleItemRecalcFromDiscountAmount(row, "500")).toEqual({
			discountAmount: 100,
			discountPercent: 100,
			exciseAmount: 0,
			vatAmount: 0,
			amount: 0,
			amountWithoutVat: 0,
		});
	});

	it("принимает числовые значения, а не только строки", () => {
		expect(recalcSaleItemAmounts(2, 50, 0, 10)).toEqual({
			discountAmount: 10,
			exciseAmount: 0,
			vatAmount: 0,
			amount: 90,
			amountWithoutVat: 90,
		});
	});

	// ── Метод расчёта НДС из справочника VatRate ─────────────────────────
	it("ADDED: НДС начисляется сверху, amount = base + vat", () => {
		// 1000 × 1000, 12% сверху → vat=120000, amount=1120000
		expect(recalcSaleItemAmounts(1000, 1000, 12, 0, "ADDED")).toEqual({
			discountAmount: 0,
			exciseAmount: 0,
			vatAmount: 120000,
			amount: 1120000,
			amountWithoutVat: 1000000,
		});
	});

	it("INCLUDED (по умолчанию): НДС в сумме", () => {
		expect(recalcSaleItemAmounts(1000, 1000, 12, 0, "INCLUDED")).toEqual({
			discountAmount: 0,
			exciseAmount: 0,
			vatAmount: 107142.86,
			amount: 1000000,
			amountWithoutVat: 892857.14,
		});
	});

	it("ADDED со скидкой: vat считается от afterDiscount", () => {
		// 100×10 = 1000, скидка 10% → after=900, vat ADDED 12% = 108, amount=1008
		expect(recalcSaleItemAmounts(100, 10, 12, 10, "ADDED")).toEqual({
			discountAmount: 100,
			exciseAmount: 0,
			vatAmount: 108,
			amount: 1008,
			amountWithoutVat: 900,
		});
	});

	it("withSaleItemRecalc берёт метод из vatCalculationMethod", () => {
		const row = {
			quantity: "1",
			price: "1000",
			vatRate: "12",
			discountPercent: "0",
			vatCalculationMethod: "ADDED",
		};
		expect(withSaleItemRecalc(row, { quantity: "2" })).toEqual({
			quantity: "2",
			discountAmount: 0,
			exciseAmount: 0,
			vatAmount: 240,
			amount: 2240,
			amountWithoutVat: 2000,
		});
	});

	it("withSaleItemRecalcFromDiscountAmount учитывает ADDED", () => {
		const row = {
			quantity: "1",
			price: "1000",
			vatRate: "12",
			vatCalculationMethod: "ADDED",
		};
		expect(withSaleItemRecalcFromDiscountAmount(row, "100")).toEqual({
			discountAmount: 100,
			discountPercent: 10,
			exciseAmount: 0,
			vatAmount: 108,
			amount: 1008,
			amountWithoutVat: 900,
		});
	});

	// ── Акциз (НК РК ст. 463) ────────────────────────────────────────────
	it("акциз ADDED увеличивает базу НДС (метод ADDED)", () => {
		// 1×1000, скидки нет, акциз 5% → exciseAmount=50, vatBase=1050,
		// НДС 12% сверху = 126, amount = 1176, amountWithoutVat = 1050.
		expect(recalcSaleItemAmounts(1, 1000, 12, 0, "ADDED", 5)).toEqual({
			discountAmount: 0,
			exciseAmount: 50,
			vatAmount: 126,
			amount: 1176,
			amountWithoutVat: 1050,
		});
	});

	it("акциз ADDED увеличивает базу НДС (метод INCLUDED)", () => {
		// 1×1000, акциз 5% → exciseAmount=50, vatBase=1050,
		// НДС 12% в т.ч. = 1050 × 12 / 112 = 112.5, amount=1050.
		expect(recalcSaleItemAmounts(1, 1000, 12, 0, "INCLUDED", 5)).toEqual({
			discountAmount: 0,
			exciseAmount: 50,
			vatAmount: 112.5,
			amount: 1050,
			amountWithoutVat: 937.5,
		});
	});

	it("акциз 0% не влияет на расчёт", () => {
		const withZero = recalcSaleItemAmounts(1, 1000, 12, 0, "ADDED", 0);
		const without = recalcSaleItemAmounts(1, 1000, 12, 0, "ADDED");
		expect(withZero).toEqual({ ...without, exciseAmount: 0 });
	});

	it("withSaleItemRecalc передаёт exciseRate в расчёт", () => {
		const row = {
			quantity: "1",
			price: "1000",
			vatRate: "12",
			discountPercent: "0",
			exciseRate: "5",
			vatCalculationMethod: "ADDED",
		};
		expect(withSaleItemRecalc(row, { quantity: "1" })).toEqual({
			quantity: "1",
			discountAmount: 0,
			exciseAmount: 50,
			vatAmount: 126,
			amount: 1176,
			amountWithoutVat: 1050,
		});
	});
});
