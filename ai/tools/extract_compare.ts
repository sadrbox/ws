// Замер: извлечение документа из файла двумя путями — PDF целиком модели (прежний) и текст, извлечённый
// кодом (новый), — против эталонных JSON рядом с PDF (samples/bank/*.json).
//
//   node --experimental-strip-types --env-file=.env tools/extract_compare.ts [--mode file|text|both] samples/bank/*.pdf
//
// Сравнение по операциям: совпадение (дата, направление, сумма) как мультимножества, БИН второй стороны,
// арифметическая сверка. Плюс токены, время и оценка стоимости по ценам Claude Opus 5 ($5 / $25 за 1М).
// Каждый прогон — настоящий вызов модели и стоит денег.

import { readFile } from "node:fs/promises";
import { BankExtractor, isPurchase, type ExtractResult } from "../src/bank/extract.ts";
import { createContentReader } from "../src/extract/index.ts";
import type { Statement } from "../src/bank/schema.ts";

type Row = { file: string; mode: string; ok: boolean; lines: string; matched: string; bins: string; reconciled: string; inTok: number; outTok: number; usd: number; sec: number; note: string };

const key = (l: Statement["lines"][number]) => `${l.date}|${l.direction}|${l.amount.toFixed(2)}`;

function compare(got: Statement, want: Statement) {
	const pool = new Map<string, number>();
	for (const l of want.lines) pool.set(key(l), (pool.get(key(l)) ?? 0) + 1);
	let matched = 0;
	for (const l of got.lines) {
		const n = pool.get(key(l)) ?? 0;
		if (n > 0) { matched++; pool.set(key(l), n - 1); }
	}
	const wantBins = new Map(want.lines.map((l) => [key(l), l.counterparty.bin ?? ""]));
	const binsOk = got.lines.filter((l) => (wantBins.get(key(l)) ?? null) === (l.counterparty.bin ?? "")).length;
	const missing = [...pool.entries()].filter(([, n]) => n > 0).map(([k]) => k);
	return { matched, binsOk, missing };
}

async function main() {
	const args = process.argv.slice(2);
	const mi = args.indexOf("--mode");
	const mode = mi >= 0 ? args[mi + 1] : "both";
	const files = args.filter((a, i) => a !== "--mode" && i !== mi + 1);
	const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
	const model = process.env.BANK_EXTRACT_MODEL || process.env.LLM_MODEL || "claude-opus-5";
	if (!apiKey || !files.length) {
		console.error("нужны ANTHROPIC_API_KEY и PDF-файлы с эталонными JSON рядом");
		process.exit(2);
	}
	const readContent = createContentReader();
	const modes = mode === "both" ? ["file", "text"] : [mode];
	const rows: Row[] = [];
	for (const f of files) {
		const want = (JSON.parse(await readFile(f.replace(/\.pdf$/i, ".json"), "utf8")) as { statement: Statement }).statement;
		const bytes = await readFile(f);
		for (const m of modes) {
			const ex = new BankExtractor({ apiKey, model, readContent, mode: m === "file" ? "file" : "auto" });
			const started = Date.now();
			const short = f.split("/").pop()!.slice(0, 28);
			try {
				const r: ExtractResult = await ex.extract(bytes, f.split("/").pop()!);
				if (isPurchase(r)) throw new Error("распознан как документ поставщика");
				const c = compare(r.statement, want);
				const usd = (r.usage.inputTokens * 5 + r.usage.outputTokens * 25) / 1e6;
				rows.push({
					file: short, mode: `${m}${m === "text" && r.input === "file" ? "→file" : ""}`, ok: c.matched === want.lines.length && r.statement.lines.length === want.lines.length,
					lines: `${r.statement.lines.length}/${want.lines.length}`, matched: `${c.matched}/${want.lines.length}`, bins: `${c.binsOk}/${r.statement.lines.length}`,
					reconciled: r.reconciliation.ok ? "да" : "НЕТ", inTok: r.usage.inputTokens, outTok: r.usage.outputTokens, usd, sec: (Date.now() - started) / 1000,
					note: c.missing.slice(0, 3).join(", "),
				});
			} catch (e) {
				rows.push({ file: short, mode: m, ok: false, lines: "-", matched: "-", bins: "-", reconciled: "-", inTok: 0, outTok: 0, usd: 0, sec: (Date.now() - started) / 1000, note: e instanceof Error ? e.message.slice(0, 120) : String(e) });
			}
			const last = rows.at(-1)!;
			console.log(`${last.file} [${last.mode}] строк ${last.lines}, совпало ${last.matched}, БИН ${last.bins}, сверка ${last.reconciled}, токены ${last.inTok}/${last.outTok}, $${last.usd.toFixed(3)}, ${last.sec.toFixed(0)} с ${last.note ? "— " + last.note : ""}`);
		}
	}
	console.log("\nфайл | путь | строк | совпало | БИН | сверка | вход | выход | $ | с");
	for (const r of rows) console.log([r.file, r.mode, r.lines, r.matched, r.bins, r.reconciled, r.inTok, r.outTok, r.usd.toFixed(3), r.sec.toFixed(0)].join(" | "));
	const total = rows.reduce((a, r) => a + r.usd, 0);
	console.log(`\nвсего ≈ $${total.toFixed(2)}`);
	process.exit(rows.every((r) => r.ok) ? 0 : 1);
}

main();
