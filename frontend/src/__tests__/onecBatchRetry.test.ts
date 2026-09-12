/**
 * «Задания»: что именно повторяет кнопка «Повторить неуспешные».
 *
 * ЖИВОЙ СЛУЧАЙ. В таблице две разных строки «с ошибками»: у одной есть база (за ней стоит
 * команда), у другой — нет (команду не нашли, её срок жизни истёк). Первая отмечается,
 * вторая нет, и это верно: над второй действовать нечем — повторять нечего, отменять
 * нечего. Но отметка первой НИЧЕГО не решала: повтор шёл «по заданию» и уходил во все
 * неуспешные базы разом. Переключатель срабатывал, а делал не то, что обещал.
 *
 * Теперь цель повтора — ровно отмеченные базы, и тест держит четыре границы этого правила.
 */
import { describe, it, expect } from "vitest";
import { retryTargets } from "src/models/OneCAdmin/BatchesTab";

const item = (commandId: string | null, baseKey: string | null, state: string) =>
	({ commandId, baseKey, state });

const batches = [
	{
		id: "b1",
		items: [
			item("c1", "alfa", "failed"),
			item("c2", "beta", "failed"),
			item("c3", "gamma", "done"),
			item("c4", "delta", "queued"),
		],
	},
	{
		id: "b2",
		items: [
			item("c5", "omega", "expired"),
			// Команда потеряна: базы нет, идентификатора нет — отмечать нечего.
			item(null, null, "expired"),
		],
	},
];

describe("Задания: цель повтора — отмеченные базы", () => {
	it("повторяются только отмеченные неуспешные базы своего задания", () => {
		expect(retryTargets(batches, new Set(["c1"]))).toEqual([{ batchId: "b1", baseKeys: ["alfa"] }]);
	});

	it("отметка в разных заданиях даёт по цели на каждое", () => {
		expect(retryTargets(batches, new Set(["c2", "c5"]))).toEqual([
			{ batchId: "b1", baseKeys: ["beta"] },
			{ batchId: "b2", baseKeys: ["omega"] },
		]);
	});

	it("успешные и ещё не начатые в повтор не попадают", () => {
		// «Выполнено» повторять незачем, «в очереди» — рано: её ещё только предстоит сделать.
		expect(retryTargets(batches, new Set(["c3", "c4"]))).toEqual([]);
	});

	it("строка без команды целью быть не может", () => {
		// Её нельзя отметить в таблице, но и случайно попасть в повтор она не должна:
		// повторять нечего — команды нет вовсе.
		expect(retryTargets(batches, new Set(["c1", "c5"])).flatMap((t) => t.baseKeys))
			.toEqual(["alfa", "omega"]);
		expect(retryTargets(batches, new Set())).toEqual([]);
	});
});
