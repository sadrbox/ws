/**
 * Итог постановки заданий (И26 аудита 26.09): «queued: 0» — не успех, ввод не стирается.
 */
import { describe, expect, it } from "vitest";
import { nothingQueued, sumBatchStarts } from "src/models/OneCAdmin/batchStart";

describe("итог постановки заданий", () => {
	it("агент не на связи: 202 и queued 0 — ничего не встало", () => {
		const r = { batchId: "b1", total: 1, queued: 0, skipped: [{ baseKey: "base1", reason: "Нет агента на связи" }] };
		expect(nothingQueued(r)).toBe(true);
	});

	it("несколько постановок складываются в один итог", () => {
		const sum = sumBatchStarts([
			{ batchId: "b1", total: 2, queued: 2, skipped: [] },
			{ batchId: "b2", total: 1, queued: 0, skipped: [{ baseKey: "base3", reason: "Нет агента" }] },
		]);
		expect(sum).toEqual({ batchId: "", total: 3, queued: 2, skipped: [{ baseKey: "base3", reason: "Нет агента" }] });
		expect(nothingQueued(sum)).toBe(false);
	});

	it("одна постановка сохраняет свой номер задания", () => {
		expect(sumBatchStarts([{ batchId: "b1", total: 1, queued: 1, skipped: [] }]).batchId).toBe("b1");
	});
});
