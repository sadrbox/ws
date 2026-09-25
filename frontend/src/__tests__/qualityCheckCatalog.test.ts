import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
	AREA_LABEL_KEYS, CHECK_CATALOG, QUALITY_AREAS, areaOfCheck, checkCodesOfArea, checkLabel, checkOptions, findCheck,
} from "src/services/quality/checkCatalog";

// Каталог проверок учёта (E17 СК2) — зеркало backend/services/quality/findingRules.js. Коды,
// участки и пункты стандарта обязаны совпадать с сервером: по коду сервер относит находку к
// участку панели главбуха, а экран по тем же кодам строит отборы и привязки пунктов чек-листа.

const BACKEND = resolve(__dirname, "../../../backend/services/quality/findingRules.js");

/** CHECK_CATALOG сервера — разбором текста (backend — отдельный пакет, импортировать его нельзя). */
function backendCatalog(): Map<string, { area: string; item: number | null }> {
	const src = readFileSync(BACKEND, "utf-8");
	const block = src.slice(src.indexOf("export const CHECK_CATALOG"), src.indexOf("});", src.indexOf("export const CHECK_CATALOG")));
	const out = new Map<string, { area: string; item: number | null }>();
	for (const m of block.matchAll(/"([a-z_.]+)":\s*\{[^}]*area:\s*"(\w+)",\s*item:\s*(\d+|null)\s*\}/g)) {
		out.set(m[1], { area: m[2], item: m[3] === "null" ? null : Number(m[3]) });
	}
	return out;
}

describe("Каталог проверок — целостность", () => {
	it("коды и ключи подписей уникальны", () => {
		const codes = CHECK_CATALOG.map((c) => c.code);
		const keys = CHECK_CATALOG.map((c) => c.titleKey);
		expect(new Set(codes).size).toBe(codes.length);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("ключ подписи выводится из кода: check + части кода с заглавной", () => {
		for (const c of CHECK_CATALOG) {
			const expected = "check" + c.code.split(/[._]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
			expect(c.titleKey, c.code).toBe(expected);
		}
	});

	it("участок каждой проверки — из списка участков панели; пункт — 1…40 или null", () => {
		for (const c of CHECK_CATALOG) {
			expect(QUALITY_AREAS).toContain(c.area);
			if (c.item !== null) expect(c.item >= 1 && c.item <= 40, c.code).toBe(true);
		}
	});

	it("у каждого участка есть ключ подписи, а коды участков покрывают каталог ровно один раз", () => {
		expect(Object.keys(AREA_LABEL_KEYS).sort()).toEqual([...QUALITY_AREAS].sort());
		const all = QUALITY_AREAS.flatMap((a) => checkCodesOfArea(a));
		expect(all.sort()).toEqual(CHECK_CATALOG.map((c) => c.code).sort());
	});
});

describe("Каталог проверок — совпадает с сервером", () => {
	it.skipIf(!existsSync(BACKEND))("те же коды, участки и пункты стандарта, что в findingRules.js", () => {
		const server = backendCatalog();
		expect(server.size).toBeGreaterThan(0);
		expect([...server.keys()].sort()).toEqual(CHECK_CATALOG.map((c) => c.code).sort());
		for (const c of CHECK_CATALOG) {
			expect({ area: c.area, item: c.item }, c.code).toEqual(server.get(c.code));
		}
	});

	it.skipIf(!existsSync(BACKEND))("порядок участков — как колонки панели на сервере (AREAS)", () => {
		const src = readFileSync(BACKEND, "utf-8");
		const m = /export const AREAS = \[([^\]]+)\]/.exec(src);
		const server = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
		expect([...QUALITY_AREAS]).toEqual(server);
	});
});

describe("Участок и подпись проверки", () => {
	it("известная проверка — участок из каталога", () => {
		expect(areaOfCheck("stock.negative")).toBe("stock");
		expect(areaOfCheck("cash.negative")).toBe("bank");
		expect(areaOfCheck("accounts.unnatural_balance")).toBe("documents");
	});

	it("новая проверка 1С — участок по префиксу кода, как на сервере; неизвестный префикс — документы", () => {
		expect(areaOfCheck("cash.gaps")).toBe("bank");
		expect(areaOfCheck("fixed_assets.revaluation")).toBe("fixedAssets");
		expect(areaOfCheck("settlements.new_rule")).toBe("debts");
		expect(areaOfCheck("esf.late")).toBe("taxes");
		expect(areaOfCheck("payroll.something")).toBe("documents");
		expect(areaOfCheck(null)).toBe("documents");
	});

	it("подпись: перевод, иначе подпись сервера, иначе сам код — но не сырой ключ", () => {
		expect(checkLabel("stock.negative", "Отрицательные остатки")).not.toBe("checkStockNegative");
		expect(checkLabel("new.check", "Новая проверка")).toBe("Новая проверка");
		expect(checkLabel("new.check")).toBe("new.check");
		expect(checkLabel("new.check", "   ")).toBe("new.check");
	});

	it("варианты выбора: пустой первым, отбор по участку", () => {
		const all = checkOptions("Все");
		expect(all[0]).toEqual({ value: "", label: "Все" });
		// Служебная «база не проверена» (_catalog) — не проверка: её не выбирают.
		expect(all).toHaveLength(CHECK_CATALOG.filter((c) => !c.code.startsWith("_")).length + 1);
		expect(all.some((o) => o.value === "_catalog")).toBe(false);
		expect(checkLabel("_catalog")).toBe("База не проверена");
		const stock = checkOptions("Все", "stock").slice(1).map((o) => o.value);
		expect(stock.every((code) => findCheck(code)?.area === "stock")).toBe(true);
		expect(stock).toContain("stock.negative");
	});
});
