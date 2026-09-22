/**
 * Настройки агента в панели (задача агенту §3): что панель разрешает править и что отправляет.
 *
 * Правило одно: править можно только то, что агент назвал изменяемым, а в команду уходит только годное —
 * иначе агент отвечает отказом по схеме, и человек видит «ошибка» там, где просто пустое поле.
 */
import { describe, expect, it } from "vitest";
import { canEditField, configPatch, hasChanges, numberField } from "src/models/OneCAdmin/agentConfigView";

describe("настройки агента", () => {
	it("править можно только объявленное агентом", () => {
		expect(canEditField(["ibParallel", "bases"], "ibParallel")).toBe(true);
		expect(canEditField(["ibParallel"], "logLevel")).toBe(false);
		// Сборка старее правки списка не присылает — значит, править нечего.
		expect(canEditField(undefined, "ibParallel")).toBe(false);
	});

	it("число из поля: пусто и мусор — не число", () => {
		expect(numberField(" 4 ")).toBe(4);
		expect(numberField("")).toBeNull();
		expect(numberField("-1")).toBeNull();
		expect(numberField("два")).toBeNull();
	});

	it("в команду уходит только годное: пустые и негодные поля отбрасываются", () => {
		expect(configPatch({ ibParallel: 4, commandTimeoutSecs: null as unknown as number, logLevel: "" })).toEqual({ ibParallel: 4 });
		expect(configPatch({ bases: [{ key: "Б1", enabled: false }, { key: "Б2" }] })).toEqual({ bases: [{ key: "Б1", enabled: false }] });
		expect(configPatch({})).toEqual({});
	});
});

describe("СП3: пределы как у агента", () => {
	it("ноль — «без предела» и уходит агенту; у числа баз ноль бессмысленен", () => {
		expect(configPatch({ commandTimeoutSecs: 0, longCommandTimeoutSecs: 0 })).toEqual({ commandTimeoutSecs: 0, longCommandTimeoutSecs: 0 });
		expect(configPatch({ ibParallel: 0 })).toEqual({});
	});

	it("«Сохранить» гаснет, когда отправлять нечего", () => {
		expect(hasChanges({ commandTimeoutSecs: null as unknown as number })).toBe(false);
		expect(hasChanges({ logLevel: "trace" })).toBe(true);
		expect(hasChanges({})).toBe(false);
	});
});
