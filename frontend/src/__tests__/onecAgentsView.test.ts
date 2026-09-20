/**
 * Агенты в панели (п. 2–5): отборы списка, сводка «не на связи», подписи команд и журнала.
 */
import { describe, expect, it } from "vitest";
import { agentMatches, agentOfflineSummary } from "src/models/OneCAdmin/agentsView";
import { auditDetailsText, auditEventLabel, commandStateTone, healthScalars } from "src/models/OneCAdmin/agentActivityView";

const a = (over: Partial<{ id: string; name: string; role: "business" | "admin"; online: boolean; disabled: boolean; lastSeenAt: string | null }> = {}) => ({
	id: "a1", name: "Агент", role: "business" as const, online: true, disabled: false, lastSeenAt: "2026-09-19T10:00:00Z", ...over,
});

describe("список агентов", () => {
	it("отборы: роль и состояние; «не на связи» — только включённые", () => {
		expect(agentMatches(a(), "business", "online")).toBe(true);
		expect(agentMatches(a(), "admin", "")).toBe(false);
		expect(agentMatches(a({ online: false }), "", "offline")).toBe(true);
		expect(agentMatches(a({ online: false, disabled: true }), "", "offline")).toBe(false);
		expect(agentMatches(a({ disabled: true }), "", "disabled")).toBe(true);
	});

	it("сводка «не на связи»: отключённые не считаются, дольше молчащие — первыми, без сигнала — самыми первыми", () => {
		const s = agentOfflineSummary([
			a({ id: "1", name: "Свежий", online: false, lastSeenAt: "2026-09-19T12:00:00Z" }),
			a({ id: "2", name: "Давний", online: false, lastSeenAt: "2026-09-18T12:00:00Z" }),
			a({ id: "3", name: "Выключен", online: false, disabled: true }),
			a({ id: "4", name: "Ни разу", online: false, lastSeenAt: null }),
			a({ id: "5", name: "Живой" }),
		]);
		expect(s.map((x) => x.name)).toEqual(["Ни разу", "Давний", "Свежий"]);
	});
});

describe("карточка агента: команды и журнал", () => {
	it("тон состояния команды", () => {
		expect(["queued", "dispatched", "done", "failed", "expired", "canceled"].map(commandStateTone)).toEqual(["wait", "wait", "ok", "bad", "bad", "off"]);
	});

	it("незнакомое событие журнала не пропадает — показывается как есть", () => {
		expect(auditEventLabel("agent.something_new")).toBe("agent.something_new");
		expect(auditEventLabel("agent.rename")).not.toBe("agent.rename");
	});

	it("подробности одной строкой, пустые поля опускаются, длинное обрезается", () => {
		expect(auditDetailsText({ name: "X", note: null, limits: { maxBases: 2 } })).toBe('name: X · limits: {"maxBases":2}');
		expect(auditDetailsText({})).toBe("—");
		expect(auditDetailsText({ t: "x".repeat(400) }).length).toBe(300);
	});

	it("сводка бизнес-агента: простые поля отдельно от баз и лимитов", () => {
		expect(healthScalars({ version: "1.4", ok: true, bases: [], limits: {}, nested: { a: 1 } })).toEqual([["version", "1.4"], ["ok", "true"]]);
	});
});
