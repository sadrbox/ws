/**
 * «Прервать» начатую команду (P3): что прервётся и почему нельзя.
 *
 * Держим правило, общее с сервисом: прерывается только начатое чтение у агента с
 * `agent.cancel` (`abortable`). Не начатое — отменяют до начала; у начатой строки, которую
 * прервать нельзя, итог объясняет почему, двумя разными ответами.
 */
import { describe, it, expect } from "vitest";
import { abortHint, abortTargets } from "src/models/OneCAdmin/BatchesTab";
import { translate } from "src/i18";

const batch = (items: { commandId: string | null; state: string; abortable?: boolean }[]) => ({ items });

describe("прервать начатую команду", () => {
	it("прерывается только отмеченное начатое, которое сервис разрешает", () => {
		const items = [batch([
			{ commandId: "a", state: "dispatched", abortable: true },
			{ commandId: "b", state: "dispatched", abortable: false },
			{ commandId: "c", state: "queued", abortable: false },
			{ commandId: "d", state: "dispatched", abortable: true },
			{ commandId: null, state: "skipped" },
		])];
		expect(abortTargets(items, new Set(["a", "b", "c"]))).toEqual(["a"]);
		expect(abortTargets(items, new Set())).toEqual([]);
	});

	it("сервис старее панели (признака нет) — прерывать нечего", () => {
		expect(abortTargets([batch([{ commandId: "a", state: "dispatched" }])], new Set(["a"]))).toEqual([]);
	});

	it("почему нельзя: запись не обрывают, а чтение не прерывает старый агент", () => {
		expect(abortHint("IB_BACKUP", { state: "dispatched", abortable: false })).toBe(translate("onecAbortNotAllowed"));
		expect(abortHint("IB_UPDATE_USER", { state: "dispatched" })).toBe(translate("onecAbortNotAllowed"));
		expect(abortHint("IB_LIST_USERS", { state: "dispatched", abortable: false })).toBe(translate("onecAbortAgentOld"));
		// Проверку базы обрывают без «Исправлять» у нового агента — подсказка своя, не «запись не обрывают» (С23).
		expect(abortHint("IB_CHECK", { state: "dispatched", abortable: false })).toBe(translate("onecAbortCheckHint"));
	});

	it("подсказки нет, где вопроса нет: прервать можно или команда не начата", () => {
		expect(abortHint("IB_LIST_USERS", { state: "dispatched", abortable: true })).toBeNull();
		expect(abortHint("IB_BACKUP", { state: "queued" })).toBeNull();
		expect(abortHint("IB_BACKUP", { state: "done" })).toBeNull();
	});
});
