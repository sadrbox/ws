/**
 * «Фоновые запросы»: опрос по расписанию не считается, ждущие разделы названы (14.09).
 */
import { describe, it, expect } from "vitest";
import { isBackgroundQuery, queryLabel, waitingSummary, type QueryLike } from "src/components/TechMessages/fetchLabels";
import { translate } from "src/i18";

const q = (queryKey: unknown[], over: Partial<QueryLike> = {}): QueryLike =>
	({ queryKey, state: { dataUpdatedAt: 0 }, observers: [], ...over });

describe("что ждём в «Фоновых запросах»", () => {
	it("разделы панели 1С называются по-человечески", () => {
		expect(queryLabel(["onec", "agents"])).toBe(translate("onecTabAgents"));
		expect(queryLabel(["onec", "base-users-cached", "_transition"])).toBe(translate("onecTabUsers"));
		expect(queryLabel(["onec-bases"])).toBe(translate("onecTabBases"));
	});

	it("неизвестный ключ — сам ключ, не пустота", () => {
		expect(queryLabel(["что-то-своё"])).toBe("что-то-своё");
		expect(queryLabel([{ x: 1 }])).toBe("");
	});

	it("опрос по расписанию с данными — фон; первая загрузка — нет", () => {
		const polling = { observers: [{ options: { refetchInterval: 15_000 } }] };
		expect(isBackgroundQuery(q(["onec", "agents"], { ...polling, state: { dataUpdatedAt: 1 } }))).toBe(true);
		expect(isBackgroundQuery(q(["onec", "agents"], polling))).toBe(false);
		expect(isBackgroundQuery(q(["sales"], { meta: { background: true } }))).toBe(true);
	});

	it("сводка: фон не считается, имена без повторов, не больше трёх", () => {
		const bg = { observers: [{ options: { refetchInterval: 15_000 } }], state: { dataUpdatedAt: 1 } };
		const w = waitingSummary([
			q(["onec", "agents"], bg),
			q(["onec", "sessions"]), q(["onec", "sessions"]),
			q(["onec", "bases"]), q(["onec", "locks"]), q(["onec", "licenses"]),
		]);
		expect(w.count).toBe(5);
		expect(w.names).toEqual([translate("onecTabSessions"), translate("onecTabBases"), translate("onecLocks"), "…"]);
	});
});
