#!/usr/bin/env node
/**
 * i18-линт: проверяет переводы (src/i18) на:
 *   1) ПАРИТЕТ RU↔KK — ключи, которых нет во втором языке;
 *   2) ОТСУТСТВУЮЩИЕ — ключи, используемые в коде (translate("…")/getTranslation
 *      /идентификаторы колонок *Columns.json), но отсутствующие в RU;
 *   3) ВОЗМОЖНО НЕИСПОЛЬЗУЕМЫЕ — ключи RU, не встречающиеся в исходниках как
 *      строковый литерал (мягкое предупреждение: динамические translate(var)
 *      сюда не попадают — это норма).
 *
 * Запуск: node scripts/i18-lint.mjs   (из каталога frontend)
 * Код выхода 1 при паритете/отсутствующих (для CI), 0 — если только «unused».
 */
import fs from "node:fs";
import path from "node:path";

const RU_PATH = "src/i18/translations.json";
const KK_PATH = "src/i18/translations.kk.json";

const ru = JSON.parse(fs.readFileSync(RU_PATH, "utf8"));
const kk = JSON.parse(fs.readFileSync(KK_PATH, "utf8"));
const ruKeys = new Set(Object.keys(ru));
const kkKeys = new Set(Object.keys(kk));

// ── Рекурсивный обход src ──────────────────────────────────────────────────
function walk(dir, exts) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
		const p = path.join(dir, d.name);
		if (d.isDirectory()) return walk(p, exts);
		return exts.some((e) => d.name.endsWith(e)) ? [p] : [];
	});
}

const codeFiles = walk("src", [".ts", ".tsx"]).filter((f) => !f.endsWith(".d.ts"));
const allSource = codeFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

// ── Используемые ключи: translate("X") / getTranslation("X") ───────────────
const usedKeys = new Set();
for (const m of allSource.matchAll(/\b(?:translate|getTranslation)\(\s*["'`]([\w.-]+)["'`]/g)) {
	usedKeys.add(m[1]);
}
// Идентификаторы колонок (*Columns.json / columns.json) тоже переводятся.
for (const jf of walk("src/models", ["olumns.json"])) {
	try {
		for (const c of JSON.parse(fs.readFileSync(jf, "utf8"))) {
			if (c && c.identifier) usedKeys.add(String(c.identifier));
		}
	} catch { /* пропускаем битый json */ }
}

// ── 1. Паритет RU ↔ KK ─────────────────────────────────────────────────────
const ruNotKk = [...ruKeys].filter((k) => !kkKeys.has(k)).sort();
const kkNotRu = [...kkKeys].filter((k) => !ruKeys.has(k)).sort();

// ── 2. Используются в коде, но нет в RU ────────────────────────────────────
const missing = [...usedKeys].filter((k) => !ruKeys.has(k)).sort();

// ── 3. Возможно неиспользуемые (нет как литерал в исходниках) ──────────────
const literalSet = new Set();
for (const m of allSource.matchAll(/["'`]([\w.-]+)["'`]/g)) literalSet.add(m[1]);
const maybeUnused = [...ruKeys].filter((k) => !literalSet.has(k)).sort();

// ── Отчёт ──────────────────────────────────────────────────────────────────
const log = (t) => console.log(t);
log("── i18-lint ──────────────────────────────────────────────");
log(`RU: ${ruKeys.size} ключей · KK: ${kkKeys.size} ключей · использовано в коде: ${usedKeys.size}`);

log(`\n[1] Паритет RU↔KK`);
log(`  нет в KK (есть в RU): ${ruNotKk.length}`);
if (ruNotKk.length) log("    " + ruNotKk.slice(0, 40).join(", ") + (ruNotKk.length > 40 ? " …" : ""));
log(`  нет в RU (есть в KK): ${kkNotRu.length}`);
if (kkNotRu.length) log("    " + kkNotRu.slice(0, 40).join(", ") + (kkNotRu.length > 40 ? " …" : ""));

log(`\n[2] Используются в коде, но НЕТ в RU: ${missing.length}`);
if (missing.length) log("    " + missing.join(", "));

log(`\n[3] Возможно неиспользуемые ключи RU (мягко, без динамических): ${maybeUnused.length}`);
if (maybeUnused.length) log("    " + maybeUnused.slice(0, 60).join(", ") + (maybeUnused.length > 60 ? " …" : ""));

// Жёсткие ошибки → код выхода 1.
const hardErrors = ruNotKk.length + kkNotRu.length + missing.length;
log("\n" + (hardErrors === 0 ? "✓ Паритет соблюдён, отсутствующих ключей нет." : `✗ Проблем (паритет+отсутствующие): ${hardErrors}`));
process.exit(hardErrors === 0 ? 0 : 1);
