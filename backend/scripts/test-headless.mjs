// Headless-тесты бэкенда (без БД) — для pre-commit гейта (verify) и быстрой проверки.
//
// Полный `node --test` требует живого Postgres (тесты, импортирующие prisma-client,
// висят без БД), поэтому в гейт берём только пуро-логические файлы (парсеры/мапперы/
// утилиты/движки на мок-клиентах). DB-тесты гоняются при поднятой БД (`npm run
// test:full`) или в CI на одноразовом Postgres. Список ведётся вручную: новый
// headless-тест — допиши сюда.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
	"auditLog", "bankImport", "barcodeUniqueness", "costing-avg", "costing-return",
	"costingReplay", "depreciation", "documentNumbering", "esfClassification",
	"esfErrorHandling", "esfInboundToPurchase", "esfInvoiceMapper", "esfLicense",
	"esfResolver", "fiscalProvider", "govMappers", "importLandedCost", "listUtils",
	"openapi", "orgFieldValidation", "parse1cDate", "parseUploadErrors", "periodLock",
	"recomputeCosting", "scheduler", "sortOrder", "twoFactor", "waResolve", "waWebhook",
].map((n) => path.join("__tests__", `${n}.test.js`));

const r = spawnSync("node", ["--test", ...FILES], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
