/**
 * В ЧЁМ ИМЕННО ДОКУМЕНТ РАСХОДИТСЯ С ОСНОВАНИЕМ — словами, со значениями.
 *
 * Раньше сообщение называло только поля: «Документ не соответствует основанию: Контрагент,
 * Договор, строки отличаются от основания». Чтобы понять, что исправлять, приходилось открывать
 * основание и сравнивать глазами — и по шапке, и построчно. Теперь каждое расхождение — фраза
 * с обоими значениями: «Контрагент: в документе «ТОО А», в основании «ТОО Б»»,
 * ««Товар 46»: Количество — в документе 5, в основании 3», ««Товар 12»: нет в основании».
 *
 * Чистая функция: хук useBasisMismatch грузит основание, здесь только сравнение.
 */
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import { isEquivalent } from "src/utils/normalize";

type Row = Record<string, unknown>;

export interface BasisDifferencesInput {
	/** Шапка основания после mapFields: *Uuid и соответствующие *Name. */
	basisFields: Record<string, unknown>;
	currentFields: Record<string, unknown>;
	basisItems: Row[];
	/** Строки документа без удалённых. */
	currentItems: Row[];
	itemKeys: readonly string[];
	itemMatchMode: "exact" | "productsSubset";
	ignoreItems: boolean;
	ignoreFields?: readonly string[];
	fieldLabels?: Record<string, string>;
}

/** Подпись поля: явная метка → перевод базового имени → само имя ключа. */
function fieldLabel(key: string, fieldLabels?: Record<string, string>): string {
	if (fieldLabels?.[key]) return fieldLabels[key];
	const base = key.replace(/Uuid$/, "");
	const translated = translate(base);
	return translated && translated !== base ? translated : base;
}

/** Число — по значению («100.00» и 100 одно и то же), остальное — текстом. */
const num = (v: unknown): string => {
	if (v === null || v === undefined || v === "") return "";
	const n = Number(v);
	return Number.isFinite(n) && asText(v).trim() !== ""
		? n.toLocaleString("ru-RU", { maximumFractionDigits: 4 })
		: asText(v);
};

const quote = (s: string): string => `«${s}»`;
const valueOrEmpty = (s: string): string => (s.trim() ? quote(s) : translate("basisDiffEmpty"));

/** «в документе X, в основании Y». */
const pair = (doc: string, basis: string): string =>
	`${translate("basisDiffInDoc")} ${doc}, ${translate("basisDiffInBasis")} ${basis}`;

const productKey = (r: Row): string => asText(r.productUuid);
const productName = (r: Row): string => {
	const p = r.product as { name?: unknown } | null | undefined;
	return asText(p?.name) || asText(r.productName) || asText(r.name)
		|| (productKey(r) ? productKey(r).slice(0, 8) : translate("basisDiffNoProduct"));
};

export function describeBasisDifferences(i: BasisDifferencesInput): string[] {
	const out: string[] = [];

	// ── Шапка: идентификаторы, а называем — по именам, как их видит человек.
	for (const key of Object.keys(i.basisFields)) {
		if (!key.endsWith("Uuid") || key.startsWith("basisDocument")) continue;
		// Поле, которого у документа нет (у счёта-фактуры склада), расхождением не считается.
		if (!(key in i.currentFields) || i.ignoreFields?.includes(key)) continue;
		if (isEquivalent(i.basisFields[key], i.currentFields[key])) continue;
		const nameKey = key.replace(/Uuid$/, "Name");
		out.push(`${fieldLabel(key, i.fieldLabels)}: ${pair(
			valueOrEmpty(asText(i.currentFields[nameKey])),
			valueOrEmpty(asText(i.basisFields[nameKey])),
		)}`);
	}
	if (i.ignoreItems) return out;

	const group = (rows: Row[]) => {
		const m = new Map<string, Row[]>();
		for (const r of rows) m.set(productKey(r), [...(m.get(productKey(r)) ?? []), r]);
		return m;
	};
	const doc = group(i.currentItems);
	const basis = group(i.basisItems);
	const quantityLabel = fieldLabel("quantity", i.fieldLabels);
	const qty = (rows: Row[]) => rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

	// ВОЗВРАТЫ: частичный возврат допустим — расхождение только номенклатура, которой нет в основании.
	if (i.itemMatchMode === "productsSubset") {
		for (const [key, rows] of doc) {
			if (key && !basis.has(key)) out.push(`${quote(productName(rows[0]))}: ${translate("basisDiffNotInBasis")}`);
		}
		return out;
	}

	const valueKeys = i.itemKeys.filter((k) => k !== "productUuid");
	const sig = (r: Row) => valueKeys.map((k) => num(r[k])).join("|");

	for (const [key, rows] of doc) {
		const name = quote(productName(rows[0]));
		const other = basis.get(key);
		if (!other) {
			out.push(`${name}: ${translate("basisDiffNotInBasis")} (${quantityLabel} ${num(qty(rows))})`);
			continue;
		}
		if (rows.length === 1 && other.length === 1) {
			// Одна строка на товар с обеих сторон — называем каждое поле, которое разошлось.
			const fields = valueKeys
				.filter((k) => num(rows[0][k]) !== num(other[0][k]))
				.map((k) => `${fieldLabel(k, i.fieldLabels)} — ${pair(num(rows[0][k]) || "0", num(other[0][k]) || "0")}`);
			if (fields.length) out.push(`${name}: ${fields.join("; ")}`);
			continue;
		}
		// Товар несколькими строками: сравниваем набор строк без учёта порядка.
		const a = rows.map(sig).sort().join("\n");
		const b = other.map(sig).sort().join("\n");
		if (a !== b) {
			out.push(`${name}: ${translate("basisDiffRows")} — ${pair(String(rows.length), String(other.length))}`
				+ `, ${quantityLabel} — ${pair(num(qty(rows)), num(qty(other)))}`);
		}
	}
	for (const [key, rows] of basis) {
		if (!doc.has(key)) {
			out.push(`${quote(productName(rows[0]))}: ${translate("basisDiffNotInDoc")} (${quantityLabel} ${num(qty(rows))})`);
		}
	}
	return out;
}
