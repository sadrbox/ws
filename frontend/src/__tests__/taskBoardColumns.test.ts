import { describe, it, expect } from "vitest";
import { translate } from "src/i18";
import { boardColumns, cardBadges, cardTitle, groupByColumn, moveError } from "src/models/TaskBoard/board";

const STATUSES = [
	{ code: "new", name: "Новая", isFinal: false },
	{ code: "in_progress", name: "В работе", isFinal: false },
	{ code: "waiting_client", name: "Ждём клиента", isFinal: false, isWaiting: true },
	{ code: "done", name: "Выполнена", isFinal: true },
	{ code: "cancelled", name: "Отменена", isFinal: true },
];
const FINALS = new Set(["done", "cancelled"]);

describe("доска — колонки и раскладка", () => {
	it("колонки справочника по порядку; задача со статусом вне справочника получает свою колонку", () => {
		const todos = [
			{ uuid: "a", status: "new" },
			{ uuid: "b", status: "archived" },
			{ uuid: "c", status: "done" },
			{ uuid: "d", status: "archived" },
			{ uuid: "e", status: "from_1c" },
		];
		const cols = boardColumns(STATUSES, todos);
		expect(cols.map((c) => c.code)).toEqual(["new", "in_progress", "waiting_client", "done", "cancelled", "archived", "from_1c"]);
		const unknown = cols.find((c) => c.code === "archived")!;
		expect(unknown.known).toBe(false);
		expect(unknown.label).toBe(`archived · ${translate("taskStatusUnknown")}`);
		expect(cols.find((c) => c.code === "waiting_client")).toMatchObject({ known: true, isWaiting: true, isFinal: false });
		expect(cols.find((c) => c.code === "done")).toMatchObject({ known: true, isFinal: true });
	});

	it("каждая задача — ровно в одной колонке, ни одна не пропадает", () => {
		const todos = [
			{ uuid: "a", status: "new" },
			{ uuid: "b", status: "archived" },
			{ uuid: "c", status: "" },
		];
		const cols = boardColumns(STATUSES, todos);
		const grouped = groupByColumn(todos, cols);
		const placed = cols.flatMap((c) => grouped[c.code] ?? []);
		expect(placed.map((t) => t.uuid).sort()).toEqual(["a", "b", "c"]);
		// Пустой статус — тоже своя колонка, со своей подписью.
		expect(cols.find((c) => c.code === "")?.label).toBe(translate("taskStatusEmpty"));
	});

	it("без задач вне справочника лишних колонок нет", () => {
		expect(boardColumns(STATUSES, [{ status: "new" }, { status: "done" }])).toHaveLength(STATUSES.length);
	});
});

describe("доска — значки карточки", () => {
	const now = Date.parse("2026-09-25T10:00:00Z");
	it("обычная задача без сигналов — без значков", () => {
		expect(cardBadges({ kind: "task", status: "new" }, FINALS, now)).toEqual([]);
		expect(cardBadges({ kind: "regulation", status: "new" }, FINALS, now)).toEqual([]);
	});
	it("вид: обращение, ошибка, поручение, находки проверки", () => {
		for (const kind of ["client_request", "error", "manager_order", "check_finding"]) {
			const b = cardBadges({ kind, status: "in_progress", acceptedAt: "2026-09-25T09:00:00Z" }, FINALS, now);
			expect(b.map((x) => x.id), kind).toEqual(["kind"]);
		}
	});
	it("непринятое обращение после срока реакции — «SLA»; принятое или закрытое — нет", () => {
		const req = { kind: "client_request", status: "new", acceptedAt: null, reactionDueAt: "2026-09-25T09:00:00Z" };
		expect(cardBadges(req, FINALS, now).map((b) => b.id)).toEqual(["kind", "sla"]);
		expect(cardBadges({ ...req, acceptedAt: "2026-09-25T09:30:00Z" }, FINALS, now).map((b) => b.id)).toEqual(["kind"]);
		expect(cardBadges({ ...req, status: "done" }, FINALS, now).map((b) => b.id)).toEqual(["kind"]);
	});
	it("напоминания — с числом, «помощь» — если просили", () => {
		const b = cardBadges({ kind: "task", status: "in_progress", reminderCount: 2, helpRequestedAt: "2026-09-25T08:00:00Z" }, FINALS, now);
		expect(b.map((x) => x.id)).toEqual(["reminders", "help"]);
		expect(b[0].label).toBe(translate("taskBadgeReminders").replace("{n}", "2"));
		expect(b[0].tone).toBe("warning");
		expect(cardBadges({ kind: "task", status: "new", reminderCount: 0 }, FINALS, now)).toEqual([]);
	});
});

describe("доска — перенос карточки", () => {
	it("в «Выполнена» без результата — нельзя (та же причина, что у сервера), с результатом — можно", () => {
		expect(moveError({ result: null }, "done", STATUSES)).toBe(translate("todoResultRequired"));
		expect(moveError({ result: "Сверка подписана, расхождений нет" }, "done", STATUSES)).toBeNull();
	});
	it("в ожидание без даты контроля — нельзя; в отмену и в работу — можно", () => {
		expect(moveError({ nextControlAt: null }, "waiting_client", STATUSES)).toBe(translate("todoNextControlRequired"));
		expect(moveError({ nextControlAt: "2026-10-01T00:00:00.000Z" }, "waiting_client", STATUSES)).toBeNull();
		expect(moveError({}, "cancelled", STATUSES)).toBeNull();
		expect(moveError({}, "in_progress", STATUSES)).toBeNull();
	});
	it("заголовок карточки: описание, иначе название, иначе номер", () => {
		expect(cardTitle({ id: 7, description: "  Сверка с поставщиком ", name: "Сверка" })).toBe("Сверка с поставщиком");
		expect(cardTitle({ id: 7, description: null, name: "Регламент: банк" })).toBe("Регламент: банк");
		expect(cardTitle({ id: 7 })).toBe("#7");
	});
});
