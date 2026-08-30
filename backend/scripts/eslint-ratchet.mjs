// eslint-ratchet.mjs — CI-ворота «без роста ошибок ESLint» для бэкенда (трещотка).
//
// Бэкенд впервые получил линтер (Q10). Полный прогон не зелёный — остаётся
// пре-существующий мёртвый код (dead-локали в паре роутеров + seed/dev-скрипты).
// Блокировать весь бэкенд нельзя, но нельзя и позволять счётчику расти. Скрипт
// сравнивает текущее число error'ов с baseline (.eslint-baseline): больше → CI
// падает; меньше → подсказывает опустить baseline. Новый код обязан быть чистым,
// долг гасится монотонно вниз. Зеркалит frontend/scripts/eslint-ratchet.mjs.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(root, ".eslint-baseline");
const baseline = existsSync(BASELINE_FILE)
	? parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10) || 0
	: 0;

let json = "";
try {
	json = execSync("npx eslint . -f json", { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
} catch (e) {
	// eslint завершается кодом 1 при наличии ошибок — JSON всё равно на stdout.
	json = e.stdout?.toString() ?? "";
}

let errors = 0;
try {
	for (const f of JSON.parse(json)) errors += f.errorCount;
} catch {
	console.error("eslint-ratchet: не удалось разобрать вывод eslint (-f json)");
	process.exit(2);
}

console.log(`ESLint errors: ${errors} (baseline ${baseline})`);
if (errors > baseline) {
	console.error(
		`::error::ESLint ошибок стало больше: ${baseline} → ${errors}. ` +
		`Почини добавленные ошибки перед мержем.`,
	);
	process.exit(1);
}
if (errors < baseline) {
	console.log(`✅ Ошибок меньше baseline — опусти .eslint-baseline до ${errors} и закоммить (git add .eslint-baseline).`);
}
