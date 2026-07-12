import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { docTypeLabel, docTypeToEndpoint, docTypeUsesPosted } from "src/utils/accountingDocTypes";

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

	// ── Страж: индикатор «Проведён» ⟺ форма реально проводится ────────────────
	//
	// docTypeUsesPosted управляет точкой-индикатором в дропдауне поля «Основание».
	// Список DOC_TYPES_WITHOUT_POSTING легко протухает: так «Резервирование» получило
	// проведение (регистр резервов движет только проведённый резерв), а в списке
	// осталось как «без проведения» — индикатор для него не рисовался.
	//
	// Источник истины — сама форма документа:
	//   проводится ⟺ колонка "posted" в columns.json И тоггл на форме
	//                (HeaderTogglePosted напрямую ИЛИ фабрика без hidePosted).
	it("docTypeUsesPosted совпадает с наличием проведения у формы документа", () => {
		const modelsDir = path.resolve(__dirname, "../models");
		const FACTORY = /createTradeDocForm|createInvoiceLikeForm|createCashOrderForm/;
		const mismatches: string[] = [];

		for (const dir of fs.readdirSync(modelsDir)) {
			const indexPath = path.join(modelsDir, dir, "index.tsx");
			const colsPath = path.join(modelsDir, dir, "columns.json");
			if (!fs.existsSync(indexPath) || !fs.existsSync(colsPath)) continue;

			const src = fs.readFileSync(indexPath, "utf-8");
			const docType = src.match(/docType:\s*"([a-z_]+)"/)?.[1];
			if (!docType) continue;

			const cols = JSON.parse(fs.readFileSync(colsPath, "utf-8")) as { identifier: string }[];
			const hasColumn = cols.some((c) => c.identifier === "posted");
			const hasToggle =
				src.includes("HeaderTogglePosted") ||
				(FACTORY.test(src) && !src.includes("hidePosted: true"));
			const formIsPostable = hasColumn && hasToggle;

			if (docTypeUsesPosted(docType) !== formIsPostable) {
				mismatches.push(
					`${docType} (${dir}): форма ${formIsPostable ? "проводится" : "НЕ проводится"}, ` +
					`а docTypeUsesPosted=${docTypeUsesPosted(docType)}`,
				);
			}
		}

		expect(mismatches, `Рассинхрон индикатора «Проведён»:\n${mismatches.join("\n")}`).toEqual([]);
	});
});
