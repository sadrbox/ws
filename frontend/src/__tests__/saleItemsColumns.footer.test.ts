import { describe, it, expect } from "vitest";
import columns from "src/models/Sales/saleItemsColumns.json";

interface Col {
	identifier: string;
	footer?: string;
}

describe("saleItemsColumns: footer aggregates", () => {
	const byId = (id: string) =>
		(columns as Col[]).find((c) => c.identifier === id);

	it.each(["discountAmount", "vatAmount", "amount"])(
		"колонка %s имеет footer='sum'",
		(id) => {
			expect(byId(id)?.footer).toBe("sum");
		},
	);

	it("колонки product/price/discountPercent/quantity не имеют footer", () => {
		expect(byId("product.name")?.footer).toBeUndefined();
		expect(byId("price")?.footer).toBeUndefined();
		expect(byId("discountPercent")?.footer).toBeUndefined();
		expect(byId("quantity")?.footer).toBeUndefined();
	});
});
