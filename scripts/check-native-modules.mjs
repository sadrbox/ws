/**
 * Проверка нативных модулей: каждый *.node из node_modules пакета загружается в ОТДЕЛЬНОМ процессе.
 *
 * ЗАЧЕМ. Процессор сервера — Intel i7 920 (2008) без AVX. Нативный модуль, собранный с AVX, при загрузке
 * роняет весь процесс Node сигналом SIGILL — без исключения, которое можно поймать, и без строки в журнале.
 * Так было с @napi-rs/canvas, который тянет pdf.js (ai и frontend; заменён заглушкой через overrides).
 * Эта проверка ловит такую зависимость в `npm run verify` — до коммита, а не после деплоя.
 *
 * ЧТО СЧИТАЕТСЯ ОШИБКОЙ — ТОЛЬКО «НЕДОПУСТИМАЯ ИНСТРУКЦИЯ» (SIGILL на Linux, 0xC000001D на Windows).
 * Сборки под чужие платформы (darwin, win32, arm) здесь честно не загружаются — это не ошибка. Модуль,
 * которому не хватает среды (например, .NET), тоже не ошибка этой проверки: его процессор выполнить может.
 *
 *   cd <пакет> && node ../scripts/check-native-modules.mjs
 */
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import path from "node:path";

const ROOT = path.resolve("node_modules");
const TIMEOUT_MS = 30_000;
const WIN_ILLEGAL_INSTRUCTION = 0xc000001d;

async function* walk(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const p = path.join(dir, e.name);
		// Символические ссылки (file:-заглушки, рабочие пространства) не обходим: там нет сборок, а петля возможна.
		if (e.isDirectory()) yield* walk(p);
		else if (e.isFile() && e.name.endsWith(".node")) yield p;
	}
}

function load(file) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["-e", `require(${JSON.stringify(file)})`], { stdio: "ignore" });
		const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
		child.on("exit", (code, signal) => {
			clearTimeout(timer);
			resolve({ file, illegal: signal === "SIGILL" || code === WIN_ILLEGAL_INSTRUCTION || code === 132 });
		});
		child.on("error", () => { clearTimeout(timer); resolve({ file, illegal: false }); });
	});
}

const files = [];
for await (const f of walk(ROOT)) files.push(f);

const results = [];
const queue = [...files];
await Promise.all(Array.from({ length: Math.max(1, Math.min(4, cpus().length)) }, async () => {
	while (queue.length) results.push(await load(queue.shift()));
}));

const bad = results.filter((r) => r.illegal).map((r) => path.relative(process.cwd(), r.file)).sort();
if (bad.length) {
	console.error("Нативные модули роняют Node на этом процессоре (недопустимая инструкция — скорее всего, нужен AVX):");
	for (const b of bad) console.error(`  ${b}`);
	console.error("Замените пакет заглушкой через \"overrides\" в package.json (пример — ai/stubs/napi-rs-canvas) или уберите зависимость.");
	process.exit(1);
}
console.log(`нативные модули: ок (${files.length} проверено)`);
