/**
 * Последовательность событий: у законченной работы остаётся след.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09). На экране одновременно: запись операции «Изменить пользователя —
 * 1/1 — Выполнено — 15 с» и сообщение «идёт операция, дождитесь окончания». Противоречие
 * возникало из двух половин одной поломки: состояние формы держалось дольше, чем работа,
 * а от самой работы в сообщениях не оставалось НИЧЕГО — «Прогресс» и «Технические
 * сообщения» рассказывали разные истории.
 *
 * Состояние снимает сам источник (см. store: замолчал — записи нет), а окончание операции
 * пишется СОБЫТИЕМ: что делали, чем кончилось и сколько заняло.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { finishOp, startOp } from "src/models/OneCAdmin/progress";
import { APP_SCOPE, clearNoticeHistory, getMessages } from "src/components/TechMessages/store";
import { translate } from "src/i18";

describe("итог операции попадает в журнал", () => {
	beforeEach(() => { getMessages().length = 0; clearNoticeHistory(APP_SCOPE); });

	it("успешная операция оставляет событие с названием и объектом", () => {
		const id = startOp({ kind: "update", title: "Изменить пользователя", target: "Оператор — _transition", total: 1 });
		finishOp(id);

		const [m] = getMessages();
		expect(m.source).toBe("Изменить пользователя — Оператор — _transition");
		expect(m.type).toBe("success");
		expect(m.text).toContain(translate("onecOpFinishedOk"));
		// Событие, а не состояние: оно случилось и остаётся, пока его не уберут.
		expect(m.active).toBe(false);
		expect(m.fromSource).toBeUndefined();
	});

	it("операция с отказами записывается ошибкой и называет их число", () => {
		const id = startOp({ kind: "update", title: "Изменить пользователя", target: "базы: 10", total: 10 });
		finishOp(id, { failed: 3, note: "akacapital: нет доступа" });

		const [m] = getMessages();
		expect(m.type).toBe("error");
		expect(m.text).toContain(translate("onecOpFinishedFailed"));
		expect(m.text).toContain("3");
		// Подробность из операции переносится в запись: в «Прогрессе» её видно одной строкой,
		// а в журнале она переживёт очистку списка операций.
		expect(m.text).toContain("akacapital");
	});
});
