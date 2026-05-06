import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Структурная проверка: при выборе товара в Sales* должны проставляться
 * unitOfMeasureUuid и имя единицы измерения из item (карточки товара).
 */
const FORM = readFileSync(
	resolve(__dirname, "../models/Sales/SaleItemsForm.tsx"),
	"utf-8",
);
const TABLE = readFileSync(
	resolve(__dirname, "../models/Sales/SaleItemsTable.tsx"),
	"utf-8",
);

describe("SaleItems: product → unitOfMeasure auto-fill", () => {
	it("SaleItemsForm: onSelect товара читает unitOfMeasureUuid и unitOfMeasure.shortName", () => {
		expect(FORM).toMatch(/item\?\.unitOfMeasureUuid/);
		expect(FORM).toMatch(/item\?\.unitOfMeasure\?\.shortName/);
		// убеждаемся что setFields получает unitOfMeasureUuid
		expect(FORM).toMatch(/upd\.unitOfMeasureUuid\s*=/);
		expect(FORM).toMatch(/upd\.unitOfMeasureName\s*=/);
	});

	it("SaleItemsTable: inline onSelect товара передаёт unitOfMeasureUuid в extra-patch", () => {
		expect(TABLE).toMatch(/item\?\.unitOfMeasureUuid/);
		expect(TABLE).toMatch(/extra\.unitOfMeasureUuid\s*=/);
		expect(TABLE).toMatch(/extra\.unitOfMeasure\s*=/);
	});
});
