import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Структурная проверка: при выборе товара в TradeDocumentItemsTable должны
 * проставляться unitOfMeasureUuid и имя единицы измерения из item (карточки товара).
 */
const TABLE = readFileSync(
	resolve(__dirname, "../components/DocumentItemsTable/TradeDocumentItemsTable.tsx"),
	"utf-8",
);

describe("SaleItems: product → unitOfMeasure auto-fill", () => {
	it("TradeDocumentItemsTable: inline onSelect товара передаёт unitOfMeasureUuid в extra-patch", () => {
		expect(TABLE).toMatch(/item\?\.unitOfMeasureUuid/);
		expect(TABLE).toMatch(/extra\.unitOfMeasureUuid\s*=/);
		expect(TABLE).toMatch(/extra\.unitOfMeasure\s*=/);
	});
});
