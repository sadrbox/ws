// Колонки таблиц без перевода: заголовок колонки берётся из словаря по её identifier
// (i18.getTranslateColumn), и без записи в словаре человек видит в шапке служебное имя поля.
//
// Был `check_translations.js` в корне пакета: он не запускался вовсе (CommonJS-синтаксис в пакете с
// "type": "module" — «require is not defined»). Перенесён в scripts/ рядом с остальными проверками и переписан.
//
// Запуск: node scripts/check-columns-i18.mjs [--strict]
// `--strict` — ненулевой код возврата, когда что-то не переведено (для CI; в verify пока не включено).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dict = JSON.parse(readFileSync(path.join(root, "src/i18/translations.json"), "utf8"));

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
	const p = path.join(dir, f.name);
	return f.isDirectory() ? walk(p) : f.name.endsWith("olumns.json") ? [p] : [];
});

const missing = new Map();
for (const file of walk(path.join(root, "src/models"))) {
	const columns = JSON.parse(readFileSync(file, "utf8"));
	const where = path.relative(path.join(root, "src/models"), file);
	for (const c of columns) {
		// Служебные колонки («__rowActions») заголовка не имеют — их словарь не касается.
		if (!c.identifier || c.identifier.startsWith("__") || dict[c.identifier]) continue;
		missing.set(c.identifier, [...(missing.get(c.identifier) ?? []), where]);
	}
}

if (!missing.size) {
	console.log("✓ колонки таблиц: заголовки переведены все");
	process.exit(0);
}
console.log("Нет в словаре (заголовок колонки покажет имя поля):");
for (const [id, files] of [...missing].sort()) console.log(`  ${id} — ${files.join(", ")}`);
console.log(`\nВсего: ${missing.size}`);
process.exit(process.argv.includes("--strict") ? 1 : 0);
