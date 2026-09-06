/**
 * Проверка расширений в относительных импортах.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ПРОВЕРКА. Сервис запускается из ИСХОДНИКОВ (`node
 * --experimental-strip-types src/server.ts`), поэтому путь в импорте должен указывать на
 * реально существующий файл — `./x.ts`. А `tsc --noEmit` считает `./x.js` правильным
 * (он умеет разрешать его в `x.ts`) и молчит. Итог был ровно такой: `verify` зелёный,
 * тесты зелёные, а сервис падает при старте с ERR_MODULE_NOT_FOUND — и весь
 * «Администрирование 1С» отвечает 502 с потерей заголовков CORS.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["src", "tools", "tests"];
const RELATIVE_IMPORT = /(?:from|import)\s+["'](\.[^"']+)["']/g;

async function* walk(dir) {
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.name.endsWith(".ts") || e.name.endsWith(".mjs")) yield p;
	}
}

const bad = [];
for (const root of ROOTS) {
	for await (const file of walk(root)) {
		const text = await readFile(file, "utf8");
		for (const m of text.matchAll(RELATIVE_IMPORT)) {
			const spec = m[1];
			if (spec.endsWith(".ts") || spec.endsWith(".json") || spec.endsWith(".mjs")) continue;
			const line = text.slice(0, m.index).split("\n").length;
			bad.push(`${file}:${line} → ${spec}`);
		}
	}
}

if (bad.length) {
	console.error("Относительные импорты должны указывать на существующий файл (.ts):");
	for (const b of bad) console.error(`  ${b}`);
	console.error("\nСервис запускается из исходников: «.js» в импорте — это падение при старте.");
	process.exit(1);
}
console.log(`импорты: ок`);
