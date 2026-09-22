/**
 * Разбор самопроверки базы (ПН6) и чисел организации (ПН9).
 *
 * Оба разбора читают ответ 1С, форму которого задаёт расширение и будет менять. Держим ровно то, что
 * ломается молча: незнание не выдаётся за поломку, непонятая форма не превращается в пустой экран, а
 * отсутствие суммы не показывается нулём — ноль означает «долга нет», и это другой ответ.
 */
import { describe, expect, it } from "vitest";
import { selfCheckLines, selfCheckSummary } from "src/models/OneCBases/selfCheckView";
import { balanceRows, debtRows, debtTotals, money, rowsOf, showMoney, totalOf } from "src/models/Organizations/financeView";

describe("самопроверка базы", () => {
	it("список проверок читается как есть: заголовок, итог, подробность и подсказка", () => {
		const lines = selfCheckLines({
			ok: false,
			checks: [
				{ id: "token", title: "Токен сервиса", ok: true },
				{ id: "rights", title: "Права пользователя", ok: false, detail: "нет роли «Полные права»", hint: "выдайте роль в конфигураторе" },
			],
		});
		expect(lines.map((l) => [l.title, l.ok])).toEqual([["Токен сервиса", true], ["Права пользователя", false]]);
		expect(lines[1].hint).toContain("конфигураторе");
	});

	it("проверка без признака ok — «не знаем», а не отказ: чинить нечего", () => {
		const [line] = selfCheckLines({ checks: [{ title: "Версия расширения" }] });
		expect(line.ok).toBeNull();
		const s = selfCheckSummary({ checks: [{ title: "Версия расширения" }] });
		expect(s.ok).toBe(true);
		expect(s.unknown).toBe(1);
		expect(s.failed).toBe(0);
	});

	it("плоский ответ старой сборки тоже читается: имя поля называет проверку", () => {
		const lines = selfCheckLines({ ok: false, version: "1.6.0", token: true, rights: false });
		expect(lines.map((l) => [l.title, l.ok])).toEqual([["token", true], ["rights", false]]);
		// Поля, описывающие саму базу, проверками не притворяются.
		expect(lines.map((l) => l.title)).not.toContain("version");
	});

	it("«ok» расширения главнее нашего подсчёта: оно знает про проверки, которых панель не понимает", () => {
		expect(selfCheckSummary({ ok: false, checks: [{ title: "Токен", ok: true }] }).ok).toBe(false);
		expect(selfCheckSummary({ ok: true, checks: [{ title: "Токен", ok: false }] }).ok).toBe(false);
	});

	it("организации без БИН названы поимённо: без БИН база не найдётся ни по одной команде", () => {
		const s = selfCheckSummary({ organizations: [{ name: "ТОО Ромашка", bin: "831111302342" }, { name: "ИП Азимов" }, { bin: "123" }] });
		expect(s.organizationsWithoutBin).toEqual(["ИП Азимов", "без наименования"]);
	});

	it("ответа нет — и строк нет: пустой экран честнее выдуманных проверок", () => {
		expect(selfCheckLines(null)).toEqual([]);
		expect(selfCheckSummary(null).ok).toBe(true);
	});
});

describe("числа организации из 1С", () => {
	it("строки берутся из массива, rows, items или list — но не из любого массива подряд", () => {
		expect(rowsOf([{ a: 1 }])).toHaveLength(1);
		expect(rowsOf({ rows: [{ a: 1 }, { b: 2 }] })).toHaveLength(2);
		expect(rowsOf({ items: [{ a: 1 }] })).toHaveLength(1);
		expect(rowsOf({ something: [{ a: 1 }] })).toEqual([]);
		expect(rowsOf(null)).toEqual([]);
	});

	it("сумма читается числом и строкой с разрядами; нечитаемое — null, а не ноль", () => {
		expect(money(1500)).toBe(1500);
		expect(money("12 500,50")).toBe(12500.5);
		expect(money("1234.5")).toBe(1234.5);
		expect(money("")).toBeNull();
		expect(money("нет")).toBeNull();
		expect(money(undefined)).toBeNull();
		// Пропуск показывается прочерком: ноль сказал бы «долга нет».
		expect(showMoney(null)).toBe("—");
	});

	it("контрагент читается и вложенным объектом, и полем рядом", () => {
		const rows = debtRows({ rows: [
			{ counterparty: { name: "ТОО Ромашка", bin: "831111302342" }, receivable: 1000, payable: 0, overdue: 250 },
			{ counterpartyName: "ИП Азимов", bin: "900000000001", debit: "2 000,00" },
		] });
		expect(rows[0]).toEqual({ name: "ТОО Ромашка", bin: "831111302342", receivable: 1000, payable: 0, overdue: 250 });
		expect(rows[1].name).toBe("ИП Азимов");
		expect(rows[1].receivable).toBe(2000);
		expect(rows[1].overdue).toBeNull();
	});

	it("итоги от 1С главнее наших: складывать показанные 50 строк из 320 — показать сумму, не сходящуюся ни с чем", () => {
		const data = { rows: [{ name: "А", receivable: 100 }], totals: { receivable: 9000, payable: 10 } };
		expect(debtTotals(data, debtRows(data)).receivable).toBe(9000);

		const own = { rows: [{ name: "А", receivable: 100 }, { name: "Б", receivable: 50 }] };
		expect(debtTotals(own, debtRows(own)).receivable).toBe(150);
		expect(debtTotals(own, debtRows(own)).payable).toBeNull();
	});

	it("сколько строк всего — из ответа 1С: по нему карточка скажет «показано 50 из 320»", () => {
		expect(totalOf({ rows: [], total: 320 })).toBe(320);
		expect(totalOf({ rows: [] })).toBeNull();
	});

	it("остатки: счёт, наименование и сумма — под любым из принятых имён полей", () => {
		expect(balanceRows({ rows: [{ account: "1030", name: "Банк", balance: "1 000" }, { code: "1010", title: "Касса", amount: 250 }] })).toEqual([
			{ account: "1030", name: "Банк", balance: 1000 },
			{ account: "1010", name: "Касса", balance: 250 },
		]);
	});
});
