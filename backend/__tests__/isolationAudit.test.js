// Изоляция арендаторов: постоянная проверка (И2 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// В режиме `isolated` организации друг другу посторонние, и утечка между ними — инцидент, а не
// дефект. Осмотреть 110 роутеров глазами нельзя, а каждый новый по умолчанию читает базу как
// хочет. Этот тест валит сборку, когда появляется роутер, читающий чужие данные без изоляции.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditIsolation, orgScopedModels, EXEMPT, GUARDS } from "../utils/isolationAudit.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerDir = path.join(root, "api", "router");
const schemaPath = path.join(root, "prisma", "schema.prisma");

test("ни один роутер не читает данные организации без изоляции", () => {
	const problems = auditIsolation({ routerDir, schemaPath });
	const shown = problems.map((p) => `${p.file} (${p.models.join(", ")})`).join("; ");
	assert.deepEqual(problems, [],
		`изоляция не видна: ${shown}. Примените tenantFilter/directoryScope/checkOwnership ` +
		"или внесите роутер в EXEMPT с объяснением, почему изоляция не нужна.");
});

test("схема разбирается: моделей с организацией много и они настоящие", () => {
	const models = orgScopedModels(readFileSync(schemaPath, "utf8"));
	assert.ok(models.size > 50, `разбор схемы сломался: найдено ${models.size} моделей`);
	assert.equal(models.get("sale"), "Sale");
	assert.equal(models.get("cashOrder"), "CashOrder");
	// У пользователя поле есть, но это активная организация, а не владение данными.
	assert.ok(models.has("user"));
});

test("у каждого исключения есть объяснение, а не просто имя файла", () => {
	for (const [file, why] of Object.entries(EXEMPT)) {
		assert.ok(typeof why === "string" && why.length > 20,
			`${file}: исключение без внятной причины — через месяц не отличить от забытого`);
	}
});

test("список механизмов изоляции не пустеет незаметно", () => {
	// Если кто-то переименует tenantFilter и забудет здесь, аудит начнёт молча пропускать всё.
	for (const g of ["tenantFilter", "checkOwnership", "orgIsAccessible"]) {
		assert.ok(GUARDS.includes(g), g);
	}
	const auth = readFileSync(path.join(root, "utils", "auth.js"), "utf8");
	for (const g of GUARDS) {
		assert.ok(auth.includes(`export function ${g}`) || auth.includes(`export async function ${g}`),
			`${g} больше не экспортируется из utils/auth.js — аудит проверяет несуществующее`);
	}
});
