// Листы XLSX → строки ячеек, без сторонних библиотек.
//
// Из всего формата нужно немного: имена листов, общие строки, значения ячеек и признак «это дата»
// (в XLSX дата — число дней с 1900 года, отличить её от суммы можно только по формату ячейки). Формулы
// не вычисляются: берётся сохранённое Excel значение. Объединённые ячейки, стили и картинки не нужны.

import { ContentError, type FileContent, type Sheet } from "./content.ts";
import { ZipReader, type ZipLimits } from "./zip.ts";

export type XlsxLimits = ZipLimits & { maxRows: number; maxCols: number; maxChars: number };

export function readXlsx(bytes: Buffer, limits: XlsxLimits): FileContent {
	const started = Date.now();
	const zip = new ZipReader(bytes, limits);
	const workbook = zip.text("xl/workbook.xml");
	if (!workbook) throw new ContentError("XLSX_BROKEN", "В файле нет книги Excel (xl/workbook.xml)");
	const rels = relationships(zip.text("xl/_rels/workbook.xml.rels") ?? "");
	const shared = sharedStrings(zip.text("xl/sharedStrings.xml") ?? "");
	const dateStyles = dateStyleIndexes(zip.text("xl/styles.xml") ?? "");
	const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbook);

	const sheets: Sheet[] = [];
	let chars = 0;
	let totalRows = 0;
	for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
		const attrs = m[1];
		if (/\bstate="(?:hidden|veryHidden)"/.test(attrs)) continue;
		const name = xmlDecode(attr(attrs, "name") ?? "Лист");
		const rid = attr(attrs, "r:id");
		const target = rid ? rels.get(rid) : undefined;
		if (!target) continue;
		const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
		const xml = zip.text(path);
		if (!xml) continue;
		const { rows, rowNumbers } = sheetRows(xml, shared, dateStyles, date1904, limits);
		totalRows += rows.length;
		chars += rows.reduce((a, r) => a + r.reduce((b, c) => b + c.length, 0), 0);
		if (chars > limits.maxChars) throw new ContentError("TOO_MUCH_TEXT", `Текста в XLSX больше предела (${limits.maxChars} знаков)`);
		sheets.push({ name, rows, rowNumbers });
	}
	return { kind: "xlsx", hasText: chars > 0, sheets, stats: { sheets: sheets.length, rows: totalRows, chars, ms: Date.now() - started } };
}

function sheetRows(xml: string, shared: string[], dateStyles: Set<number>, date1904: boolean, limits: XlsxLimits): { rows: string[][]; rowNumbers: number[] } {
	const grid = new Map<number, Map<number, string>>();
	let maxCol = -1;
	for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
		const attrs = m[1];
		const body = m[2] ?? "";
		const ref = attr(attrs, "r");
		const pos = ref ? cellPosition(ref) : null;
		if (!pos) continue;
		if (pos.row >= limits.maxRows) throw new ContentError("XLSX_LIMIT", `На листе больше ${limits.maxRows} строк`);
		if (pos.col >= limits.maxCols) continue;
		const value = cellValue(attr(attrs, "t"), Number(attr(attrs, "s") ?? 0), body, shared, dateStyles, date1904);
		if (value === "") continue;
		let row = grid.get(pos.row);
		if (!row) grid.set(pos.row, (row = new Map()));
		row.set(pos.col, value);
		if (pos.col > maxCol) maxCol = pos.col;
	}
	// Пустые строки выбрасываем, но колонки не сдвигаем: пустая ячейка между значениями — тоже колонка.
	const order = [...grid.keys()].sort((a, b) => a - b);
	const rows = order.map((r) => {
		const row = grid.get(r)!;
		const last = Math.max(...row.keys());
		return Array.from({ length: last + 1 }, (_, c) => row.get(c) ?? "");
	});
	return { rows, rowNumbers: order.map((r) => r + 1) };
}

function cellValue(type: string | undefined, style: number, body: string, shared: string[], dateStyles: Set<number>, date1904: boolean): string {
	if (type === "inlineStr") return richText(body);
	const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
	if (v === undefined) return "";
	switch (type) {
		case "s": return shared[Number(v)] ?? "";
		case "str": case "e": return xmlDecode(v).trim();
		case "b": return v === "1" ? "ИСТИНА" : "ЛОЖЬ";
	}
	const n = Number(v);
	if (!Number.isFinite(n)) return xmlDecode(v).trim();
	if (dateStyles.has(style)) return serialDate(n, date1904);
	// 0.1 + 0.2 в Excel хранится как 0.30000000000000004 — модели нужна сумма, а не шум двоичной дроби.
	return String(Number(n.toPrecision(15)));
}

/** Дата Excel → YYYY-MM-DD (время отбрасывается). 1900-я система учитывает мнимое 29.02.1900 Excel. */
export function serialDate(n: number, date1904: boolean): string {
	const days = Math.floor(n);
	const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
	return new Date(epoch + days * 86_400_000).toISOString().slice(0, 10);
}

function sharedStrings(xml: string): string[] {
	return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1]));
}

/** Текст из <t> (включая форматированные фрагменты <r><t>); фонетика (<rPh>) не нужна. */
function richText(xml: string): string {
	const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
	return [...clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join("").trim();
}

/** Индексы стилей ячеек (cellXfs), чей числовой формат — дата. */
function dateStyleIndexes(xml: string): Set<number> {
	const custom = new Map<number, string>();
	for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
		const id = Number(attr(m[1], "numFmtId"));
		const code = attr(m[1], "formatCode");
		if (Number.isFinite(id) && code) custom.set(id, xmlDecode(code));
	}
	const out = new Set<number>();
	const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
	[...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].forEach((m, i) => {
		const id = Number(attr(m[1], "numFmtId") ?? 0);
		if (isDateFormat(id, custom.get(id))) out.add(i);
	});
	return out;
}

export function isDateFormat(id: number, code: string | undefined): boolean {
	if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
	if (!code) return false;
	// Без текста в кавычках, экранированных знаков и [цвет]/[$-419]: иначе «руб.» или [Red] сойдут за дату.
	const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
	return /[dmyДМГ]/i.test(bare) && !/^general$/i.test(bare.trim());
}

function relationships(xml: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
		const id = attr(m[1], "Id");
		const target = attr(m[1], "Target");
		if (id && target) out.set(id, xmlDecode(target));
	}
	return out;
}

function cellPosition(ref: string): { row: number; col: number } | null {
	const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(ref);
	if (!m) return null;
	let col = 0;
	for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
	return { row: Number(m[2]) - 1, col: col - 1 };
}

function attr(attrs: string, name: string): string | undefined {
	const esc = name.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&");
	return new RegExp(`(?:^|\\s)${esc}="([^"]*)"`).exec(attrs)?.[1];
}

function xmlDecode(s: string): string {
	return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_m, hex: string, dec: string, name: string) => {
		if (hex) return String.fromCodePoint(parseInt(hex, 16));
		if (dec) return String.fromCodePoint(Number(dec));
		return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" } as Record<string, string>)[name.toLowerCase()];
	});
}
