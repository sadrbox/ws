/**
 * «Прервать» начатую команду (P3): что прервётся и почему нельзя.
 *
 * Держим правило, общее с сервисом: прерывается только начатое чтение у агента с
 * `agent.cancel` (`abortable`). Не начатое — отменяют до начала; у начатой строки, которую
 * прервать нельзя, итог объясняет почему, двумя разными ответами.
 */
import { describe, it, expect } from "vitest";
import { abortHint, abortTargets, itemOutcome, timingNote } from "src/models/OneCAdmin/BatchesTab";
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

describe("итог строки задания (П14)", () => {
	it("итог проверки с оговоркой, номер попытки и процесс после TIMEOUT", () => {
		const text = itemOutcome("IB_CHECK", {
			state: "done", outcome: "найдено ошибок: 3", error: null, warning: "найдены ошибки: 3 — нужна проверка с «Исправлять»",
			attempt: 2,
		});
		expect(text).toContain("найдено ошибок: 3 · найдены ошибки: 3");
		expect(text).toContain(`${translate("onecBatchAttempt")} 2`);
		const timeout = itemOutcome("IB_RESTORE", {
			state: "failed", outcome: null, error: { code: "TIMEOUT", message: "продолжают работу: 1cv8 1234" }, stillRunning: true,
		});
		expect(timeout).toBe(`TIMEOUT: продолжают работу: 1cv8 1234 · ${translate("onecStillRunning")}`);
		expect(itemOutcome("IB_BACKUP", { state: "done", outcome: null, error: null })).toBe("—");
	});
});

describe("С40: куда ушло время команды", () => {
	it("ожидание очереди и работа — раздельно; секунды не показываем", () => {
		expect(timingNote({ queuedSecs: 1100, runSecs: 128 })).toMatch(/18 .*·.*2 /);
		// Команда выдана сразу — про очередь говорить нечего.
		expect(timingNote({ queuedSecs: 3, runSecs: 240 })).not.toMatch(/·/);
		expect(timingNote({ queuedSecs: 2, runSecs: 4 })).toBe("");
		expect(timingNote({})).toBe("");
	});

	it("строка задания показывает ожидание рядом с итогом", () => {
		const text = itemOutcome("IB_INSTALL_EXTENSION", {
			state: "done", outcome: null, error: null, queuedSecs: 1100, runSecs: 90,
		});
		expect(text).toContain("18");
	});
});
