/**
 * Базы бизнес-агента и лимит тарифа (ПН, 19.09): как панель называет решение сервиса.
 *
 * «Сверх лимита» главнее связи — база на связи, но команды в неё сервис не пропускает; поле лимита — пусто или
 * целое от нуля, всё прочее не отправляется.
 */
import { describe, expect, it } from "vitest";
import {
	baseState, limitInput, overUsage, parseLimitInput, sameLimits, transportLabel, usageText,
} from "src/models/OneCAdmin/agentBasesView";

describe("базы агента: состояние и лимит", () => {
	it("сверх лимита — по решению сервиса, агента или статусу OVER_LIMIT; иначе связь", () => {
		expect(baseState({ status: "ONLINE", overLimit: null, overLimitService: true })).toBe("overLimit");
		expect(baseState({ status: "ONLINE", overLimit: true, overLimitService: false })).toBe("overLimit");
		expect(baseState({ status: "OVER_LIMIT", overLimit: null, overLimitService: false })).toBe("overLimit");
		expect(baseState({ status: "ONLINE", overLimit: false, overLimitService: false })).toBe("online");
		expect(baseState({ status: "OFFLINE", overLimit: null, overLimitService: false })).toBe("offline");
		expect(baseState({ status: null, overLimit: null, overLimitService: false })).toBe("unknown");
	});

	it("счётчики: «N из M», без лимита — без ограничения; превышение — только при заданном лимите", () => {
		expect(usageText(3, 2)).toMatch(/3.*2/);
		expect(usageText(3, null)).toMatch(/^3 \(/);
		expect(overUsage(3, 2)).toBe(true);
		expect(overUsage(2, 2)).toBe(false);
		expect(overUsage(99, null)).toBe(false);
	});

	it("поле лимита: пусто — null, целое — число, прочее — ошибка", () => {
		expect(parseLimitInput("")).toBeNull();
		expect(parseLimitInput("  ")).toBeNull();
		expect(parseLimitInput(" 5 ")).toBe(5);
		expect(parseLimitInput("0")).toBe(0);
		for (const bad of ["-1", "1.5", "abc", "1e3"]) expect(parseLimitInput(bad)).toBeUndefined();
		expect(limitInput(null)).toBe("");
		expect(limitInput(7)).toBe("7");
		expect(sameLimits({ maxBases: 2, maxBins: null }, { maxBases: 2, maxBins: null })).toBe(true);
		expect(sameLimits({ maxBases: 2, maxBins: null }, { maxBases: 2, maxBins: 0 })).toBe(false);
	});

	it("транспорт: HTTP, COM, неизвестно", () => {
		expect([transportLabel("http"), transportLabel("com"), transportLabel(null)]).toEqual(["HTTP", "COM", "—"]);
	});
});
