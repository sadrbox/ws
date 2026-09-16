/**
 * Итог успешной операции 1С: время по этапам (П28) и оговорка вместо чистого «Выполнено» (С41, П27).
 */
import { describe, expect, it } from "vitest";
import { stagesText } from "src/models/OneCAdmin/queueStats";
import { itemOutcome } from "src/models/OneCAdmin/BatchesTab";
import { finishOp, getOps, startOp } from "src/components/TechMessages/operations";

describe("П28: время по этапам", () => {
	it("этапы одной строкой, короче секунды — не показываем", () => {
		const text = stagesText([{ name: "вход в базу", ms: 192000 }, { name: "запись", ms: 41000 }, { name: "эхо", ms: 300 }]);
		expect(text).toMatch(/^вход в базу 3 .*; запись 41 /);
		expect(text).not.toContain("эхо");
		expect(stagesText(null)).toBe("");
	});

	it("строка задания: этапы у успеха, у отказа — нет (раскладка уже в тексте агента)", () => {
		const ok = itemOutcome("IB_INSTALL_EXTENSION", { state: "done", outcome: null, error: null, stages: [{ name: "вход в базу", ms: 65000 }] });
		expect(ok).toContain("вход в базу");
		const failed = itemOutcome("IB_INSTALL_EXTENSION", {
			state: "failed", outcome: null, error: { code: "IB_ERROR", message: "отказ" }, stages: [{ name: "вход в базу", ms: 65000 }],
		});
		expect(failed).not.toContain("вход в базу");
	});
});

describe("С41: операция закрывается с оговоркой", () => {
	it("warning в итоге операции, а состояние — «выполнено»", () => {
		const id = startOp({ kind: "update", title: "Запретить регламентные задания", target: "shahs", total: 1 });
		finishOp(id, { warning: "Кластер принял команду, но регламентные задания остались, как были" });
		const op = getOps().find((o) => o.id === id);
		expect(op?.state).toBe("done");
		expect(op?.warning).toMatch(/остались, как были/);
	});
});
