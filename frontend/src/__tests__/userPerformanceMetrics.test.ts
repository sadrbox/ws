import { describe, it, expect } from "vitest";
import { translate } from "src/i18";
import { fmtMaybe, fmtValue } from "src/models/UserPerformance/format";
import { barData, metric, taskData, userTileValue, TOP_N } from "src/models/UserPerformance/metrics";
import { BLOCKS, KPI_TILES } from "src/models/UserPerformance/dashboardBlocks";

// Строки GET /reports/user-performance (E17 СК1.8): средние и доля — null, когда считать не из чего.
const ROWS = [
	{ userName: "Иванова", tasksDone: 10, doneWithResult: 9, resultShare: 90, reactionMinutesAvg: 30, reminders: 0, returned: 1, ratingAvg: 4.5, tasksActive: 2, tasksOverdue: 1 },
	{ userName: "Петрова", tasksDone: 4, doneWithResult: 0, resultShare: 0, reactionMinutesAvg: null, reminders: 3, returned: 0, ratingAvg: null, tasksActive: 0, tasksOverdue: 0 },
	{ userName: "Сидоров", tasksDone: 0, doneWithResult: 0, resultShare: null, reactionMinutesAvg: 125, reminders: 1, returned: 0, ratingAvg: 3, tasksActive: 0, tasksOverdue: 0 },
];

describe("metric — «нет данных» не равно нулю", () => {
	it("null/undefined/пусто/мусор — null, числа и числа-строки — числа", () => {
		expect(metric(null)).toBeNull();
		expect(metric(undefined)).toBeNull();
		expect(metric("")).toBeNull();
		expect(metric("abc")).toBeNull();
		expect(metric(0)).toBe(0);
		expect(metric("12.5")).toBe(12.5);
	});
});

describe("barData — столбики блока", () => {
	it("доля с результатом: 0 % — это сигнал (keepZero), null — нет данных; худшие сверху (asc)", () => {
		const d = barData(ROWS, "userName", "resultShare", { keepZero: true, sortDir: "asc" });
		expect(d).toEqual([{ name: "Петрова", value: 0 }, { name: "Иванова", value: 90 }]);
	});
	it("по умолчанию нули скрыты и порядок по убыванию (как у прежних блоков)", () => {
		expect(barData(ROWS, "userName", "reminders")).toEqual([{ name: "Петрова", value: 3 }, { name: "Сидоров", value: 1 }]);
	});
	it("время реакции: без обращений (null) человека на графике нет", () => {
		expect(barData(ROWS, "userName", "reactionMinutesAvg", { keepZero: true }).map((x) => x.name)).toEqual(["Сидоров", "Иванова"]);
	});
	it("не больше TOP_N строк", () => {
		const many = Array.from({ length: TOP_N + 5 }, (_, i) => ({ userName: `u${i}`, v: i + 1 }));
		expect(barData(many, "userName", "v")).toHaveLength(TOP_N);
	});
	it("стек задач — без людей без задач, больше задач — выше", () => {
		expect(taskData(ROWS).map((x) => x.name)).toEqual(["Иванова", "Петрова"]);
	});
});

describe("userTileValue — KPI-плитки по пользователям", () => {
	it("сумма по строкам", () => {
		expect(userTileValue(ROWS, { key: "reminders" })).toBe(4);
		expect(userTileValue(ROWS, { key: "returned" })).toBe(1);
	});
	it("доля — отношение сумм, а не среднее долей: 9 из 14 закрытых = 64 %", () => {
		expect(userTileValue(ROWS, { key: "doneWithResult", ratioOf: "tasksDone" })).toBe(64);
	});
	it("доля без знаменателя — null («—»), а не 0 %", () => {
		expect(userTileValue([{ doneWithResult: 0, tasksDone: 0 }], { key: "doneWithResult", ratioOf: "tasksDone" })).toBeNull();
		expect(userTileValue([], { key: "doneWithResult", ratioOf: "tasksDone" })).toBeNull();
	});
	it("плитка доли E17 описана через ratioOf", () => {
		expect(KPI_TILES.find((t) => t.id === "kpi-result-share")).toMatchObject({ key: "doneWithResult", ratioOf: "tasksDone", format: "percent" });
	});
});

describe("fmtValue — новые форматы E17", () => {
	it("проценты, оценка с одним знаком", () => {
		expect(fmtValue(64, "percent")).toBe("64 %");
		expect(fmtValue(4.5, "rating")).toBe("4,5");
		expect(fmtValue(4, "rating")).toBe("4");
	});
	it("минуты: до часа — «мин», больше — «ч мин»; на оси — голое число", () => {
		const min = translate("perfUnitMin");
		const hour = translate("perfUnitHour");
		expect(fmtValue(45, "minutes")).toBe(`45 ${min}`);
		expect(fmtValue(125, "minutes")).toBe(`2 ${hour} 5 ${min}`);
		expect(fmtValue(120, "minutes")).toBe(`2 ${hour}`);
		expect(fmtValue(125, "minutes", true)).toBe("125");
	});
	it("fmtMaybe: пустое значение — «—»", () => {
		expect(fmtMaybe(null, "percent")).toBe("—");
		expect(fmtMaybe(undefined, "rating")).toBe("—");
		expect(fmtMaybe(0, "percent")).toBe("0 %");
	});
});

describe("реестр блоков E17", () => {
	it("новые блоки берут данные из отчёта по пользователям и гейтятся правом на задачи", () => {
		const e17 = BLOCKS.filter((b) => ["result-share-by-user", "reaction-by-user", "reminders-by-user", "returned-by-user", "rating-by-user"].includes(b.id));
		expect(e17).toHaveLength(5);
		for (const b of e17) expect(b, b.id).toMatchObject({ source: "users", requires: "Todo", kind: "bars" });
	});
});
