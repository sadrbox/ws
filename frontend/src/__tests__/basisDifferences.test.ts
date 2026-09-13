/**
 * Расхождение с основанием — со значениями, а не одними названиями полей.
 *
 * ЖИВОЙ СЛУЧАЙ (14.09): «Документ не соответствует основанию: Контрагент, Договор, строки
 * отличаются от основания». Что именно не так — не сказано; приходилось открывать основание.
 */
import { describe, it, expect } from "vitest";
import { describeBasisDifferences } from "src/utils/basisDifferences";
import { formatBasisDifferences } from "src/hooks/useDocumentNotices";

const KEYS = ["productUuid", "quantity", "price", "vatRate", "discountPercent", "exciseRate"] as const;
const row = (productUuid: string, name: string, quantity: number, price = 100) =>
	({ productUuid, product: { name }, quantity, price, vatRate: 12, discountPercent: 0, exciseRate: 0 });
const run = (over: Partial<Parameters<typeof describeBasisDifferences>[0]>) => describeBasisDifferences({
	basisFields: {}, currentFields: {}, basisItems: [], currentItems: [],
	itemKeys: KEYS, itemMatchMode: "exact", ignoreItems: false, ...over,
});

describe("в чём документ расходится с основанием", () => {
	it("шапка — оба значения по именам", () => {
		const d = run({
			basisFields: { counterpartyUuid: "c2", counterpartyName: "ТОО Бета", contractUuid: "k1", contractName: "Договор 1" },
			currentFields: { counterpartyUuid: "c1", counterpartyName: "ТОО Альфа", contractUuid: "", contractName: "" },
		});
		expect(d).toEqual([
			"Контрагент: в документе «ТОО Альфа», в основании «ТОО Бета»",
			"Договор: в документе не заполнено, в основании «Договор 1»",
		]);
	});

	it("совпадающая шапка и поле, которого у документа нет, — не расхождение", () => {
		expect(run({
			basisFields: { counterpartyUuid: "c1", counterpartyName: "ТОО", warehouseUuid: "w1" },
			currentFields: { counterpartyUuid: "c1" },
		})).toEqual([]);
	});

	it("строка товара — каждое разошедшееся поле со значениями", () => {
		const d = run({ basisItems: [row("p1", "Товар 46", 3, 90)], currentItems: [row("p1", "Товар 46", 5, 100)] });
		expect(d).toEqual(["«Товар 46»: Количество — в документе 5, в основании 3; Цена — в документе 100, в основании 90"]);
	});

	it("«100.00» и 100 — одно и то же", () => {
		expect(run({
			basisItems: [{ ...row("p1", "Товар", 1), price: "100.00" }], currentItems: [row("p1", "Товар", 1, 100)],
		})).toEqual([]);
	});

	it("лишний и пропавший товар названы", () => {
		const d = run({ basisItems: [row("p2", "Товар 12", 4)], currentItems: [row("p1", "Товар 46", 2)] });
		expect(d).toEqual([
			"«Товар 46»: нет в основании (Количество 2)",
			"«Товар 12»: нет в документе (Количество 4)",
		]);
	});

	it("товар несколькими строками — число строк и общее количество", () => {
		const d = run({
			basisItems: [row("p1", "Товар", 1), row("p1", "Товар", 2)],
			currentItems: [row("p1", "Товар", 3)],
		});
		expect(d).toEqual(["«Товар»: строк — в документе 1, в основании 2, Количество — в документе 3, в основании 3"]);
	});

	it("возврат: частичное количество допустимо, чужой товар — нет", () => {
		expect(run({
			itemMatchMode: "productsSubset",
			basisItems: [row("p1", "Товар 46", 10)],
			currentItems: [row("p1", "Товар 46", 2), row("p9", "Чужой", 1)],
		})).toEqual(["«Чужой»: нет в основании"]);
	});

	it("документ без табличной части — сверяется только шапка", () => {
		expect(run({ ignoreItems: true, basisItems: [row("p1", "Т", 1)], currentItems: [] })).toEqual([]);
	});

	it("список в сообщении — строками, лишнее числом", () => {
		expect(formatBasisDifferences(["А", "Б"])).toBe("\n• А\n• Б");
		const many = Array.from({ length: 13 }, (_, k) => `пункт ${k + 1}`);
		const text = formatBasisDifferences(many);
		expect(text).toContain("• пункт 10");
		expect(text).not.toContain("пункт 11");
		expect(text).toMatch(/и ещё 3$/);
	});
});
