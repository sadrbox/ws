// eslint-ratchet.mjs — CI-ворота «без роста ошибок ESLint» (трещотка).
//
// Полный eslint в проекте пока красный (~1656 ошибок, преимущественно каскад any —
// см. ROADMAP E13 Q2). Блокировать сборку целиком нельзя, но нельзя и позволять
// счётчику расти. Скрипт сравнивает текущее число error'ов с baseline
// (.eslint-baseline): больше → CI падает; меньше → подсказывает опустить baseline.
// Так новый код обязан быть чистым, а долг гасится монотонно вниз.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const BASELINE_FILE = ".eslint-baseline";
const baseline = existsSync(BASELINE_FILE)
  ? parseInt(readFileSync(BASELINE_FILE, "utf8").trim(), 10) || 0
  : 0;

let json = "";
try {
  json = execSync("npx eslint . -f json", { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
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
    `Почини добавленные ошибки (или не вводи any) перед мержем.`,
  );
  process.exit(1);
}
if (errors < baseline) {
  console.log(`✅ Ошибок меньше baseline — опусти .eslint-baseline до ${errors} и закоммить (git add .eslint-baseline).`);
}
