import { describe, expect, it } from "vitest";
import {
	recalcSaleItemAmounts,
	withSaleItemRecalc,
	withSaleItemRecalcFromDiscountAmount,
} from "src/models/Sales/saleItemDraft";

describe("saleItemDraft", () => {
	it("recalculates discount, VAT included and total amount", () => {
		expect(recalcSaleItemAmounts("2", "100", "12", "10")).toEqual({
			discountAmount: 20,
			vatAmount: 19.29,
			amount: 180,
		});
	});

	it("returns zeros for empty values", () => {
		expect(recalcSaleItemAmounts("", "", "", "")).toEqual({
			discountAmount: 0,
			vatAmount: 0,
			amount: 0,
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
			vatAmount: 15.27,
			amount: 142.5,
		});
	});

	it("без НДС (vatRate=0): vatAmount=0", () => {
		expect(recalcSaleItemAmounts("2", "100", "0", "0")).toEqual({
			discountAmount: 0,
			vatAmount: 0,
			amount: 200,
		});
	});

	it("отрицательная сумма скидки приводится к 0", () => {
		const row = { quantity: "1", price: "100", vatRate: "0" };
		expect(withSaleItemRecalcFromDiscountAmount(row, "-10")).toEqual({
			discountAmount: 0,
			discountPercent: 0,
			vatAmount: 0,
			amount: 100,
		});
	});

	it("сумма скидки не превышает базы", () => {
		const row = { quantity: "1", price: "100", vatRate: "0" };
		expect(withSaleItemRecalcFromDiscountAmount(row, "500")).toEqual({
			discountAmount: 100,
			discountPercent: 100,
			vatAmount: 0,
			amount: 0,
		});
	});

	it("принимает числовые значения, а не только строки", () => {
		expect(recalcSaleItemAmounts(2, 50, 0, 10)).toEqual({
			discountAmount: 10,
			vatAmount: 0,
			amount: 90,
		});
	});
});
