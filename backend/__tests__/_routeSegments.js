// Сегменты маршрутов, которые РЕАЛЬНО объявлены роутерами (помощник тестов, не тест).
//
// Сканер тот же, что в routeSubjects.test.js (declaredSegments): там он живёт внутри тестового
// файла, и импорт оттуда заново запустил бы его тесты. Здесь — ещё префиксы монтирования из
// server.js (`app.use("/api/v1/activityhistories", …)`): у таких роутеров сегмента в самом файле нет.
// Проверить потом: перевести routeSubjects.test.js на этот помощник, чтобы сканер был один.
//
// Что видит:
//   • router.get("/products/:id") → "products";
//   • шаблоны `/${ROUTE}` — с константами файла (`const ROUTE = "taxes"`);
//   • фабрики (createDocumentHeaderRouter / createDocumentItemsRouter / createCashOrderRouter) —
//     сегмент из вызова (`ROUTE:` / `route:`);
//   • шаблон, который не удалось разрешить, попадает в `unresolved` — слепое пятно не должно молча
//     прятать маршрут.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTER_DIR = path.join(root, "api", "router");
const FACTORY_CALLS = ["createDocumentHeaderRouter(", "createDocumentItemsRouter(", "createCashOrderRouter("];

/** Map «сегмент → файлы, где он объявлен» с полем `unresolved` (непонятые шаблоны). */
export function declaredRouteSegments() {
	const files = [...readdirSync(ROUTER_DIR).filter((f) => f.endsWith(".js")).map((f) => path.join(ROUTER_DIR, f)),
		path.join(root, "api", "v1.js")];
	const segs = new Map();
	const unresolved = [];
	const add = (first, where) => {
		if (!first || first.startsWith(":")) return;
		if (!segs.has(first)) segs.set(first, []);
		segs.get(first).push(where);
	};
	for (const file of files) {
		const txt = readFileSync(file, "utf8");
		const base = path.basename(file);
		const isFactory = /^_.*Factory\.js$/.test(base); // объявляет пути от параметра — сегментов не даёт
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
			add(seg.replace(/^\/+/, "").split("/")[0], base);
		}
		if (FACTORY_CALLS.some((c) => txt.includes(c))) {
			for (const m of txt.matchAll(/\b(?:ROUTE|route)\s*:\s*["']([^"']+)["']/g)) add(m[1], base);
		}
	}
	// Роутеры, смонтированные с собственным префиксом: сегмент задаёт server.js.
	const server = readFileSync(path.join(root, "server.js"), "utf8");
	for (const m of server.matchAll(/app\.use\(\s*["']\/api\/v1\/([^"'/]+)/g)) add(m[1], "server.js");
	return Object.assign(segs, { unresolved });
}

export default { declaredRouteSegments };
