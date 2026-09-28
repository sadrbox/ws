/**
 * Регрессия аудита критических ошибок 27.09, КР-8 (фронтенд): сообщение о нехватке различает
 * нехватку под резерв («с учётом резерва N») и снятый приход — как сервер (formatShortageMessage);
 * предпроверка перемещения передаёт склад-получатель.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: { get: vi.fn(), post: vi.fn() } }));
vi.mock("src/services/api/client", () => ({ __esModule: true, api: apiMock, default: {} }));

import { formatStockShortages, checkStockAvailability, type StockShortage } from "src/utils/stockControl";
import { getFormatDateOnly } from "src/utils/datetime";

const base: StockShortage = {
	productUuid: "p1", productName: "Чай", warehouseUuid: "wh", warehouseName: "Склад",
	requested: 4, available: 3, deficit: 1,
};

beforeEach(() => { apiMock.get.mockReset(); apiMock.post.mockReset(); });

describe("formatStockShortages (КР-8)", () => {
	it("нехватка под резерв — «с учётом резерва N»", () => {
		const text = formatStockShortages([{ ...base, requested: 4, available: 3, reserved: 100, deficit: 1 }]);
		expect(text).toContain("• Чай — нужно 4, доступно 3 с учётом резерва 100, не хватает 1");
	});

	it("физическая нехватка — прежний текст", () => {
		expect(formatStockShortages([base])).toBe("Недостаточно остатка для проведения:\n• Чай — нужно 4, доступно 3, не хватает 1");
	});

	it("снятый приход — «без этого прихода остаток на дату станет отрицательным»", () => {
		const text = formatStockShortages([{ ...base, kind: "inflow", date: "2026-08-20", deficit: 3 }]);
		expect(text).toContain(`• Чай — без этого прихода остаток на ${getFormatDateOnly("2026-08-20")} станет отрицательным, не хватит 3`);
	});

	it("снятый приход под резерв — «остатка не хватит под резерв N»", () => {
		const text = formatStockShortages([{ ...base, kind: "inflow", reserved: 5, deficit: 2 }]);
		expect(text).toContain("• Чай — без этого прихода остатка не хватит под резерв 5, не хватит 2");
	});
});

describe("предпроверка перемещения (КР-8)", () => {
	it("склад-получатель уходит в запрос check-availability", async () => {
		apiMock.post.mockResolvedValue({ success: true, ok: true, shortages: [] });
		await checkStockAvailability({
			documentType: "inventory_transfer", fromWarehouseUuid: "wh-from", toWarehouseUuid: "wh-to",
			items: [{ productUuid: "p1", quantity: 2 }],
		});
		expect(apiMock.post).toHaveBeenCalledWith("/product-register/check-availability", expect.objectContaining({
			fromWarehouseUuid: "wh-from", toWarehouseUuid: "wh-to",
		}));
	});
});
