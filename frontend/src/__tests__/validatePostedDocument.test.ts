import { describe, expect, it } from "vitest";
import {
	validatePostedDocument,
	getRequiredFieldsForDocType,
} from "src/utils/validatePostedDocument";

describe("validatePostedDocument", () => {
	it("returns valid for purchase when required fields are filled", () => {
		const result = validatePostedDocument(
			"purchase",
			{
				date: "2026-01-01",
				organizationUuid: "org-1",
				counterpartyUuid: "cpty-1",
				warehouseUuid: "wh-1",
				posted: true,
			},
			true,
		);

		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("returns error when required field is missing for posted purchase", () => {
		const result = validatePostedDocument(
			"purchase",
			{
				date: "2026-01-01",
				organizationUuid: "",
				counterpartyUuid: "cpty-1",
				warehouseUuid: "wh-1",
				posted: true,
			},
			true,
		);

		expect(result.isValid).toBe(false);
		expect(result.errors).toEqual([
			expect.objectContaining({ field: "organizationUuid" }),
		]);
	});

	it("allows saving a draft (posted=false) with empty required fields", () => {
		// Политика: черновик (Проведён не установлен) можно сохранять с
		// незаполненными полями — обязательные поля проверяются только при posted.
		const result = validatePostedDocument(
			"purchase",
			{
				date: "",
				organizationUuid: "",
				counterpartyUuid: "",
				warehouseUuid: "",
				posted: false,
			},
			false,
		);

		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("returns required fields list for sale document type", () => {
		const required = getRequiredFieldsForDocType("sale");

		expect(required).toContain("date");
		expect(required).toContain("organizationUuid");
		expect(required).toContain("counterpartyUuid");
		expect(required).toContain("warehouseUuid");
	});
});
