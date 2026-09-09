#!/usr/bin/env node
/**
 * Линт CSS-модулей: ловит две ошибки, которые ничего не стоят компилятору и дорого
 * стоят потом.
 *
 *   1) СОВПАДЕНИЕ ИМЁН С ОБЩИМИ ХЕЛПЕРАМИ. `src/styles/variables.scss` подмешивается
 *      в КАЖДЫЙ scss (vite.config.ts → additionalData), и объявленные в нём классы
 *      (.GroupRow, .Group, .primary…) попадают в каждый модуль. Одноимённый класс в
 *      модуле получает то же сгенерированное имя и молча забирает чужие правила: так
 *      строка таблицы однажды стала флекс-контейнером и разметка группы разъехалась.
 *
 *   2) ССЫЛКА НА НЕСУЩЕСТВУЮЩИЙ КЛАСС. `styles.X` типизирован как Record<string,string>,
 *      поэтому опечатка или удалённое правило дают `undefined`, который тихо выпадает
 *      из className. Ошибку видно только глазами и только если повезёт.
 *
 * Плюс мягкий отчёт: классы, объявленные в модуле, но не используемые из кода.
 *
 * Запуск: node scripts/css-modules-lint.mjs [--strict-all]
 *   без флага строгие проверки применяются к STRICT_SCOPE (компонент Table), остальным
 *   модулям — предупреждения: в проекте уже есть исторические совпадения, и чинить их
 *   надо отдельной задачей, а не ценой красного verify.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = "src";
const SHARED = "src/styles/variables.scss";
/** Где совпадения и битые ссылки — ОШИБКА, а не предупреждение. */
const STRICT_SCOPE = ["src/components/Table"];

const strictAll = process.argv.includes("--strict-all");

/** Убираем комментарии: имена из пояснений — не объявления. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const walk = (dir, out = []) => {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
};

const files = walk(SRC);
const modules = files.filter((f) => f.endsWith(".module.scss"));
const code = files.filter((f) => /\.(tsx|ts)$/.test(f));

// ── Классы общих хелперов ───────────────────────────────────────────────────
const sharedClasses = new Set(
	[...strip(fs.readFileSync(SHARED, "utf8")).matchAll(/^\s*\.([A-Za-z][\w-]*)/gm)].map((m) => m[1]),
);

/**
 * Объявленные классы модуля: и `.Name`, и вложенные `&.Name`, и составные `.A.B`.
 *
 * Идём по `@use`/`@forward`/`@import`: стиль компонента может быть разложен на части
 * (так разрезан `<Table />`), и классы из этих частей попадают в тот же модуль.
 * Общие хелперы добавляем каждому модулю: они и правда там есть — variables.scss
 * подмешивается ко всем, поэтому `styles.GroupRow` работает, даже если сам модуль
 * такого класса не объявляет.
 */
const declaredIn = (file, seen = new Set()) => {
	const real = path.normalize(file);
	if (seen.has(real)) return new Set();
	seen.add(real);
	const css = strip(fs.readFileSync(real, "utf8"));
	// Строки подключений выбрасываем до поиска классов: иначе «.scss» из пути и
	// псевдоним из `as frame` посчитались бы объявленными классами.
	const rules = css.replace(/^\s*@(?:use|forward|import)[^;]*;\s*$/gm, "");
	const own = new Set([...rules.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
	for (const [, rel] of css.matchAll(/@(?:use|forward|import)\s+["']([^"']+)["']/g)) {
		if (rel.includes("variables")) continue; // общие классы учтены отдельно
		const dir = path.dirname(real);
		const candidates = [rel, rel + ".scss", "_" + rel + ".scss"]
			.map((r) => path.normalize(path.join(dir, r)))
			.filter((f) => fs.existsSync(f));
		if (candidates.length) for (const c of declaredIn(candidates[0], seen)) own.add(c);
	}
	return own;
};

const declaredWithShared = (file) => {
	const own = declaredIn(file);
	return { own, all: new Set([...own, ...sharedClasses]) };
};

/** Ссылки вида styles.Name / styles["Name"] в файле, который импортирует этот модуль. */
const usedFrom = (file) => {
	const src = fs.readFileSync(file, "utf8");
	const imports = [...src.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+\.module\.scss)["']/g)];
	const out = [];
	for (const [, alias, rel] of imports) {
		const target = path.normalize(path.join(path.dirname(file), rel));
		const names = new Set([
			...[...src.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z][\\w]*)`, "g"))].map((m) => m[1]),
			...[...src.matchAll(new RegExp(`\\b${alias}\\[["']([^"']+)["']\\]`, "g"))].map((m) => m[1]),
		]);
		out.push({ target, names });
	}
	return out;
};

const inStrictScope = (file) => strictAll || STRICT_SCOPE.some((d) => file.startsWith(d));

const errors = [];
const warnings = [];
const unusedReport = [];

// ── 1. Совпадения с общими хелперами ────────────────────────────────────────
const declaredCache = new Map();
for (const m of modules) {
	const declared = declaredWithShared(m);
	declaredCache.set(m, declared);
	const clash = [...declared.own].filter((c) => sharedClasses.has(c)).sort();
	if (!clash.length) continue;
	const line = `${m}: класс(ы) ${clash.join(", ")} объявлены и в ${SHARED} — модуль молча получит чужие правила`;
	(inStrictScope(m) ? errors : warnings).push(line);
}

// ── 2. Ссылки на несуществующие классы ──────────────────────────────────────
const usedByModule = new Map();
for (const f of code) {
	for (const { target, names } of usedFrom(f)) {
		if (!declaredCache.has(target)) continue;
		const set = usedByModule.get(target) ?? new Set();
		for (const n of names) set.add(n);
		usedByModule.set(target, set);
		const missing = [...names].filter((n) => !declaredCache.get(target).all.has(n)).sort();
		if (!missing.length) continue;
		const line = `${f}: styles.${missing.join(", styles.")} — нет такого класса в ${target}`;
		(inStrictScope(f) ? errors : warnings).push(line);
	}
}

// ── 3. Мягкий отчёт: объявлено, но не используется ──────────────────────────
for (const m of modules) {
	if (!inStrictScope(m)) continue;
	const used = usedByModule.get(m) ?? new Set();
	const unused = [...declaredCache.get(m).own].filter((c) => !used.has(c) && !sharedClasses.has(c)).sort();
	if (unused.length) unusedReport.push(`${m}: не используются из кода (${unused.length}): ${unused.join(", ")}`);
}

// ── Вывод ───────────────────────────────────────────────────────────────────
console.log("── css-modules-lint ──────────────────────────────────────");
console.log(`модулей: ${modules.length}, общих классов в variables.scss: ${sharedClasses.size}`);

if (unusedReport.length) {
	console.log("\n[отчёт] Объявлены, но не используются:");
	for (const l of unusedReport) console.log("  " + l);
}
if (warnings.length) {
	console.log(`\n[предупреждения] ${warnings.length} (вне строгой области):`);
	for (const l of warnings) console.log("  " + l);
}
if (errors.length) {
	console.log(`\n[ОШИБКИ] ${errors.length}:`);
	for (const l of errors) console.log("  " + l);
	console.log("\n✗ css-modules-lint не пройден");
	process.exit(1);
}
console.log("\n✓ css-modules-lint пройден");
