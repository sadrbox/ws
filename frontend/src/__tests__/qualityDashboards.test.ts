import { describe, it, expect } from "vitest";
import {
	areaColumnId, areaCounts, areaSortValue, areaTone, chiefSummary, primaryDocsTone, runStatusCounts, runStatusView, toChiefTableRows,
} from "src/models/QualityChiefDashboard/areaView";
import { managerTotals, staffAttention, toStaffRows, violationsTitle } from "src/models/QualityManagerDashboard/managerView";
import type { AreaCell, BonusRow, ChiefClientRow, ManagerDashboardData } from "src/services/quality/api";
import { QUALITY_AREAS } from "src/services/quality/checkCatalog";

// Панели главбуха и руководителя (E17 СК4): цвет ячеек, порядок «сначала проблемное» и строки
// таблиц из ответа сервера.

const cell = (p: Partial<AreaCell>): AreaCell => ({ errors: 0, warnings: 0, overdue: 0, openTasks: 0, state: "green", ...p });

const client = (org: string, group: string, p: Partial<ChiefClientRow> = {}): ChiefClientRow => ({
	organizationUuid: org,
	name: `Клиент ${org}`,
	groupUuid: group,
	groupName: `Группа ${group}`,
	responsibleUuid: null,
	responsibleName: null,
	lastRunAt: null,
	areas: Object.fromEntries(QUALITY_AREAS.map((a) => [a, cell({ state: "green" })])),
	requests: { open: 0, unaccepted: 0, overdueReaction: 0, state: "green" },
	deadlines: { overdue: 0, open: 0, state: "green" },
	primaryDocs: { received: false },
	kn: null,
	...p,
});

describe("Светофор участка", () => {
	it("цвет точки по состоянию сервера; нет данных и неизвестное — серый", () => {
		expect(areaTone("red")).toBe("red");
		expect(areaTone("yellow")).toBe("yellow");
		expect(areaTone("green")).toBe("green");
		expect(areaTone("none")).toBe("grey");
		expect(areaTone(undefined)).toBe("grey");
		expect(areaTone("purple")).toBe("grey");
	});

	it("сортировка: красный выше жёлтого, жёлтый выше зелёного, зелёный выше «нет данных»", () => {
		const red = areaSortValue(cell({ state: "red", errors: 1 }));
		const yellow = areaSortValue(cell({ state: "yellow", warnings: 50 }));
		const green = areaSortValue(cell({ state: "green" }));
		const none = areaSortValue(cell({ state: "none" }));
		expect(red).toBeGreaterThan(yellow);
		expect(yellow).toBeGreaterThan(green);
		expect(green).toBeGreaterThan(none);
		expect(areaSortValue(null)).toBe(0);
	});

	it("внутри цвета просрочки весят больше ошибок, ошибки — больше предупреждений", () => {
		expect(areaSortValue(cell({ state: "red", overdue: 1 }))).toBeGreaterThan(areaSortValue(cell({ state: "red", errors: 99 })));
		expect(areaSortValue(cell({ state: "red", errors: 1 }))).toBeGreaterThan(areaSortValue(cell({ state: "red", warnings: 99 })));
		// Большие числа не перетекают в соседний разряд.
		expect(areaSortValue(cell({ state: "yellow", warnings: 10_000 }))).toBeLessThan(areaSortValue(cell({ state: "red" })));
	});

	it("числа ячейки: «ошибки/предупреждения», просрочки отдельно; у чистой ячейки — пусто", () => {
		expect(areaCounts(cell({ errors: 2, warnings: 1, overdue: 3 }))).toEqual({ main: "2/1", overdue: 3 });
		expect(areaCounts(cell({ warnings: 4 }))).toEqual({ main: "0/4", overdue: 0 });
		expect(areaCounts(cell({}))).toEqual({ main: "", overdue: 0 });
		expect(areaCounts(undefined)).toEqual({ main: "", overdue: 0 });
	});

	it("первичка прошлого месяца: полностью — зелёный, частично — жёлтый, нет отметки — серый", () => {
		expect(primaryDocsTone({ received: true, complete: true })).toBe("green");
		expect(primaryDocsTone({ received: true, complete: false })).toBe("yellow");
		expect(primaryDocsTone({ received: false })).toBe("grey");
		expect(primaryDocsTone(null)).toBe("grey");
	});
});

describe("Строки матрицы клиентов", () => {
	it("клиент в двух группах — две строки с разными id; колонки участков — ключи сортировки", () => {
		const rows = toChiefTableRows([
			client("o1", "g1", { areas: { ...client("o1", "g1").areas, stock: cell({ state: "red", errors: 2 }) } }),
			client("o1", "g2"),
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].id).not.toBe(rows[1].id);
		expect(rows[0][areaColumnId("stock")]).toBeGreaterThan(rows[1][areaColumnId("stock")] as number);
		expect(rows[0].chiefClient).toBe("Клиент o1");
		expect(rows[0].source.organizationUuid).toBe("o1");
	});

	it("id строки устойчив: тот же клиент и группа — тот же id при повторной выдаче", () => {
		const a = toChiefTableRows([client("o1", "g1"), client("o2", "g1")]);
		const b = toChiefTableRows([client("o2", "g1")]);
		expect(b[0].id).toBe(a[1].id);
	});

	it("сводка: клиенты с красным где-либо и с жёлтым без красного", () => {
		const s = chiefSummary([
			client("a", "g", { deadlines: { overdue: 2, open: 3, state: "red" } }),
			client("b", "g", { requests: { open: 1, unaccepted: 1, overdueReaction: 0, state: "yellow" } }),
			client("c", "g"),
		]);
		expect(s).toEqual({ clients: 3, red: 1, yellow: 1 });
	});
});

describe("Панель руководителя: п. 30", () => {
	const row = (p: Partial<BonusRow> & { role?: string } = {}): BonusRow & { role: string } => ({
		userUuid: "u", userName: "Иванова", groupName: null, role: "member", bonus: true, confirmedCount: 0, violations: [],
		pendingCandidates: 0, disputed: 0, windowCount: 0, systematic: false, noMeasure: false, ...p,
	});

	it("внимание: «мер нет» важнее систематичности, та — важнее «без бонуса», дальше кандидаты", () => {
		expect(staffAttention(row({ noMeasure: true, systematic: true, bonus: false }))).toBe("noMeasure");
		expect(staffAttention(row({ systematic: true, bonus: false }))).toBe("systematic");
		expect(staffAttention(row({ bonus: false }))).toBe("noBonus");
		expect(staffAttention(row({ pendingCandidates: 2 }))).toBe("candidates");
		expect(staffAttention(row())).toBe("ok");
	});

	it("строки по группам: сотрудник в двух группах — две строки; ранг для сортировки", () => {
		const data: ManagerDashboardData["groups"] = [
			{ uuid: "g1", name: "Г1", headName: null, staff: [row({ userUuid: "u1", noMeasure: true, systematic: true })], totals: { withoutBonus: 1, candidates: 0, systematic: 1, noMeasure: 1 } },
			{ uuid: "g2", name: "Г2", headName: null, staff: [row({ userUuid: "u1" }), row({ userUuid: "u2", bonus: false })], totals: { withoutBonus: 1, candidates: 2, systematic: 0, noMeasure: 0 } },
		];
		const rows = toStaffRows(data);
		expect(rows).toHaveLength(3);
		expect(new Set(rows.map((r) => r.id)).size).toBe(3);
		expect(rows[0].mgrAttention).toBeGreaterThan(rows[2].mgrAttention);
		expect(rows[2].mgrBonus).toBe(0);
		expect(managerTotals(data)).toEqual({ withoutBonus: 2, candidates: 2, systematic: 1, noMeasure: 1 });
	});

	it("подсказка к подтверждённым: пункт, дата и суть каждого нарушения", () => {
		const title = violationsTitle(row({ violations: [{ uuid: "v", itemNumber: 20, description: "Просрочена задача", detectedAt: "2026-09-10" }] }));
		expect(title).toContain("20");
		expect(title).toContain("Просрочена задача");
	});
});

describe("Проверки базы клиента", () => {
	it("упавший прогон — красный «не проверена» с причиной; недоступные — серые с советом обновить", () => {
		const err = runStatusView({ state: "error", code: "NO_ANSWER", message: "Агент не ответил" }, "2026-09-24T00:00:00Z");
		expect(err.tone).toBe("red");
		expect(err.labelKey).toBe("chiefDashRunError");
		expect(err.detail).toBe("Агент не ответил (NO_ANSWER)");
		const na = runStatusView({ state: "unavailable", code: "CAPABILITY_MISSING" }, null);
		expect(na.tone).toBe("grey");
		expect(na.labelKey).toBe("chiefDashRunUnavailable");
		// Нет прав у пользователя API: красный (база только выглядит чистой), какого объекта не хватает — из текста 1С.
		const acc = runStatusView({ state: "access", code: "ACCESS_DENIED", message: "Нет права чтения: РегистрБухгалтерии.Типовой" }, "2026-09-24T00:00:00Z");
		expect(acc.tone).toBe("red");
		expect(acc.labelKey).toBe("chiefDashRunAccess");
		expect(acc.detail.startsWith("Нет права чтения: РегистрБухгалтерии.Типовой (ACCESS_DENIED) — ")).toBe(true);
		expect(runStatusView({ state: "stale" }, "2026-09-20T00:00:00Z").tone).toBe("yellow");
		expect(runStatusView({ state: "ok" }, "2026-09-25T00:00:00Z").tone).toBe("green");
	});

	it("старый сервер без runStatus: есть прогон — «проверена», нет — «не было»", () => {
		expect(runStatusView(undefined, "2026-09-25T00:00:00Z").labelKey).toBe("chiefDashRunOk");
		expect(runStatusView(undefined, null).labelKey).toBe("chiefDashNoRuns");
	});

	it("счётчики для сообщения: клиент в двух группах считается один раз", () => {
		const rows = [
			client("o1", "g1", { runStatus: { state: "error" } }),
			client("o1", "g2", { runStatus: { state: "error" } }),
			client("o2", "g1", { runStatus: { state: "unavailable" } }),
			client("o3", "g1", { runStatus: { state: "stale" } }),
			client("o4", "g1", { runStatus: { state: "ok" } }),
			client("o5", "g1", { runStatus: { state: "access" } }),
		];
		expect(runStatusCounts(rows)).toEqual({ failed: 1, unavailable: 1, access: 1, stale: 1 });
	});
});
