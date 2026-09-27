import { describe, it, expect } from "vitest";
import { decodeStatementBytes } from "src/models/BankStatements/decodeStatement";

// Кодировщики для теста: TextEncoder умеет только UTF-8, а выписки 1С — однобайтовые.
function encodeSingleByte(text: string, enc: "cp1251" | "cp866"): Uint8Array {
	const out: number[] = [];
	for (const ch of text) {
		const c = ch.codePointAt(0)!;
		if (c < 0x80) { out.push(c); continue; }
		if (enc === "cp1251") {
			if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
			else if (c === 0x401) out.push(0xa8);
			else if (c === 0x451) out.push(0xb8);
			else throw new Error(`нет в тестовой таблице: ${ch}`);
		} else {
			if (c >= 0x410 && c <= 0x43f) out.push(c - 0x410 + 0x80);
			else if (c >= 0x440 && c <= 0x44f) out.push(c - 0x440 + 0xe0);
			else throw new Error(`нет в тестовой таблице: ${ch}`);
		}
	}
	return new Uint8Array(out);
}

const sample = (encoding: string) => [
	"1CClientBankExchange",
	"ВерсияФормата=1.03",
	`Кодировка=${encoding}`,
	"РасчСчет=KZ123",
	"СекцияДокумент=Платежное поручение",
	"Номер=15",
	"Плательщик=ТОО Ромашка",
	"КонецДокумента",
	"КонецФайла",
].join("\r\n");

describe("decodeStatementBytes — кодировка выписки (И18)", () => {
	it("Кодировка=Windows: windows-1251 читается без «�» (раньше file.text() давал 0 строк)", () => {
		const text = sample("Windows");
		const bytes = encodeSingleByte(text, "cp1251");
		// Так читал файл прежний код — ключи разрушены.
		expect(new TextDecoder("utf-8").decode(bytes)).not.toContain("СекцияДокумент");
		const decoded = decodeStatementBytes(bytes);
		expect(decoded).toBe(text);
		expect(decoded).toContain("СекцияДокумент=Платежное поручение");
	});

	it("Кодировка=DOS: cp866", () => {
		const text = sample("DOS");
		expect(decodeStatementBytes(encodeSingleByte(text, "cp866"))).toBe(text);
	});

	it("UTF-8 (и с BOM) остаётся как есть", () => {
		const text = sample("Windows");
		const utf8 = new TextEncoder().encode(text);
		expect(decodeStatementBytes(utf8)).toBe(text);
		const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
		// TextDecoder снимает BOM сам.
		expect(decodeStatementBytes(withBom.buffer)).toBe(text);
	});

	it("CSV без заголовка в windows-1251 — по умолчанию windows-1251", () => {
		const csv = "Дата;Сумма;Назначение\r\n01.09.2026;100,00;Оплата";
		expect(decodeStatementBytes(encodeSingleByte(csv, "cp1251"))).toBe(csv);
	});
});
