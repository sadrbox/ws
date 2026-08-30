// Прогон извлечения выписки на PDF-файлах без сервиса и без 1С.
//
//   node --experimental-strip-types --env-file=.env tools/bank_extract.ts samples/bank/*.pdf [--json out_dir]
//
// Печатает сводку, сверку и первые строки; с --json пишет полный Statement рядом с PDF.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BankExtractor } from "../src/bank/extract.ts";
import { summarize, fmt } from "../src/bank/schema.ts";

async function main() {
	const args = process.argv.slice(2);
	const jsonIdx = args.indexOf("--json");
	const outDir = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
	const files = args.filter((a, i) => a !== "--json" && i !== jsonIdx + 1);
	if (!files.length) {
		console.error("укажите PDF-файлы");
		process.exit(2);
	}
	const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
	const model = process.env.BANK_EXTRACT_MODEL || process.env.LLM_MODEL || "claude-opus-5";
	if (!apiKey) {
		console.error("ANTHROPIC_API_KEY не задан");
		process.exit(2);
	}
	const extractor = new BankExtractor({ apiKey, model });
	let failures = 0;
	for (const f of files) {
		const started = Date.now();
		process.stdout.write(`\n=== ${f} ===\n`);
		try {
			const r = await extractor.extract(await readFile(f), path.basename(f));
			console.log(summarize(r.statement, r.reconciliation));
			console.log(`модель ${r.model}, токены in=${r.usage.inputTokens} out=${r.usage.outputTokens}, ${((Date.now() - started) / 1000).toFixed(1)} с`);
			for (const [i, l] of r.statement.lines.entries()) {
				if (i >= 8) { console.log(`  … ещё ${r.statement.lines.length - 8}`); break; }
				console.log(`  ${l.date} ${l.direction === "in" ? "+" : "-"}${fmt(l.amount)} ${l.counterparty.name}${l.counterparty.bin ? ` (${l.counterparty.bin})` : ""} КНП ${l.knp ?? "—"} №${l.number ?? "—"} — ${(l.purpose ?? "").slice(0, 60)}`);
			}
			if (!r.reconciliation.ok) { console.log("ПРОБЛЕМЫ:"); for (const p of r.reconciliation.problems) console.log("  - " + p); }
			if (outDir) await writeFile(path.join(outDir, path.basename(f, ".pdf") + ".json"), JSON.stringify({ statement: r.statement, reconciliation: r.reconciliation }, null, 2), "utf8");
		} catch (e) {
			failures++;
			console.log("ОШИБКА:", e instanceof Error ? e.message : e);
		}
	}
	process.exit(failures ? 1 : 0);
}

main();
