// ─────────────────────────────────────────────────────────────────────────────
// Покрытие поиска по вложенным строкам: КАЖДЫЙ список документов с позициями
// обязан подключать buildNestedItemsConditions.
//
// Зачем отдельный тест. Утилита nestedSearch выводит связь строк из схемы и
// работает для всех 17 документов, но роутеру всё равно нужно её ВЫЗВАТЬ. Если
// вызова нет, поиск не падает и ничего не сообщает — список просто возвращается
// целиком, будто фильтр не совпал. Отличить это от «товара нет в документах»
// глазами невозможно: и там, и там результат выглядит правдоподобно. Так и жил
// незамеченным пробел в purchaserequisitions.js — шаблон там не фильтровал вообще.
//
// Проверка идёт по исходникам роутеров, а не по HTTP: тест не требует сервера и
// ловит забытый вызов в момент добавления нового документа.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";

const ROUTER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "api", "router");

/** Документы с позициями: у модели есть связь типа `<Модель>Item` (то же правило, что в nestedSearch). */
function documentModelsWithItems() {
	const out = new Set();
	for (const m of Prisma.dmmf?.datamodel?.models ?? []) {
		if (m.fields.some((f) => f.kind === "object" && f.type === `${m.name}Item`)) out.add(m.name);
	}
	return out;
}

test("каждый роутер документа с позициями подключает поиск по строкам", () => {
	const withItems = documentModelsWithItems();
	assert.ok(withItems.size >= 15, `ожидались документы с позициями, найдено ${withItems.size}`);

	// Роутеры-фабрики: вызов живёт в них, конкретные документы наследуют его.
	const factories = fs
		.readdirSync(ROUTER_DIR)
		.filter((f) => f.startsWith("_") && f.endsWith(".js"))
		.filter((f) => fs.readFileSync(path.join(ROUTER_DIR, f), "utf8").includes("buildNestedItemsConditions"));

	const missing = [];
	for (const file of fs.readdirSync(ROUTER_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_"))) {
		const src = fs.readFileSync(path.join(ROUTER_DIR, file), "utf8");

		// Модель роутера: `const MODEL = "…"` либо `MODEL: "…"` в конфиге фабрики.
		const model = (src.match(/^const MODEL = "([^"]+)"/m) ?? src.match(/\bMODEL:\s*"([^"]+)"/))?.[1];
		if (!model) continue;

		const modelPascal = model[0].toUpperCase() + model.slice(1);
		if (!withItems.has(modelPascal)) continue; // документ без позиций — искать нечего

		const viaFactory = factories.some((f) => src.includes(f.replace(/\.js$/, "")));
		if (src.includes("buildNestedItemsConditions") || viaFactory) continue;
		missing.push(`${file} (MODEL=${model})`);
	}

	assert.deepEqual(
		missing,
		[],
		"эти роутеры документов не подключают buildNestedItemsConditions — " +
			"шаблонный поиск в их списках молча вернёт всё:\n  " + missing.join("\n  "),
	);
});
