/**
 * Время и отказы команд агента (S5): строки таблиц карточки.
 *
 * Держим порядок, ради которого таблицы и заведены: время — по убыванию среднего (вопрос
 * «что тормозит» — о самом медленном), отказы — по убыванию числа; и честную запись
 * перцентиля корзиной, а не выдуманным точным числом.
 */
import { describe, it, expect } from "vitest";
import { durationRows, failureRows, formatMs, p95Text } from "src/models/OneCAdmin/agentStats";
import { translate } from "src/i18";

const s = translate("secShort");

describe("время и отказы команд агента", () => {
	it("время — по убыванию среднего, с корзиной перцентиля", () => {
		const rows = durationRows({
			CLUSTER_LIST_SESSIONS: { count: 5, avgMs: 900, maxMs: 1400, p95LeSecs: 1 },
			// 28 200, а не 28 150: 28,15 в двоичной записи — 28,1499…, и toFixed(1) честно даёт «28,1».
			IB_LIST_USERS: { count: 42, avgMs: 28200, maxMs: 61200, p95LeSecs: 60 },
			IB_LIST_EXTENSIONS: { count: 3, avgMs: 400_000, maxMs: 400_000, p95LeSecs: null },
		});
		expect(rows.map((r) => r.type)).toEqual(["IB_LIST_EXTENSIONS", "IB_LIST_USERS", "CLUSTER_LIST_SESSIONS"]);
		expect(rows[1]).toEqual({ type: "IB_LIST_USERS", count: 42, avg: `28,2 ${s}`, p95: `≤ 60 ${s}`, max: `1 ${translate("minShort")}` });
		expect(rows[0].p95).toBe(`> 300 ${s}`);
	});

	it("отказы — по убыванию числа, нулевые не показываем", () => {
		expect(failureRows({ IB_AUTH_FAILED: 3, IB_BUSY: 87, IB_NOTHING: 0 }))
			.toEqual([{ code: "IB_BUSY", count: 87 }, { code: "IB_AUTH_FAILED", count: 3 }]);
	});

	it("пусто и доли секунды не падают", () => {
		expect(durationRows(undefined)).toEqual([]);
		expect(failureRows(undefined)).toEqual([]);
		expect(formatMs(400)).toBe(`0,4 ${s}`);
		expect(p95Text(5)).toBe(`≤ 5 ${s}`);
	});
});
