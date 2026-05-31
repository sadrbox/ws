import { describe, it, expect } from "vitest";
import { docTypeLabel, docTypeToEndpoint } from "src/utils/accountingDocTypes";

describe("accountingDocTypes", () => {
	it("docTypeLabel возвращает русскую метку для известных типов", () => {
		expect(docTypeLabel("purchase")).toBe("Поступление товаров и услуг");
		expect(docTypeLabel("sale")).toBe("Реализация товаров и услуг");
		expect(docTypeLabel("payroll_payment")).toBe("Выплата зарплаты");
	});

	it("docTypeLabel возвращает сам тип для неизвестных", () => {
		expect(docTypeLabel("unknown_type")).toBe("unknown_type");
	});

	it("docTypeToEndpoint маппит тип проводки на frontend-endpoint", () => {
		expect(docTypeToEndpoint("sale")).toBe("sales");
		expect(docTypeToEndpoint("purchase")).toBe("purchases");
		expect(docTypeToEndpoint("sale_return")).toBe("sale-returns");
		expect(docTypeToEndpoint("purchase_return")).toBe("purchase-returns");
		expect(docTypeToEndpoint("cash_receipt_order")).toBe("cash-receipt-orders");
		expect(docTypeToEndpoint("cash_expense_order")).toBe("cash-expense-orders");
		expect(docTypeToEndpoint("payroll_calculation")).toBe("payroll-calculations");
		expect(docTypeToEndpoint("payroll_payment")).toBe("payroll-payments");
	});

	it("docTypeToEndpoint возвращает undefined для неизвестного типа", () => {
		expect(docTypeToEndpoint("nope")).toBeUndefined();
	});
});
