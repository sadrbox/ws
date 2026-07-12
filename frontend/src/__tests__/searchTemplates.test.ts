import { describe, it, expect } from "vitest";
import { parseSearchQuery, matchRowBySearch } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";

// Шаблон «[номенклатура: ноут]» — поиск по ВЛОЖЕННЫМ строкам документа (позициям),
// а НЕ по колонкам списка: колонки «Номенклатура» в списке Реализаций нет и быть не
// может — товаров в документе много.
//
// Отсюда разделение обязанностей:
//   • области (шаблоны) → уходят на СЕРВЕР как nested[имя]=текст
//     (Prisma `{ saleItems: { some: { product: { name: contains } } } }` —
//      см. backend/utils/nestedSearch.js и его тесты);
//   • свободные слова   → фильтруются на КЛИЕНТЕ по видимым колонкам (как раньше).
//
// Здесь проверяем РАЗБОР запроса и то, что свободные слова не сломались.

describe("разбор шаблонов поиска", () => {
	it("[номенклатура:ноут] — скобочная форма без пробела", () => {
		const p = parseSearchQuery("[номенклатура:ноут]");
		expect(p.scopes).toEqual([{ scope: "номенклатура", text: "ноут" }]);
		expect(p.words).toEqual([]);
	});

	it("«номенКлатура: ноУтбук» — голая форма, регистр не важен", () => {
		const p = parseSearchQuery("номенКлатура: ноУтбук");
		expect(p.scopes[0]).toMatchObject({ scope: "номенклатура", text: "ноутбук" });
	});

	it("«контраГент:строЙ» — без скобок и без пробела", () => {
		const p = parseSearchQuery("контраГент:строЙ");
		expect(p.scopes[0]).toMatchObject({ scope: "контрагент", text: "строй" });
	});

	it("шаблон и свободные слова разделяются", () => {
		const p = parseSearchQuery("[номенклатура: ноутбук] РЕАЛ-5");
		expect(p.scopes).toEqual([{ scope: "номенклатура", text: "ноутбук" }]);
		expect(p.words).toEqual(["реал-5"]);
	});

	it("несколько областей", () => {
		const p = parseSearchQuery("номенклатура: ноутбук артикул: NB-1");
		expect(p.scopes.map((s) => s.scope)).toEqual(["номенклатура", "артикул"]);
		expect(p.scopes.map((s) => s.text)).toEqual(["ноутбук", "nb-1"]);
	});

	it("значение области может быть из нескольких слов", () => {
		const p = parseSearchQuery("номенклатура: ноутбук dell");
		expect(p.scopes[0].text).toBe("ноутбук dell");
	});

	it("без шаблонов — всё уходит в свободные слова", () => {
		const p = parseSearchQuery("гольфстрим 2026");
		expect(p.scopes).toEqual([]);
		expect(p.words).toEqual(["гольфстрим", "2026"]);
	});
});

describe("свободные слова по-прежнему ищутся по видимым колонкам", () => {
	const cols = [
		{ identifier: "number", type: "string", visible: true },
		{ identifier: "counterparty.name", type: "string", visible: true },
	] as unknown as TColumn[];
	const rows = [
		{ number: "РЕАЛ-1", counterparty: { name: "ТОО Строй-Снаб" } },
		{ number: "РЕАЛ-2", counterparty: { name: "ТОО Гольфстрим" } },
	] as unknown as TDataItem[];

	const find = (q: string) =>
		rows
			.filter((r) => matchRowBySearch(r, cols, parseSearchQuery(q).words))
			.map((r) => (r as unknown as { number: string }).number);

	it("ищет по всем видимым колонкам", () => {
		expect(find("гольфстрим")).toEqual(["РЕАЛ-2"]);
		expect(find("реал-1")).toEqual(["РЕАЛ-1"]);
	});

	it("области НЕ фильтруют на клиенте — их применяет сервер", () => {
		// Свободных слов не остаётся → клиент строки не отсекает.
		expect(find("[номенклатура: ноутбук]")).toEqual(["РЕАЛ-1", "РЕАЛ-2"]);
	});
});
