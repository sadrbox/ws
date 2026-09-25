// E17 «Качество»: месяц бонуса, подстановка в шаблон, имя сотрудника из лукапа.
import { describe, it, expect } from "vitest";
import { addMonths, currentMonth, isMonth, localYmd, monthLabel, recentMonths } from "src/models/_quality/month";
import { escapeHtml, fillTemplate } from "src/models/_quality/text";
import { userDisplayName } from "src/models/_quality/people";

describe("месяц бонуса «ГГГГ-ММ»", () => {
	it("isMonth: только корректный месяц", () => {
		expect(isMonth("2026-09")).toBe(true);
		expect(isMonth("2026-12")).toBe(true);
		expect(isMonth("2026-13")).toBe(false);
		expect(isMonth("2026-00")).toBe(false);
		expect(isMonth("2026-9")).toBe(false);
		expect(isMonth(null)).toBe(false);
		expect(isMonth(202609)).toBe(false);
	});

	it("addMonths: через границу года в обе стороны", () => {
		expect(addMonths("2026-09", 1)).toBe("2026-10");
		expect(addMonths("2026-12", 1)).toBe("2027-01");
		expect(addMonths("2026-01", -1)).toBe("2025-12");
		expect(addMonths("2026-03", -14)).toBe("2025-01");
		expect(addMonths("2026-09", 0)).toBe("2026-09");
	});

	it("currentMonth и localYmd считают по местному смещению, а не по UTC", () => {
		// 31.08.2026 20:00 UTC — в Казахстане (UTC+5) уже 1 сентября.
		const t = Date.UTC(2026, 7, 31, 20, 0);
		expect(currentMonth(0, t)).toBe("2026-08");
		expect(currentMonth(300, t)).toBe("2026-09");
		expect(localYmd(0, t)).toBe("2026-08-31");
		expect(localYmd(300, t)).toBe("2026-09-01");
	});

	it("recentMonths: n месяцев назад, начиная с текущего", () => {
		expect(recentMonths(3, "2026-02")).toEqual(["2026-02", "2026-01", "2025-12"]);
		expect(recentMonths(0, "2026-02")).toEqual([]);
	});

	it("monthLabel: название месяца на языке интерфейса с заглавной буквы", () => {
		expect(monthLabel("2026-09", "ru")).toBe("Сентябрь 2026");
		expect(monthLabel("2026-01", "ru")).toBe("Январь 2026");
		expect(monthLabel("2026-09", "kk")).toMatch(/^Қыркүйек 2026$/);
		// Не месяц — показываем как есть.
		expect(monthLabel("сентябрь", "ru")).toBe("сентябрь");
	});
});

describe("тексты экранов качества", () => {
	it("fillTemplate подставляет значения по именам, неизвестные оставляет", () => {
		expect(fillTemplate("Закрыть месяц {month}? Кандидатов: {n}", { month: "Сентябрь 2026", n: 3 }))
			.toBe("Закрыть месяц Сентябрь 2026? Кандидатов: 3");
		expect(fillTemplate("{a} и {b}", { a: 1 })).toBe("1 и {b}");
	});

	it("escapeHtml: окно подтверждения показывает сообщение как HTML", () => {
		expect(escapeHtml("<b>ООО «Рога & Копыта»</b>")).toBe("&lt;b&gt;ООО «Рога &amp; Копыта»&lt;/b&gt;");
	});

	it("userDisplayName: ФИО сотрудника, иначе логин, иначе запасное", () => {
		expect(userDisplayName({ username: "ivanov", employee: { fullName: "Иванов Иван" } })).toBe("Иванов Иван");
		expect(userDisplayName({ username: "ivanov", employee: { fullName: "  " } })).toBe("ivanov");
		expect(userDisplayName({ username: "ivanov", employee: null })).toBe("ivanov");
		expect(userDisplayName({}, "запасное")).toBe("запасное");
		expect(userDisplayName(null)).toBe("");
	});
});
