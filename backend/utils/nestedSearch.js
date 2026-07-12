// ─────────────────────────────────────────────────────────────────────────────
// Поиск по ВЛОЖЕННЫМ ТАБЛИЦАМ документа (шаблон «[номенклатура: ноут]»).
//
// Смысл: в списке документов пользователь ищет НЕ по колонкам списка, а по строкам
// документа — «покажи реализации, в позициях которых есть ноутбук». Колонки
// «Номенклатура» в списке Реализаций нет и быть не может: товаров в документе много.
//
// Поэтому фильтр серверный: Prisma `{ <items>: { some: { product: { name: contains } } } }`.
//
// Связь строк находим по СХЕМЕ (Prisma.dmmf): list-поле, тип которого оканчивается на
// "Item" (saleItems, purchaseItems, …). Так помощник работает для любого документа и
// не требует правок при добавлении нового.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";

/** Штрихкод товара — от САМОГО товара (для справочника Номенклатуры). */
const BARCODE_DIRECT = ["barcode", "barcodes[].barcode"];

/** Штрихкод товара — от СТРОКИ документа (через связь product). */
const BARCODE_FIELDS = BARCODE_DIRECT.map((p) => `product.${p}`);

/** Как пользователь называет область → какие поля СТРОКИ искать. */
const SCOPE_FIELDS = {
	номенклатура: ["product.name", "product.sku", ...BARCODE_FIELDS],
	товар: ["product.name", "product.sku", ...BARCODE_FIELDS],
	product: ["product.name", "product.sku", ...BARCODE_FIELDS],
	артикул: ["product.sku"],
	// Штрихкод: у товара есть ОСНОВНОЙ (product.barcode) и ДОПОЛНИТЕЛЬНЫЕ в отдельной
	// таблице (product.barcodes[]). Искать только по основному — значит пропускать часть.
	штрихкод: BARCODE_FIELDS,
	"штрих-код": BARCODE_FIELDS,
	gtin: BARCODE_FIELDS,
	ean: BARCODE_FIELDS,
	barcode: BARCODE_FIELDS,
	// Партии тут НЕТ намеренно: у строки документа только скалярный batchUuid,
	// relation `batch` в схеме не объявлен — путь «batch.batchNumber» уронил бы Prisma.
};

const normalize = (v) => String(v ?? "").toLowerCase().trim();

// Индекс схемы: ДОКУМЕНТ → имя связи с его строками ("sale" → "saleItems").
//
// ВАЖНО: связь ищем строго по типу `<Модель>Item`, а не «любой тип на Item».
// У Product тоже есть saleItems/purchaseItems/… (обратные ссылки), и «первая
// попавшаяся *Item-связь» давала для него saleItems — условие строилось
// бессмысленное, и шаблон «работал» только в списке Реализаций.
const ITEMS_RELATION = new Map();
for (const m of Prisma.dmmf?.datamodel?.models ?? []) {
	const rel = m.fields.find((f) => f.kind === "object" && f.type === `${m.name}Item`);
	if (rel) ITEMS_RELATION.set(m.name.toLowerCase(), rel.name);
}

// ─── Справочники: вложенные таблицы у них СВОИ ───────────────────────────────
// «Поиск во вложенных таблицах объекта» — не только позиции документов. У товара
// вложенная таблица — штрихкоды (и цены), поэтому в списке Номенклатуры
// «[штрихкод: 333]» должен искать по НИМ, а не через позиции документов.
const DIRECT_SCOPES = {
	product: {
		номенклатура: ["name", "sku", ...BARCODE_DIRECT],
		товар: ["name", "sku", ...BARCODE_DIRECT],
		product: ["name", "sku", ...BARCODE_DIRECT],
		артикул: ["sku"],
		штрихкод: BARCODE_DIRECT,
		"штрих-код": BARCODE_DIRECT,
		gtin: BARCODE_DIRECT,
		ean: BARCODE_DIRECT,
		barcode: BARCODE_DIRECT,
	},
};

/**
 * Путь + текст → условие Prisma.
 *   "product.name"            → { product: { name: { contains } } }
 *   "product.barcodes[].barcode" → { product: { barcodes: { some: { barcode: { contains } } } } }
 * Суффикс «[]» помечает СПИСОЧНУЮ связь: по ней нужен `some`, иначе Prisma упадёт.
 */
function pathCondition(path, text) {
	const parts = path.split(".");
	let cond = { contains: text, mode: "insensitive" };
	for (let i = parts.length - 1; i >= 0; i--) {
		const isList = parts[i].endsWith("[]");
		const key = isList ? parts[i].slice(0, -2) : parts[i];
		cond = isList ? { [key]: { some: cond } } : { [key]: cond };
	}
	return cond;
}

/**
 * Условия Prisma для поиска по строкам документа.
 *
 * @param {string} modelName — модель документа ("sale", "purchase", …).
 * @param {object} nested — req.query.nested: { "номенклатура": "ноут" }.
 * @returns {Array<object>} условия для AND (пустой массив — фильтровать нечего).
 *   Неизвестная область молча игнорируется: список не должен обнуляться из-за
 *   опечатки в имени области.
 */
export function buildNestedItemsConditions(modelName, nested) {
	if (!nested || typeof nested !== "object") return [];
	const key = String(modelName).toLowerCase();
	const relation = ITEMS_RELATION.get(key);   // документ → его позиции
	const direct = DIRECT_SCOPES[key];          // справочник → его вложенные таблицы
	if (!relation && !direct) return [];

	const conds = [];
	for (const [rawScope, rawText] of Object.entries(nested)) {
		const text = String(rawText ?? "").trim();
		if (!text) continue;
		const scope = normalize(rawScope);

		if (relation) {
			const fields = SCOPE_FIELDS[scope];
			if (!fields) continue; // область не про позиции документа — не фильтруем
			conds.push({ [relation]: { some: { OR: fields.map((f) => pathCondition(f, text)) } } });
			continue;
		}
		const fields = direct[scope];
		if (!fields) continue;
		conds.push({ OR: fields.map((f) => pathCondition(f, text)) });
	}
	return conds;
}

/** Известные области (для тестов/диагностики). */
export const nestedScopes = () => Object.keys(SCOPE_FIELDS);

export default { buildNestedItemsConditions, nestedScopes };
