import { describe, it, expect } from "vitest";
import {
	classifyHeader, knResultState, knRowsToPayload, knTotals, locateKnHeader, mapKnSheet, parseAmount, type KnDraftRow,
} from "src/models/KnStatements/knSheet";

// Выписка лицевого счёта КН (E17 СК2.5, п. 11): узнавание колонок по синонимам, поиск строки
// заголовков под шапкой документа, суммы в разных записях, строки для сервера и итоги сравнения.

describe("Колонки выписки по заголовку", () => {
	it("КБК, наименование, сальдо — по синонимам, без регистра и знаков", () => {
		expect(classifyHeader("КБК")).toBe("kbk");
		expect(classifyHeader("Код бюджетной классификации")).toBe("kbk");
		expect(classifyHeader("Наименование")).toBe("name");
		expect(classifyHeader("Вид налога")).toBe("name");
		expect(classifyHeader("Налог")).toBe("name");
		expect(classifyHeader("Сальдо")).toBe("balance");
		expect(classifyHeader("Сальдо на 01.09.2026 (+ переплата / − задолженность)")).toBe("balance");
		expect(classifyHeader("Переплата")).toBe("overpay");
		expect(classifyHeader("Задолженность")).toBe("debt");
		expect(classifyHeader("Начислено")).toBeNull();
		expect(classifyHeader("")).toBeNull();
	});

	it("«Наименование КБК» — наименование, а не КБК", () => {
		expect(classifyHeader("Наименование КБК")).toBe("name");
	});

	it("казахские заголовки", () => {
		expect(classifyHeader("БСК")).toBe("kbk");
		expect(classifyHeader("Атауы")).toBe("name");
		expect(classifyHeader("Қалдық")).toBe("balance");
	});
});

describe("Строка заголовков", () => {
	it("ищется под шапкой документа; из двух колонок сальдо берётся итоговая", () => {
		const aoa = [
			["Выписка из лицевого счёта"],
			["ТОО «Клиент», БИН 221140044855"],
			[],
			["КБК", "Наименование", "Сальдо на начало", "Начислено", "Уплачено", "Сальдо на конец"],
			["101201", "ИПН", "0", "100", "100", "-5000,50"],
		];
		expect(locateKnHeader(aoa)).toEqual({ row: 3, columns: { kbk: 0, name: 1, balance: 5 } });
	});

	it("без итогового признака — последняя колонка сальдо", () => {
		const h = locateKnHeader([["КБК", "Сальдо входящее", "Сальдо"]]);
		expect(h?.columns.balance).toBe(2);
	});

	it("нет суммы или нет ключа — это не выписка", () => {
		expect(locateKnHeader([["КБК", "Наименование"]])).toBeNull();
		expect(locateKnHeader([["Сальдо", "Начислено"]])).toBeNull();
		expect(locateKnHeader([])).toBeNull();
	});
});

describe("Сумма из ячейки", () => {
	it("разделители разрядов, десятичная запятая и точка", () => {
		expect(parseAmount("1 234,56")).toBe(1234.56);
		expect(parseAmount("1\u00A0234,56")).toBe(1234.56);
		expect(parseAmount("-1234.5")).toBe(-1234.5);
		expect(parseAmount("1,234,567.89")).toBe(1234567.89);
		expect(parseAmount("1.234.567,89")).toBe(1234567.89);
		expect(parseAmount("1,234,567")).toBe(1234567);
		expect(parseAmount(1500)).toBe(1500);
	});

	it("бухгалтерский минус: скобки, минус в конце, типографский минус", () => {
		expect(parseAmount("(1 000,00)")).toBe(-1000);
		expect(parseAmount("1 000,00-")).toBe(-1000);
		expect(parseAmount("\u22121000")).toBe(-1000);
		expect(parseAmount("1 000 ₸")).toBe(1000);
	});

	it("не число — null", () => {
		expect(parseAmount("")).toBeNull();
		expect(parseAmount("нет")).toBeNull();
		expect(parseAmount("1-2")).toBeNull();
		expect(parseAmount(null)).toBeNull();
	});
});

describe("Лист книги → строки выписки", () => {
	it("строки с ключом и суммой; итоги и строки без суммы пропускаются и считаются", () => {
		const aoa = [
			["Лицевой счёт"],
			["КБК", "Наименование налога", "Сальдо"],
			["101201", "ИПН с доходов, облагаемых у источника", "-5 000,50"],
			["105101", "НДС", 1200],
			["", "Итого", "-3800,50"],
			["101111", "КПН", ""],
			["", "", ""],
		];
		const r = mapKnSheet(aoa);
		expect(r.noHeader).toBe(false);
		expect(r.rows.map(({ kbk, name, balance }) => ({ kbk, name, balance }))).toEqual([
			{ kbk: "101201", name: "ИПН с доходов, облагаемых у источника", balance: "-5000.5" },
			{ kbk: "105101", name: "НДС", balance: "1200" },
		]);
		expect(r.skipped).toBe(2);
	});

	it("нет сальдо, но есть переплата и задолженность — сальдо = переплата − долг", () => {
		const r = mapKnSheet([
			["КБК", "Переплата", "Задолженность"],
			["101201", "0", "5000"],
			["105101", "300", "0"],
		]);
		expect(r.rows.map((x) => x.balance)).toEqual(["-5000", "300"]);
	});

	it("не выписка — noHeader, строк нет", () => {
		expect(mapKnSheet([["Имя", "Фамилия"], ["А", "Б"]])).toEqual({ rows: [], skipped: 0, noHeader: true });
	});
});

describe("Строки редактора → тело запроса", () => {
	const row = (p: Partial<KnDraftRow>): KnDraftRow => ({ key: Math.random().toString(36), kbk: "", name: "", balance: "", ...p });

	it("пустые строки отбрасываются, сумма — числом", () => {
		const r = knRowsToPayload([row({ kbk: " 101201 ", balance: "-5 000,5" }), row({}), row({ name: "НДС", balance: "0" })]);
		expect(r).toEqual({ ok: true, rows: [{ kbk: "101201", name: null, balance: -5000.5 }, { kbk: null, name: "НДС", balance: 0 }] });
	});

	it("ошибки с номером строки: нет ключа, сумма не число; ни одной строки", () => {
		expect(knRowsToPayload([row({ balance: "10" })])).toEqual({ ok: false, error: "noKey", row: 1 });
		expect(knRowsToPayload([row({ kbk: "1", balance: "10" }), row({ kbk: "2", balance: "abc" })])).toEqual({ ok: false, error: "badBalance", row: 2 });
		expect(knRowsToPayload([row({})])).toEqual({ ok: false, error: "noRows" });
	});
});

describe("Итоги сравнения с 1С", () => {
	it("суммы по выписке и 1С (где сопоставлено), расхождения и несопоставленные", () => {
		const rows = [
			{ knBalance: -5000.5, onecBalance: -5000.5, diff: 0, ok: true, matched: true },
			{ knBalance: 1200, onecBalance: 1000, diff: 200, ok: false, matched: true },
			{ knBalance: 300, onecBalance: null, diff: null, ok: false, matched: false },
		];
		expect(knTotals(rows)).toEqual({ kn: -3500.5, onec: -4000.5, diff: 200, ok: 1, mismatches: 2, unmatched: 1 });
		expect(rows.map(knResultState)).toEqual(["ok", "mismatch", "unmatched"]);
	});
});
