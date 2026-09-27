// Согласованность маршрутов и прав (О3 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ ЭТОТ ТЕСТ. `accessPermissionMiddleware` определяет предмет по первому сегменту пути, и
// маршрут, которого он не знает, ПРОПУСКАЕТ. То есть каждый новый роутер по умолчанию открыт, и
// замечают это только на аудите — так и случилось 24.09 с отчётами, заметками и метками.
//
// Тест закрывает именно эту брешь: сегмент, не попавший ни в карту моделей, ни в реестр
// предметов, валит сборку. Забыть больше нельзя — можно только осознанно описать.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTE_TO_MODEL } from "../utils/routeModels.js";
import { ROUTE_SUBJECTS, REPORT_SUBJECTS, SUBJECT_KINDS, subjectOf, reportSubject } from "../utils/routeSubjects.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTER_DIR = path.join(root, "api", "router");

/*
 * СКАНЕР ВИДИТ И ШАБЛОННЫЕ ПУТИ (Б12 аудита 26.09). Раньше регулярка брала только пути в
 * двойных кавычках, а половина роутеров объявляет их как `/${ROUTE}` или строит на фабриках
 * (`createDocumentHeaderRouter({ ROUTE: "month-closes" })`) — около двадцати сегментов
 * (`access-rights`, `user-defaults`, `month-closes`…) не проверялись вовсе, и тест был зелёным
 * при открытых маршрутах. Теперь:
 *   - константы файла (`const ROUTE = "taxes"`) подставляются в шаблон;
 *   - сегменты фабрик берутся из вызова (`ROUTE:` / `route:`);
 *   - шаблон, который не удалось разрешить, — сам по себе ошибка: слепое пятно не должно
 *     молча прятать маршрут.
 */
const FACTORY_CALLS = ["createDocumentHeaderRouter(", "createDocumentItemsRouter(", "createCashOrderRouter("];

/** Первые сегменты всех объявленных путей: router.get("/products/:id") → "products". */
export function declaredSegments(fileList = null) {
	const files = fileList ?? [...readdirSync(ROUTER_DIR).filter((f) => f.endsWith(".js")).map((f) => path.join(ROUTER_DIR, f)),
		path.join(root, "api", "v1.js")];
	const segs = new Map();
	const unresolved = [];
	const add = (first, file) => {
		if (!first || first.startsWith(":")) return;
		if (!segs.has(first)) segs.set(first, []);
		segs.get(first).push(path.basename(file));
	};
	for (const file of files) {
		const txt = readFileSync(file, "utf8");
		const base = path.basename(file);
		// Фабрики объявляют пути от параметра — сами по себе сегментов не дают.
		const isFactory = /^_.*Factory\.js$/.test(base);
		const consts = {};
		for (const m of txt.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"'`$]*)["']/g)) consts[m[1]] = m[2];
		for (const m of txt.matchAll(/\.(?:get|post|put|patch|delete)\(\s*(["'`])(\/[^"'`]*)\1/g)) {
			let seg = m[2];
			if (m[1] === "`") {
				seg = seg.replace(/\$\{(\w+)\}/g, (all, name) => consts[name] ?? all);
				if (seg.includes("${")) {
					if (!isFactory) unresolved.push(`${base}: ${m[2]}`);
					continue;
				}
			}
			add(seg.replace(/^\/+/, "").split("/")[0], file);
		}
		if (FACTORY_CALLS.some((c) => txt.includes(c))) {
			for (const m of txt.matchAll(/\b(?:ROUTE|route)\s*:\s*["']([^"']+)["']/g)) add(m[1], file);
		}
	}
	return Object.assign(segs, { unresolved });
}

test("сканер разрешает шаблонные пути и видит фабрики", () => {
	const segs = declaredSegments();
	assert.deepEqual(segs.unresolved, [], `пути, которые сканер не понял (опишите константой): ${segs.unresolved.join("; ")}`);
	// Опорные сегменты из шаблонов и фабрик — если сканер снова ослепнет, упадёт здесь.
	for (const s of ["access-rights", "user-defaults", "taxes", "month-closes", "purchaseitems", "cash-receipt-orders", "bank-statements"]) {
		assert.ok(segs.has(s), `сканер не видит сегмент ${s}`);
	}
});

test("каждый маршрут описан: либо модель прав, либо предмет с объяснением", () => {
	const segs = declaredSegments();
	assert.ok(segs.size > 30, "сканер путей сломался — сегментов подозрительно мало");
	const missing = [...segs.keys()].filter((s) => !(s in ROUTE_TO_MODEL) && !subjectOf(s));
	assert.deepEqual(missing, [],
		`не описаны (допишите в ROUTE_TO_MODEL или в ROUTE_SUBJECTS): ${missing.join(", ")}`);
});

test("реестр предметов не расходится с картой моделей", () => {
	// Сегмент в обоих местах — двусмысленность: непонятно, какое правило главнее.
	const both = Object.keys(ROUTE_SUBJECTS).filter((s) => s in ROUTE_TO_MODEL);
	assert.deepEqual(both, [], `описаны дважды: ${both.join(", ")}`);
});

test("у каждого предмета известный вид и объяснение", () => {
	for (const [seg, def] of Object.entries(ROUTE_SUBJECTS)) {
		assert.ok(SUBJECT_KINDS.includes(def.kind), `${seg}: неизвестный вид ${def.kind}`);
		// Объяснение обязательно: запись без него через месяц не отличить от забытой.
		assert.ok(def.note && def.note.length > 10, `${seg}: нужно объяснение, почему предмета нет`);
	}
});

test("отложенные сегменты названы моделью — чтобы перенос был механическим", () => {
	// kind: "todo" значит «предмет есть, право ещё не раздавалось». Модель обязана быть
	// названа: иначе при переносе в карту придётся заново выяснять, чей это маршрут.
	for (const [seg, def] of Object.entries(ROUTE_SUBJECTS)) {
		if (def.kind !== "todo") continue;
		assert.ok(def.model, `${seg}: отложенный сегмент без модели`);
	}
});

test("каждый отчёт знает свой предмет", () => {
	const txt = readFileSync(path.join(ROUTER_DIR, "reports.js"), "utf8");
	const names = [...txt.matchAll(/router\.get\("\/reports\/([a-z0-9-]+)"/g)].map((m) => m[1]);
	assert.ok(names.length >= 5, "отчёты не нашлись — изменился способ объявления");
	const undescribed = names.filter((n) => !reportSubject(n));
	assert.deepEqual(undescribed, [],
		`отчёты без предмета (допишите в REPORT_SUBJECTS): ${undescribed.join(", ")}`);
});

test("предмет отчёта — модель из карты прав, а не выдуманное имя", () => {
	const models = new Set(Object.values(ROUTE_TO_MODEL));
	for (const [name, model] of Object.entries(REPORT_SUBJECTS)) {
		assert.ok(models.has(model), `отчёт ${name}: модели ${model} нет в карте прав`);
	}
});
