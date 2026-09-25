/**
 * Выписка лицевого счёта из кабинета налогоплательщика (КН) → строки «КБК — наименование —
 * сальдо» для сверки с расчётами с бюджетом в 1С (E17 СК2.5, п. 11 стандарта).
 *
 * ПРОВЕРИТЬ ПОТОМ: формат выписки из КНП не известен — нужен образец файла. Поэтому разбор
 * терпимый: строка заголовков ищется в первых строках листа (над таблицей бывает шапка
 * документа), колонки узнаются по синонимам и началу слова («Сальдо на 01.09.2026»), а если
 * сальдо в файле нет, но есть «Переплата» и «Задолженность» — сальдо = переплата − долг.
 *
 * ЗНАК — как в выписке КН: «+» переплата, «−» задолженность. Сервер приводит 1С к тому же
 * знаку (findingRules.compareKn), поэтому здесь знак не переворачиваем.
 */
import { mapRowsByHeader } from "src/utils/sheetIO";
import { asText } from "src/utils/asText";
import { translate } from "src/i18";

export type KnField = "kbk" | "name" | "balance" | "overpay" | "debt";

/** Строка выписки в редакторе: всё строками, как в полях ввода. */
export interface KnDraftRow {
	key: string;
	kbk: string;
	name: string;
	balance: string;
}

let seq = 0;
export const newKnRowKey = (): string => `kn-${Date.now().toString(36)}-${(seq++).toString(36)}`;
export const emptyKnRow = (): KnDraftRow => ({ key: newKnRowKey(), kbk: "", name: "", balance: "" });

/** Заголовок без регистра, пробелов и знаков: «Сальдо (+/−)» → «сальдо». */
export const normHeader = (v: unknown): string =>
	asText(v).toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");

type Matcher = { field: KnField; exact?: string[]; prefix?: string[]; includes?: string[] };

/**
 * Правила узнавания колонок — ПО ПОРЯДКУ: «Наименование КБК» — это наименование, а не КБК,
 * поэтому наименование проверяется раньше «содержит кбк». Русские и казахские варианты.
 */
const MATCHERS: Matcher[] = [
	{ field: "name", prefix: ["наименован", "названи", "видналог", "видплатеж", "атауы", "салықатау", "салықтыңатау"] },
	{ field: "kbk", exact: ["бск"], includes: ["кбк", "kbk"], prefix: ["кодбюджетн", "бюджеттіксыныптам"] },
	{ field: "balance", prefix: ["сальдо", "итоговоесальдо", "конечноесальдо", "исходящеесальдо", "saldo", "balance", "қалдық", "остаток"] },
	{ field: "overpay", prefix: ["переплат", "артықтөл"] },
	{ field: "debt", prefix: ["задолжен", "недоимк", "берешек", "қарыз"] },
	{ field: "name", exact: ["налог", "налоги", "салық", "name"] },
];

/** Какое поле выписки в этой ячейке заголовка (null — не наше). */
export function classifyHeader(cell: unknown): KnField | null {
	const h = normHeader(cell);
	if (!h) return null;
	for (const m of MATCHERS) {
		if (m.exact?.includes(h)) return m.field;
		if (m.prefix?.some((p) => h.startsWith(p))) return m.field;
		if (m.includes?.some((p) => h.includes(p))) return m.field;
	}
	return null;
}

/** Признаки ИТОГОВОГО сальдо: в выписке бывает и «на начало», и «на конец». */
const CLOSING = ["конец", "конечн", "исходящ", "итог", "надату", "соңы", "аяғы", "соңғы"];

export interface KnHeader {
	row: number;
	columns: Partial<Record<KnField, number>>;
}

/**
 * Строка заголовков: первая в пределах `maxScan` строк, где есть сумма (сальдо либо переплата/
 * долг) и ключ (КБК или наименование). Из нескольких колонок сальдо берётся итоговая
 * («на конец», «на дату»), иначе — последняя: итог в таблицах стоит правее.
 */
export function locateKnHeader(aoa: readonly unknown[][], maxScan = 30): KnHeader | null {
	for (let r = 0; r < Math.min(aoa.length, maxScan); r++) {
		const cols: Partial<Record<KnField, number>> = {};
		const balances: number[] = [];
		(aoa[r] ?? []).forEach((cell, c) => {
			const f = classifyHeader(cell);
			if (!f) return;
			if (f === "balance") balances.push(c);
			else if (f === "overpay" || f === "debt") cols[f] = c; // итоговые правее — берём последнюю
			else if (cols[f] === undefined) cols[f] = c;
		});
		if (balances.length) {
			const closing = balances.find((c) => CLOSING.some((w) => normHeader(aoa[r]?.[c]).includes(w)));
			cols.balance = closing ?? balances[balances.length - 1];
		}
		const hasAmount = cols.balance !== undefined || cols.overpay !== undefined || cols.debt !== undefined;
		if (hasAmount && (cols.kbk !== undefined || cols.name !== undefined)) return { row: r, columns: cols };
	}
	return null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Сумма из ячейки: «1 234,56», «-1234.56», «(1 234,56)» и «1 234,56-» (минус бухгалтерский),
 * «1,234,567.89». Не число — null.
 */
export function parseAmount(v: unknown): number | null {
	let s = asText(v).trim();
	if (!s) return null;
	let negative = false;
	if (/^\(.*\)$/.test(s)) {
		negative = true;
		s = s.slice(1, -1);
	}
	s = s.replace(/[\s\u00A0\u202F]/g, "").replace(/[\u2212\u2013\u2014]/g, "-");
	if (s.length > 1 && s.endsWith("-") && !s.startsWith("-")) {
		negative = true;
		s = s.slice(0, -1);
	}
	s = s.replace(/[^\d.,+-]/g, "");
	const commas = (s.match(/,/g) ?? []).length;
	const dots = (s.match(/\./g) ?? []).length;
	if (commas && dots) {
		// Последний из разделителей — десятичный, первый — разряды.
		s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
	} else if (commas > 1) {
		s = s.replace(/,/g, "");
	} else if (commas === 1) {
		s = s.replace(",", ".");
	} else if (dots > 1) {
		s = s.replace(/\./g, "");
	}
	if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
	const n = Number(s);
	if (!Number.isFinite(n)) return null;
	return round2(negative ? -Math.abs(n) : n);
}

/** Строка итогов выписки («Итого», «Всего», «Барлығы») — не налог, в сверку не идёт. */
const isTotalRow = (kbk: string, name: string): boolean =>
	!kbk && /^(итог|всего|барлығы|жиыны|total)/i.test(name.trim());

export interface KnSheetResult {
	rows: KnDraftRow[];
	/** Непустые строки, которые не удалось прочитать (нет ключа или суммы, строка итогов). */
	skipped: number;
	/** Строка заголовков не найдена — файл не похож на выписку. */
	noHeader: boolean;
}

/** Лист книги (readWorkbookAoa) → строки выписки. */
export function mapKnSheet(aoa: readonly unknown[][]): KnSheetResult {
	const header = locateKnHeader(aoa);
	if (!header) return { rows: [], skipped: 0, noHeader: true };
	// Канонический заголовок: в найденных колонках — имена полей, и дальше общий mapRowsByHeader.
	const width = aoa.slice(header.row).reduce((w, r) => Math.max(w, (r ?? []).length), 0);
	const canon: string[] = Array.from({ length: width }, () => "");
	for (const [f, c] of Object.entries(header.columns)) if (c !== undefined) canon[c] = f;
	const records = mapRowsByHeader([canon, ...aoa.slice(header.row + 1)], {
		kbk: ["kbk"], name: ["name"], balance: ["balance"], overpay: ["overpay"], debt: ["debt"],
	});
	const rows: KnDraftRow[] = [];
	let skipped = 0;
	for (const rec of records) {
		const kbk = (rec.kbk ?? "").replace(/\s+/g, "");
		const name = (rec.name ?? "").trim();
		if ((!kbk && !name) || isTotalRow(kbk, name)) {
			skipped++;
			continue;
		}
		let balance = parseAmount(rec.balance);
		if (balance === null && (rec.overpay || rec.debt)) {
			const over = parseAmount(rec.overpay) ?? 0;
			const debt = parseAmount(rec.debt) ?? 0;
			balance = round2(Math.abs(over) - Math.abs(debt));
		}
		if (balance === null) {
			skipped++;
			continue;
		}
		rows.push({ key: newKnRowKey(), kbk, name, balance: String(balance) });
	}
	return { rows, skipped, noHeader: false };
}

export type KnRowsResult =
	| { ok: true; rows: { kbk: string | null; name: string | null; balance: number }[] }
	| { ok: false; error: "noRows" | "badBalance" | "noKey"; row?: number };

/**
 * Строки редактора → тело запроса. Совсем пустые строки молча отбрасываются; строка с ключом
 * без суммы или с суммой без ключа — ошибка с номером строки (сервер такие тихо выбросил бы).
 */
export function knRowsToPayload(drafts: readonly KnDraftRow[]): KnRowsResult {
	const rows: { kbk: string | null; name: string | null; balance: number }[] = [];
	for (let i = 0; i < drafts.length; i++) {
		const d = drafts[i];
		const kbk = d.kbk.trim();
		const name = d.name.trim();
		const raw = d.balance.trim();
		if (!kbk && !name && !raw) continue;
		if (!kbk && !name) return { ok: false, error: "noKey", row: i + 1 };
		const balance = parseAmount(raw);
		if (balance === null) return { ok: false, error: "badBalance", row: i + 1 };
		rows.push({ kbk: kbk || null, name: name || null, balance });
	}
	if (!rows.length) return { ok: false, error: "noRows" };
	return { ok: true, rows };
}

/** Текст ошибки строк для <Notice /> формы. */
export function knRowsErrorText(r: Extract<KnRowsResult, { ok: false }>): string {
	const key = r.error === "noRows" ? "knNoRows" : r.error === "noKey" ? "knRowNoKey" : "knRowBadBalance";
	return translate(key).replace("{n}", String(r.row ?? ""));
}

/** Сохранённые строки выписки (сервер) → строки редактора. */
export function toKnDrafts(rows: readonly { kbk?: string | null; name?: string | null; balance?: number | string | null }[] | null | undefined): KnDraftRow[] {
	return (rows ?? []).map((r) => ({ key: newKnRowKey(), kbk: asText(r.kbk), name: asText(r.name), balance: asText(r.balance) }));
}

export type KnResultState = "ok" | "mismatch" | "unmatched";

/** Итог строки сравнения: сошлось; расхождение; в 1С такой строки нет (не сопоставилась). */
export function knResultState(r: { ok: boolean; matched: boolean }): KnResultState {
	if (r.ok) return "ok";
	return r.matched ? "mismatch" : "unmatched";
}

const RESULT_KEYS: Record<KnResultState, string> = { ok: "knResultOk", mismatch: "knResultMismatch", unmatched: "knResultUnmatched" };
export const knResultLabel = (s: KnResultState): string => translate(RESULT_KEYS[s]);

export interface KnTotals { kn: number; onec: number; diff: number; ok: number; mismatches: number; unmatched: number }

/** Итоги сравнения: суммы по выписке и по 1С (где сопоставлено), расхождения. */
export function knTotals(rows: readonly { knBalance: number; onecBalance: number | null; diff: number | null; ok: boolean; matched: boolean }[]): KnTotals {
	let kn = 0;
	let onec = 0;
	let diff = 0;
	let ok = 0;
	let unmatched = 0;
	for (const r of rows) {
		kn += Number(r.knBalance) || 0;
		if (r.onecBalance !== null && r.onecBalance !== undefined) onec += Number(r.onecBalance) || 0;
		if (r.diff !== null && r.diff !== undefined) diff += Number(r.diff) || 0;
		if (r.ok) ok++;
		if (!r.matched) unmatched++;
	}
	return { kn: round2(kn), onec: round2(onec), diff: round2(diff), ok, mismatches: rows.length - ok, unmatched };
}
