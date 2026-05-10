/**
 * Нормализация значений и глубокое сравнение для устойчивого dirty-tracking.
 *
 * Цель: одинаковые по смыслу данные не должны давать разный JSON-снимок.
 * Источники ложного dirty:
 *   - "30" vs 30 (числа в строках после клиентского ввода);
 *   - "" vs null vs undefined (разные представления пустого значения);
 *   - "  text  " vs "text" (пробелы по краям после автонабора);
 *   - Decimal/BigNumber (Prisma.Decimal) → объект с полями {s,e,d};
 *   - new Date() vs ISO-строка;
 *   - порядок ключей в объекте.
 *
 * Стратегия:
 *   - normalizeValue(v): рекурсивно приводит значения к каноническому виду
 *     (примитив, массив, объект с отсортированными ключами).
 *   - isEquivalent(a, b): глубокое сравнение нормализованных значений.
 *   - stableStringify(v): стабильный JSON для snapshot-сравнения.
 */

const PRIMITIVE_NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (v === null || typeof v !== "object") return false;
	const proto = Object.getPrototypeOf(v);
	return proto === null || proto === Object.prototype;
}

/**
 * Привести значение к каноническому виду:
 *  - undefined / "" / NaN → null;
 *  - строка-число → число;
 *  - строка → trim;
 *  - Date → ISO;
 *  - Decimal-подобные (с toString) → число (если парсится) или строка;
 *  - массив → массив normalize();
 *  - plain-object → объект с отсортированными ключами,
 *    при этом ключи со значением null/undefined опускаются (равны "отсутствию").
 */
export function normalizeValue(v: unknown): unknown {
	if (v === undefined || v === null) return null;
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	if (typeof v === "boolean") return v;
	if (typeof v === "string") {
		const trimmed = v.trim();
		if (trimmed === "") return null;
		if (PRIMITIVE_NUMBER_RE.test(trimmed)) return Number(trimmed);
		return trimmed;
	}
	if (v instanceof Date) {
		const t = v.getTime();
		return Number.isFinite(t) ? new Date(t).toISOString() : null;
	}
	if (Array.isArray(v)) return v.map(normalizeValue);
	// Decimal-подобные (Prisma.Decimal, BigNumber) — не plain-объекты или
	// plain-объекты с собственным toString, возвращающим осмысленную
	// строку. Проверяем оба случая.
	if (typeof v === "object") {
		const ownToString =
			Object.prototype.hasOwnProperty.call(v, "toString") &&
			(v as { toString?: unknown }).toString !== Object.prototype.toString;
		if (!isPlainObject(v) || ownToString) {
			const s = String(v);
			if (s !== "[object Object]") {
				const t = s.trim();
				if (t === "") return null;
				if (PRIMITIVE_NUMBER_RE.test(t)) return Number(t);
				return t;
			}
		}
		const obj = v as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		const keys = Object.keys(obj).sort();
		for (const k of keys) {
			const nv = normalizeValue(obj[k]);
			if (nv === null) continue; // отсутствующее значение не учитывается
			out[k] = nv;
		}
		return out;
	}
	return null;
}

/** Стабильный JSON-снимок для dirty-сравнения. */
export function stableStringify(v: unknown): string {
	return JSON.stringify(normalizeValue(v));
}

/** Глубокое смысловое сравнение двух значений. */
export function isEquivalent(a: unknown, b: unknown): boolean {
	return stableStringify(a) === stableStringify(b);
}
