// ─────────────────────────────────────────────────────────────────────────────
// Безопасный orderBy из query-параметра `sort` (JSON вида { поле: "asc"|"desc" }).
//
// ЗАЧЕМ. Клиент шлёт идентификаторы КОЛОНОК таблицы. Среди них есть ВИРТУАЛЬНЫЕ —
// в БД их нет: `serials`, `batch`, `lineNumber`, `deviation`, `accountingQuantity`
// и т.п. Роутеры подставляли имя поля в Prisma «как есть» (`orderBy.push({[f]:d})`,
// а для путей с точкой строили nested из ЛЮБЫХ сегментов), поэтому запрос падал:
//   GET /saleitems?sort={"serials":"asc"}
//   → PrismaClientValidationError: Unknown argument `serials` → 500.
//
// КАК. Имена валидируем по СХЕМЕ (Prisma.dmmf), а не по строковым догадкам:
//   • простое имя      → пропускаем, только если это скалярное поле модели;
//   • путь "a.b"       → только если `a` — реальная связь модели, а `b` — скаляр
//                        связанной модели (рекурсивно для более глубоких путей);
//   • всё остальное    → молча игнорируем. Сортировка не критична: ронять из-за
//                        неё выдачу нельзя.
// Всегда добавляем тай-брейк по id — иначе порядок между равными строками
// недетерминирован (страницы «прыгают»).
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";

// Индекс схемы: имя модели в любом регистре → { scalars:Set, relations:Map }.
const SCHEMA = new Map();
for (const m of Prisma.dmmf?.datamodel?.models ?? []) {
	const scalars = new Set();
	const relations = new Map(); // имя связи → имя связанной модели
	for (const f of m.fields) {
		if (f.kind === "object") relations.set(f.name, f.type);
		else scalars.add(f.name);
	}
	SCHEMA.set(m.name.toLowerCase(), { scalars, relations });
}

const modelInfo = (name) => (name ? SCHEMA.get(String(name).toLowerCase()) : null);

/**
 * Строит вложенный orderBy для пути "relation.field" (или глубже), проверяя КАЖДЫЙ
 * сегмент по схеме. Возвращает null, если путь не валиден.
 */
function nestedOrderBy(modelName, parts, dir) {
	const info = modelInfo(modelName);
	if (!info) return null;
	const [head, ...rest] = parts;

	if (rest.length === 0) {
		return info.scalars.has(head) ? { [head]: dir } : null;
	}
	const relatedModel = info.relations.get(head);
	if (!relatedModel) return null; // не связь → путь невалиден
	const inner = nestedOrderBy(relatedModel, rest, dir);
	return inner ? { [head]: inner } : null;
}

/**
 * @param {string} modelName — имя Prisma-модели ("saleItem", "Sale", "sale" — регистр не важен).
 * @param {string|null|undefined} sortParam — сырой req.query.sort (JSON-строка).
 * @param {object} [opts]
 * @param {Record<string, object>} [opts.nestedFields] — ЯВНЫЕ переопределения для
 *   нестандартных путей: { "product.name": { product: { name: "asc" } } }. Обычные
 *   пути "связь.поле" работают и без этого — они выводятся из схемы.
 * @param {object} [opts.fallback] — сортировка, когда клиент ничего не прислал (или
 *   прислал только невалидные поля). По умолчанию { id: "asc" }; списки документов
 *   передают { id: "desc" } (новые сверху).
 * @returns {Array<object>} orderBy для Prisma (со стабильным тай-брейком по id).
 */
export function buildOrderBy(modelName, sortParam, { nestedFields = {}, fallback = { id: "asc" } } = {}) {
	const info = modelInfo(modelName);
	const orderBy = [];

	if (typeof sortParam === "string" && sortParam) {
		try {
			const s = JSON.parse(sortParam);
			if (s && typeof s === "object") {
				for (const [f, d] of Object.entries(s)) {
					if (d !== "asc" && d !== "desc") continue;

					if (nestedFields[f]) {
						// Явное переопределение: подставляем направление в последний уровень.
						const nested = JSON.parse(JSON.stringify(nestedFields[f]));
						const setDir = (obj) => {
							for (const k of Object.keys(obj)) {
								if (obj[k] && typeof obj[k] === "object") setDir(obj[k]);
								else obj[k] = d;
							}
						};
						setDir(nested);
						orderBy.push(nested);
						continue;
					}

					const built = info ? nestedOrderBy(modelName, f.split("."), d) : null;
					if (built) orderBy.push(built);
					// иначе — виртуальная/несуществующая колонка: игнорируем.
				}
			}
		} catch {
			// битый JSON — сортировка по умолчанию
		}
	}

	if (orderBy.length === 0) orderBy.push(...(Array.isArray(fallback) ? fallback : [fallback]));
	else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });
	return orderBy;
}

export default { buildOrderBy };
