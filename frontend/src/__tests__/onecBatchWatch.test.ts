/**
 * Слежение за заданиями 1С (И26 аудита 26.09): задание, которого нет в общем списке `/batches`
 * (другая организация, больше 20 новых), дочитывается по одному и не остаётся навсегда
 * «Выполняется»; пропавшее задание закрывается с пометкой, а не держит базы запертыми.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchProgress } from "src/services/onec/api";

const api = vi.hoisted(() => ({
	fetchBatches: vi.fn(),
	fetchBatch: vi.fn(),
}));

vi.mock("src/services/onec/api", async (orig) => {
	const real = await orig<typeof import("src/services/onec/api")>();
	return { ...real, fetchBatches: api.fetchBatches, fetchBatch: api.fetchBatch };
});

import { attachBatch, isBatchWatchActive, startBatchOp, startOp, BATCHES_KEY } from "src/models/OneCAdmin/progress";
import { getOps, resetOps } from "src/components/TechMessages/operations";
import { AiServiceError } from "src/services/ai/endpoint";
import { queryClient } from "src/app/queryClient";
import { translate } from "src/i18";

const batch = (id: string, over: Partial<BatchProgress> = {}): BatchProgress => ({
	id, type: "IB_LIST_USERS", total: 1, done: 1, failed: 0, pending: 0, cancelable: 0, createdAt: "2026-09-26T10:00:00Z",
	items: [], ...over,
});

describe("слежение за заданиями вне общего списка", () => {
	afterEach(() => {
		resetOps();
		api.fetchBatches.mockReset();
		api.fetchBatch.mockReset();
	});

	it("задание другой организации дочитывается по номеру и завершает операцию", async () => {
		api.fetchBatches.mockResolvedValue({ items: [batch("b-own")] });
		api.fetchBatch.mockResolvedValue(batch("b-other"));
		const id = startOp({ kind: "read", title: "Проверка", target: "", total: 1 });
		attachBatch(id, "b-other", 1);
		await vi.waitFor(() => expect(getOps().find((o) => o.id === id)?.state).toBe("done"));
		expect(api.fetchBatch).toHaveBeenCalledWith("b-other");
		// Опрос стих сам: незавершённых нет.
		await vi.waitFor(() => expect(isBatchWatchActive()).toBe(false));
		// Список лёг в общий кэш — вкладке «Задания» свой опрос не нужен.
		expect(queryClient.getQueryData(BATCHES_KEY)).toEqual({ items: [batch("b-own")] });
	});

	it("задания больше нет (404) — операция закрыта с пометкой, а не «Выполняется» навсегда", async () => {
		api.fetchBatches.mockResolvedValue({ items: [] });
		api.fetchBatch.mockRejectedValue(new AiServiceError("Задание не найдено", 404, "NOT_FOUND"));
		const id = startOp({ kind: "update", title: "Запись", target: "", total: 2 });
		attachBatch(id, "b-gone", 2);
		await vi.waitFor(() => expect(getOps().find((o) => o.id === id)?.state).toBe("failed"));
		expect(getOps().find((o) => o.id === id)?.note).toBe(translate("onecBatchLost"));
	});

	it("сбой сети по заданию — операция ждёт следующего тика, а не закрывается", async () => {
		api.fetchBatches.mockResolvedValue({ items: [] });
		api.fetchBatch.mockRejectedValue(new Error("Failed to fetch"));
		const id = startOp({ kind: "update", title: "Запись", target: "", total: 1 });
		attachBatch(id, "b-net", 1);
		await vi.waitFor(() => expect(api.fetchBatch).toHaveBeenCalled());
		expect(getOps().find((o) => o.id === id)?.state).toBe("running");
	});
});

describe("постановка задания под записью реестра (И26)", () => {
	afterEach(() => resetOps());

	it("отказ постановки закрывает запись: не вечное «Выполняется», базы не заперты", async () => {
		const err = new AiServiceError("Нет прав", 403, "FORBIDDEN");
		await expect(startBatchOp(
			{ kind: "update", title: "Выгрузка", target: "base1", total: 1, scope: { bases: ["base1"] } },
			() => Promise.reject(err),
		)).rejects.toBe(err);
		const op = getOps().find((o) => o.title === "Выгрузка");
		expect(op?.state).toBe("failed");
		expect(op?.note).toBe("Нет прав");
	});

	it("удачная постановка связывает запись с заданием", async () => {
		api.fetchBatches.mockResolvedValue({ items: [] });
		api.fetchBatch.mockReturnValue(new Promise(() => { }));
		const r = await startBatchOp(
			{ kind: "update", title: "Публикация", target: "base1", total: 1, scope: { bases: ["base1"] } },
			() => Promise.resolve({ batchId: "b-pub", total: 1, queued: 1, skipped: [] }),
		);
		expect(r.batchId).toBe("b-pub");
		expect(getOps().find((o) => o.title === "Публикация")?.batchId).toBe("b-pub");
	});
});
