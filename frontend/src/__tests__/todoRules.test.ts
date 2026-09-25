import { describe, it, expect } from "vitest";
import { translate } from "src/i18";
import {
	CANCEL_CODES, MIN_RESULT_LENGTH, eventDetails, eventLabel, historyRows, isKindLocked, kindLabel, kindOptions,
	needsResult, priorityOptions, reactionOverdue, resultError, statusOptions, todoActions, todoFormError,
	transitionError, watcherViews, type StatusLike,
} from "src/models/Todos/todoRules";
import type { TodoEventRow } from "src/services/quality/api";

// Справочник как на сервере после миграции E17: два статуса ожидания рядом с обычными.
const STATUSES: StatusLike[] = [
	{ code: "new", name: "Новая", isFinal: false },
	{ code: "in_progress", name: "В работе", isFinal: false },
	{ code: "waiting_client", name: "Ждём клиента", isFinal: false, isWaiting: true },
	{ code: "waiting_counterparty", name: "Ждём контрагента", isFinal: false, isWaiting: true },
	{ code: "done", name: "Выполнена", isFinal: true },
	{ code: "cancelled", name: "Отменена", isFinal: true },
];

const GOOD_RESULT = "Сверка подписана, расхождение 1 200 ₸ отражено в учёте";

describe("resultError — результат задачи (п. 1 стандарта)", () => {
	it("пустой результат — «нужен результат»", () => {
		expect(resultError("")).toBe(translate("todoResultRequired"));
		expect(resultError("   ")).toBe(translate("todoResultRequired"));
		expect(resultError(null)).toBe(translate("todoResultRequired"));
	});
	it("«написала/позвонила/передала…» — не результат, и с точкой в конце тоже", () => {
		for (const t of ["написала", "Позвонил", "передали.", "не ответили!", "программа не работает", "готово", "ок", "+"]) {
			expect(resultError(t), t).toBe(translate("todoResultFormal"));
		}
	});
	it("короче минимума — «слишком короткий» с числом знаков", () => {
		expect(resultError("Акт готов")).toBe(translate("todoResultTooShort").replace("{n}", String(MIN_RESULT_LENGTH)));
	});
	it("содержательный результат проходит", () => {
		expect(resultError(GOOD_RESULT)).toBeNull();
		// Формальное слово ВНУТРИ содержательного текста — не повод отказать.
		expect(resultError("Позвонила клиенту, договорились о сверке 30.09 — акт отправлен")).toBeNull();
	});
});

describe("transitionError — переход статуса, как на сервере", () => {
	it("финальный статус без результата — отказ, с результатом — можно", () => {
		expect(transitionError({ nextStatus: "done", statuses: STATUSES, result: "" })).toBe(translate("todoResultRequired"));
		expect(transitionError({ nextStatus: "done", statuses: STATUSES, result: GOOD_RESULT })).toBeNull();
	});
	it("отмене результат не нужен", () => {
		expect(CANCEL_CODES.has("cancelled")).toBe(true);
		expect(transitionError({ nextStatus: "cancelled", statuses: STATUSES, result: "" })).toBeNull();
	});
	it("ожидание без даты следующего контроля — отказ, с датой — можно", () => {
		expect(transitionError({ nextStatus: "waiting_client", statuses: STATUSES, nextControlAt: "" })).toBe(translate("todoNextControlRequired"));
		expect(transitionError({ nextStatus: "waiting_counterparty", statuses: STATUSES, nextControlAt: "2026-10-01" })).toBeNull();
	});
	it("обычный статус и код вне справочника — без условий", () => {
		expect(transitionError({ nextStatus: "in_progress", statuses: STATUSES })).toBeNull();
		expect(transitionError({ nextStatus: "archived", statuses: STATUSES })).toBeNull();
	});
	it("needsResult: финальный, но не отмена", () => {
		expect(needsResult(STATUSES, "done")).toBe(true);
		expect(needsResult(STATUSES, "cancelled")).toBe(false);
		expect(needsResult(STATUSES, "waiting_client")).toBe(false);
	});
});

describe("todoFormError — проверка формы перед записью (buildPayload)", () => {
	const base = { statuses: STATUSES, result: "", nextControlAt: "" };
	it("новая задача сразу «Выполнена» — нужен результат", () => {
		expect(todoFormError({ ...base, isEdit: false, status: "done", loadedStatus: "" })).toBe(translate("todoResultRequired"));
	});
	it("закрытие существующей задачи — нужен результат", () => {
		expect(todoFormError({ ...base, isEdit: true, status: "done", loadedStatus: "in_progress" })).toBe(translate("todoResultRequired"));
		expect(todoFormError({ ...base, isEdit: true, status: "done", loadedStatus: "in_progress", result: GOOD_RESULT })).toBeNull();
	});
	it("правка УЖЕ закрытой задачи без смены статуса не блокируется результатом задним числом", () => {
		expect(todoFormError({ ...base, isEdit: true, status: "done", loadedStatus: "done" })).toBeNull();
	});
	it("перевод в ожидание — нужна дата контроля; оставаться в ожидании без даты тоже нельзя", () => {
		expect(todoFormError({ ...base, isEdit: true, status: "waiting_client", loadedStatus: "in_progress" })).toBe(translate("todoNextControlRequired"));
		expect(todoFormError({ ...base, isEdit: true, status: "waiting_client", loadedStatus: "waiting_client" })).toBe(translate("todoNextControlRequired"));
		expect(todoFormError({ ...base, isEdit: true, status: "waiting_client", loadedStatus: "in_progress", nextControlAt: "2026-10-01" })).toBeNull();
	});
});

describe("todoActions — какие действия предлагать", () => {
	const saved = { isSaved: true, statuses: STATUSES, acceptedAt: "" };
	it("новая (несохранённая) задача — никаких действий", () => {
		const a = todoActions({ ...saved, isSaved: false, kind: "client_request", status: "new" });
		expect(Object.values(a).some(Boolean)).toBe(false);
	});
	it("непринятое обращение клиента — «Принять в работу», напоминание и помощь", () => {
		const a = todoActions({ ...saved, kind: "client_request", status: "new" });
		expect(a).toMatchObject({ accept: true, remind: true, help: true, returnBack: false, rate: true });
	});
	it("принятое обращение и обычная задача — без «Принять»", () => {
		expect(todoActions({ ...saved, kind: "client_request", status: "in_progress", acceptedAt: "2026-09-25T05:00:00Z" }).accept).toBe(false);
		expect(todoActions({ ...saved, kind: "task", status: "new" }).accept).toBe(false);
	});
	it("закрытая задача — только «Вернуть: не выполнено» и оценка", () => {
		const a = todoActions({ ...saved, kind: "client_request", status: "done" });
		expect(a).toEqual({ accept: false, remind: false, returnBack: true, help: false, rate: true });
	});
});

describe("reactionOverdue — обращение не принято к сроку реакции (п. 3)", () => {
	const finals = new Set(["done", "cancelled"]);
	const now = Date.parse("2026-09-25T10:00:00Z");
	const req = { kind: "client_request", status: "new", acceptedAt: null, reactionDueAt: "2026-09-25T09:00:00Z" };
	it("срок прошёл, не принято — просрочено", () => {
		expect(reactionOverdue(req, finals, now)).toBe(true);
	});
	it("принято, закрыто, срок впереди, не обращение — не просрочено", () => {
		expect(reactionOverdue({ ...req, acceptedAt: "2026-09-25T09:30:00Z" }, finals, now)).toBe(false);
		expect(reactionOverdue({ ...req, status: "done" }, finals, now)).toBe(false);
		expect(reactionOverdue({ ...req, reactionDueAt: "2026-09-25T11:00:00Z" }, finals, now)).toBe(false);
		expect(reactionOverdue({ ...req, kind: "task" }, finals, now)).toBe(false);
		expect(reactionOverdue({ ...req, reactionDueAt: null }, finals, now)).toBe(false);
	});
});

describe("подписи и варианты выбора", () => {
	it("вид и событие — по словарю, неизвестный код — как есть", () => {
		expect(kindLabel("client_request")).toBe(translate("todoKindClientRequest"));
		expect(kindLabel("mystery")).toBe("mystery");
		expect(kindLabel(null)).toBe("");
		expect(eventLabel("transfer")).toBe(translate("todoEventTransfer"));
		expect(eventLabel("new_event")).toBe("new_event");
	});
	it("сводную задачу по находкам вручную не заводят, но свою — показывают и не дают сменить вид", () => {
		expect(kindOptions("task").map((o) => o.value)).not.toContain("check_finding");
		expect(kindOptions("check_finding").map((o) => o.value)).toContain("check_finding");
		expect(isKindLocked("check_finding")).toBe(true);
		expect(isKindLocked("error")).toBe(false);
	});
	it("код вне справочника остаётся в списке: select не подменяет его первым вариантом", () => {
		expect(kindOptions("legacy").map((o) => o.value)).toContain("legacy");
		expect(priorityOptions("legacy").map((o) => o.value)).toContain("legacy");
		expect(statusOptions(STATUSES, "archived").at(-1)).toEqual({ value: "archived", label: "archived" });
		expect(statusOptions(STATUSES, "done")).toHaveLength(STATUSES.length);
	});
});

describe("история задачи", () => {
	const statusName = (code: string) => STATUSES.find((s) => s.code === code)?.name ?? code;
	const ev = (over: Partial<TodoEventRow>): TodoEventRow => ({
		uuid: "e", type: "created", actorName: null, fromUserName: null, toUserName: null, channel: "erp", note: null, payload: null,
		createdAt: "2026-09-25T05:00:00.000Z", ...over,
	});

	it("передача — «от кого → кому», статус — «было → стало» подписями справочника", () => {
		expect(eventDetails(ev({ type: "transfer", fromUserName: "Иванова", toUserName: "Петрова" }), statusName)).toBe("Иванова → Петрова");
		expect(eventDetails(ev({ type: "transfer", toUserName: "Петрова" }), statusName)).toBe("— → Петрова");
		expect(eventDetails(ev({ type: "status", payload: { from: "in_progress", to: "done" } }), statusName)).toBe("В работе → Выполнена");
	});
	it("оценка и эскалация — словами", () => {
		expect(eventDetails(ev({ type: "rating", payload: { rating: 4 } }), statusName)).toBe(translate("todoRatingValue").replace("{n}", "4"));
		expect(eventDetails(ev({ type: "escalation", payload: { level: 1 } }), statusName)).toBe(translate("todoEscalationChief"));
		expect(eventDetails(ev({ type: "escalation", payload: { level: 2 } }), statusName)).toBe(translate("todoEscalationManager"));
		expect(eventDetails(ev({ type: "help" }), statusName)).toBe("");
	});
	it("строки журнала: новые сверху, у системного события автор «Система», текст события — в комментарии", () => {
		const rows = historyRows([
			ev({ uuid: "1", type: "created", actorName: "Иванова", createdAt: "2026-09-24T05:00:00.000Z" }),
			ev({ uuid: "2", type: "escalation", channel: "system", payload: { level: 1 }, createdAt: "2026-09-25T05:00:00.000Z" }),
			ev({ uuid: "3", type: "returned", actorName: "Главбух", note: "Акт сверки не подписан", createdAt: "2026-09-24T12:00:00.000Z" }),
		], statusName);
		expect(rows.map((r) => r.uuid)).toEqual(["2", "3", "1"]);
		expect(rows[0].todoEventActor).toBe(translate("todoChannelSystem"));
		expect(rows[1]).toMatchObject({ todoEventType: translate("todoEventReturned"), todoEventActor: "Главбух", comment: "Акт сверки не подписан" });
		expect(rows[2].todoEventAt).toBe("2026-09-24T05:00:00.000Z");
	});
	it("наблюдатели: имя (или uuid, если имени нет) и причина", () => {
		const w = watcherViews([
			{ uuid: "w1", userUuid: "u1", userName: "Иванова", reason: "transfer", createdAt: "2026-09-25T05:00:00Z" },
			{ uuid: "w2", userUuid: "u2", userName: "", reason: "manual", createdAt: "2026-09-25T06:00:00Z" },
		]);
		expect(w[0]).toMatchObject({ name: "Иванова", reason: translate("todoWatcherTransfer") });
		expect(w[1].name).toBe("u2");
	});
});
