type SaleItemCalcInput = {
	quantity?: unknown;
	price?: unknown;
	vatRate?: unknown;
	exciseRate?: unknown;
	discountPercent?: unknown;
	vatCalculationMethod?: unknown;
};

function toNumber(value: unknown): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (typeof value === "string") return parseFloat(value) || 0;
	return 0;
}

/** Нормализует значение метода расчёта НДС к "INCLUDED" | "ADDED". */
function normalizeMethod(v: unknown): "INCLUDED" | "ADDED" {
	const s = String(v ?? "").toUpperCase();
	return s === "ADDED" ? "ADDED" : "INCLUDED";
}

/**
 * Пересчёт сумм строки SaleItem.
 *
 *   base          = quantity × price
 *   discountAmount = base × discountPercent / 100
 *   afterDiscount = base − discountAmount
 *   exciseAmount  = afterDiscount × exciseRate / 100   (НК РК ст. 463; акциз ADDED)
 *   vatBase       = afterDiscount + exciseAmount       (база для НДС)
 *
 * Способ расчёта НДС берётся из элемента справочника VatRate
 * (поле `calculationMethod` записи `vatRateRef`):
 *   "INCLUDED" — НДС уже включён в цену:
 *       vatAmount = vatBase × rate / (100 + rate)
 *       amount    = vatBase
 *   "ADDED"    — НДС начисляется сверху:
 *       vatAmount = vatBase × rate / 100
 *       amount    = vatBase + vatAmount
 *
 *   amountWithoutVat = amount − vatAmount
 *
 * ВАЖНО: `amountWithoutVat` — это БАЗА НДС (afterDiscount + exciseAmount),
 * т.е. «Облагаемый оборот по НДС, но С АКЦИЗОМ». По НК РК ст.381 акциз входит в
 * облагаемый оборот по НДС, поэтому такая база — корректна.
 *
 * Графа 13 ЭСФ РК (НК РК ст.412) — «Стоимость без КОСВЕННЫХ налогов»
 * (без акциза и без НДС) = afterDiscount = amountWithoutVat − exciseAmount.
 *
 * Параметр `method` опционален (по умолчанию INCLUDED).
 * Параметр `exciseRate` опционален (по умолчанию 0 — акциз не применяется).
 */
export function recalcSaleItemAmounts(
	quantity: unknown,
	price: unknown,
	vatRate: unknown,
	discountPercent: unknown,
	method?: unknown,
	exciseRate?: unknown,
): {
	discountAmount: number;
	exciseAmount: number;
	vatAmount: number;
	amount: number;
	amountWithoutVat: number;
} {
	const q = toNumber(quantity);
	const p = toNumber(price);
	const vr = toNumber(vatRate);
	const dp = toNumber(discountPercent);
	const er = toNumber(exciseRate);
	const m = normalizeMethod(method);

	const base = Math.round(q * p * 100) / 100;
	const discAmt = Math.round(((base * dp) / 100) * 100) / 100;
	const afterDiscount = Math.round((base - discAmt) * 100) / 100;
	const exciseAmt =
		er > 0 ? Math.round(((afterDiscount * er) / 100) * 100) / 100 : 0;
	const vatBase = Math.round((afterDiscount + exciseAmt) * 100) / 100;

	let vatAmt = 0;
	if (vr > 0) {
		vatAmt =
			m === "ADDED"
				? Math.round(((vatBase * vr) / 100) * 100) / 100
				: Math.round(((vatBase * vr) / (100 + vr)) * 100) / 100;
	}
	const amount =
		m === "ADDED" ? Math.round((vatBase + vatAmt) * 100) / 100 : vatBase;
	const amountWithoutVat = Math.round((amount - vatAmt) * 100) / 100;

	return {
		discountAmount: discAmt,
		exciseAmount: exciseAmt,
		vatAmount: vatAmt,
		amount,
		amountWithoutVat,
	};
}

/** Запись отдельного налога в строке SaleItem (массив taxes). */
export interface SaleItemTaxEntry {
	taxUuid: string;
	code: string | null;
	name: string | null;
	rate: number;
	amount: number;
	/**
	 * Способ расчёта налога:
	 *   "INCLUDED" — налог включён в Стоимость (НДС типа RK);
	 *   "ADDED"    — налог начисляется сверху Стоимости.
	 */
	method: "INCLUDED" | "ADDED";
}

/**
 * Пересчёт массива налогов согласно `calculationMethod` каждого:
 *   INCLUDED:  amount = base * rate / (100 + rate)
 *   ADDED:     amount = base * rate / 100
 *
 * Стоимость строки (amount) при INCLUDED не меняется (налог уже в цене).
 * При ADDED — общая стоимость увеличивается на сумму налога; пересчёт
 * `amount` строки выполняется отдельно (см. {@link sumAddedTaxes}).
 *
 * @param amountAfterDiscount базовая сумма строки после скидки.
 * @param taxes массив налогов с rate и calculationMethod.
 */
export function recalcSaleItemTaxes(
	amountAfterDiscount: unknown,
	taxes: ReadonlyArray<{
		taxUuid: string;
		code?: string | null;
		name?: string | null;
		rate?: unknown;
		calculationMethod?: string | null;
		method?: string | null;
	}>,
): SaleItemTaxEntry[] {
	const base = toNumber(amountAfterDiscount);
	return taxes.map((t) => {
		const rate = toNumber(t.rate);
		const rawMethod = String(
			t.calculationMethod ?? t.method ?? "INCLUDED",
		).toUpperCase();
		const method: "INCLUDED" | "ADDED" =
			rawMethod === "ADDED" ? "ADDED" : "INCLUDED";
		let amount = 0;
		if (rate > 0) {
			amount =
				method === "INCLUDED"
					? Math.round(((base * rate) / (100 + rate)) * 100) / 100
					: Math.round(((base * rate) / 100) * 100) / 100;
		}
		return {
			taxUuid: String(t.taxUuid),
			code: t.code ?? null,
			name: t.name ?? null,
			rate,
			method,
			amount,
		};
	});
}

/** Сумма налогов с методом ADDED (надбавка к базовой стоимости). */
export function sumAddedTaxes(
	taxes: ReadonlyArray<{ method?: string | null; amount?: unknown }>,
): number {
	let s = 0;
	for (const t of taxes) {
		if (String(t.method ?? "").toUpperCase() === "ADDED")
			s += toNumber(t.amount);
	}
	return Math.round(s * 100) / 100;
}

export function withSaleItemRecalc<T extends SaleItemCalcInput>(
	current: T,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const next = { ...current, ...patch };
	// Метод расчёта НДС передаётся вызывающей стороной
	// (vatCalculationMethod из настроек НУО организации), иначе — INCLUDED.
	const method = (next as any).vatCalculationMethod ?? "INCLUDED";
	return {
		...patch,
		...recalcSaleItemAmounts(
			next.quantity,
			next.price,
			next.vatRate,
			next.discountPercent,
			method,
			next.exciseRate,
		),
	};
}

/**
 * Пересчёт строки при прямом вводе суммы скидки.
 * Обратная формула: discountPercent = (discountAmount / base) * 100
 *
 * Учитывает акциз (exciseRate) и НДС (vatRate с методом из vatRateRef).
 */
export function withSaleItemRecalcFromDiscountAmount<
	T extends SaleItemCalcInput,
>(current: T, discountAmount: unknown): Record<string, unknown> {
	const q = toNumber(current.quantity);
	const p = toNumber(current.price);
	const base = Math.round(q * p * 100) / 100;
	const discAmt = Math.min(Math.max(toNumber(discountAmount), 0), base);
	const discPct =
		base > 0 ? Math.round((discAmt / base) * 100 * 10000) / 10000 : 0;

	const method = (current as any).vatCalculationMethod;
	const recalc = recalcSaleItemAmounts(
		q,
		p,
		current.vatRate,
		discPct,
		method,
		current.exciseRate,
	);

	return {
		discountAmount: discAmt,
		discountPercent: discPct,
		...recalc,
	};
}
