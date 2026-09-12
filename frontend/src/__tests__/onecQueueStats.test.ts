/**
 * «Сколько ждать» и «чего ждёт очередь».
 *
 * Человек запускал проверку ста десяти баз и видел счётчик «сделано 7 из 110»: из него не
 * следует, сорок это минут или три. А команда «в очереди» выглядела так же, как
 * выполняющаяся — не отличить «агент занят» от «агента нет», хотя чинится это по-разному.
 *
 * Оценка строится на ИЗМЕРЕННОМ (сервис считает среднее по типу команд за неделю), и там,
 * где замеров нет, тест требует молчания: округлое выдуманное число человек примет за правду.
 */
import { describe, it, expect } from "vitest";
import { estimateSecs, formatDuration, queueReason } from "src/models/OneCAdmin/queueStats";
import type { OnecQueueStats } from "src/services/onec/api";
import { translate } from "src/i18";

const stats = (over: Partial<OnecQueueStats> = {}): OnecQueueStats => ({
	types: [
		{ type: "IB_LIST_USERS", avgSecs: 19, samples: 93 },
		{ type: "IB_LIST_EXTENSIONS", avgSecs: 34, samples: 20 },
		// Тип, который видели дважды: среднее по двум замерам — это не среднее.
		{ type: "IB_BACKUP", avgSecs: 900, samples: 2 },
	],
	queued: 0, running: 0, oldestQueuedSecs: 0,
	agentsOnline: 1, agentsBusy: 0, ibParallel: 1,
	...over,
});

describe("оценка времени массовой операции", () => {
	it("считает по измеренной длительности типа и числу баз", () => {
		// 110 баз × 19 с ÷ 1 = 2090 с — ровно то, что происходит на живом сервере.
		expect(estimateSecs(stats(), "IB_LIST_USERS", 110)).toBe(2090);
	});

	it("делит на параллельность: четыре команды разом — вчетверо быстрее", () => {
		expect(estimateSecs(stats({ ibParallel: 4 }), "IB_LIST_USERS", 110)).toBe(523);
	});

	it("молчит там, где замеров почти нет", () => {
		// Два замера — не статистика; выдуманное число человек примет за обещание.
		expect(estimateSecs(stats(), "IB_BACKUP", 10)).toBe(0);
		expect(estimateSecs(stats(), "IB_PUBLISH", 10)).toBe(0);
		expect(estimateSecs(undefined, "IB_LIST_USERS", 10)).toBe(0);
	});

	it("длительность словами: секунды, минуты, часы", () => {
		expect(formatDuration(0)).toBe("");
		expect(formatDuration(45)).toBe(`45 ${translate("secShort")}`);
		expect(formatDuration(2090)).toBe(`35 ${translate("minShort")}`);
		expect(formatDuration(3600)).toBe(`1 ${translate("hourShort")}`);
		expect(formatDuration(4500)).toBe(`1 ${translate("hourShort")} 15 ${translate("minShort")}`);
	});
});

describe("чего ждёт очередь", () => {
	it("пустая очередь молчит", () => {
		expect(queueReason(stats())).toBe("");
	});

	it("некому забрать — это про связь, а не про терпение", () => {
		expect(queueReason(stats({ queued: 5, agentsOnline: 0 })))
			.toBe(translate("onecQueueNoAgent"));
	});

	it("агент занят другой базой — ждать, а не чинить", () => {
		expect(queueReason(stats({ queued: 5, agentsBusy: 1 })))
			.toBe(translate("onecQueueAgentBusy"));
	});

	it("работа идёт — очередь пуста, но команда выполняется", () => {
		expect(queueReason(stats({ running: 1 }))).toBe(translate("onecQueueRunning"));
	});
});
