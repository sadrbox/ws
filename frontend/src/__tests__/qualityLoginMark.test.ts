/**
 * Отметка прихода при входе (И24 аудита 26.09): вкладка, открытая с вечера, отмечает новый день;
 * день запоминается только после ответа сервера — упавший запрос не оставляет без отметки на весь день.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ markWorkDay: vi.fn(), fetchNotifications: vi.fn() }));
vi.mock("src/services/quality/api", () => api);
vi.mock("src/services/auth", () => ({ getCurrentUser: () => ({ uuid: "u-1" }) }));

import { markOnLoginOncePerDay, resetLoginMarkState } from "src/hooks/useQualityNotifications";

const flush = () => new Promise((r) => setTimeout(r, 0));
// 25.09 22:00 и 26.09 09:00 по Алматы (UTC+5 — пояс приложения по умолчанию).
const EVENING = Date.parse("2026-09-25T22:00:00+05:00");
const MORNING = Date.parse("2026-09-26T09:00:00+05:00");

describe("отметка прихода при входе", () => {
	beforeEach(() => {
		localStorage.clear();
		resetLoginMarkState();
		api.markWorkDay.mockReset();
	});
	afterEach(() => localStorage.clear());

	it("вкладка с вечера: утром отмечается новый день", async () => {
		api.markWorkDay.mockResolvedValue({ data: { success: true } });
		markOnLoginOncePerDay(EVENING);
		await flush();
		markOnLoginOncePerDay(EVENING + 60_000);
		await flush();
		expect(api.markWorkDay).toHaveBeenCalledTimes(1);
		markOnLoginOncePerDay(MORNING);
		await flush();
		expect(api.markWorkDay).toHaveBeenCalledTimes(2);
	});

	it("сбой сети — день не запомнен, повтор после паузы", async () => {
		api.markWorkDay.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue({ data: { success: true } });
		markOnLoginOncePerDay(MORNING);
		await flush();
		expect(api.markWorkDay).toHaveBeenCalledTimes(1);
		// Сразу — не повторяем (нет очереди запросов при лежащем сервере)…
		markOnLoginOncePerDay(Date.now());
		await flush();
		expect(api.markWorkDay).toHaveBeenCalledTimes(1);
		// …а через 5 минут — повторяем.
		markOnLoginOncePerDay(Date.now() + 5 * 60_000 + 1);
		await flush();
		expect(api.markWorkDay).toHaveBeenCalledTimes(2);
	});

	it("отказ по существу (4xx: фирма не назначена) — сегодня не повторяем", async () => {
		api.markWorkDay.mockRejectedValue({ response: { status: 400 } });
		markOnLoginOncePerDay(MORNING);
		await flush();
		markOnLoginOncePerDay(MORNING + 10 * 60_000);
		await flush();
		expect(api.markWorkDay).toHaveBeenCalledTimes(1);
	});
});
