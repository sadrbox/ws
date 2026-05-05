type SaleItemCalcInput = {
	quantity?: unknown;
	price?: unknown;
	vatRate?: unknown;
	discountPercent?: unknown;
};

function toNumber(value: unknown): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (typeof value === "string") return parseFloat(value) || 0;
	return 0;
}

export function recalcSaleItemAmounts(
	quantity: unknown,
	price: unknown,
	vatRate: unknown,
	discountPercent: unknown,
): { discountAmount: number; vatAmount: number; amount: number } {
	const q = toNumber(quantity);
	const p = toNumber(price);
	const vr = toNumber(vatRate);
	const dp = toNumber(discountPercent);

	const base = Math.round(q * p * 100) / 100;
	const discAmt = Math.round(((base * dp) / 100) * 100) / 100;
	const afterDiscount = base - discAmt;
	const vatAmt =
		vr > 0 ? Math.round(((afterDiscount * vr) / (100 + vr)) * 100) / 100 : 0;

	return {
		discountAmount: discAmt,
		vatAmount: vatAmt,
		amount: afterDiscount,
	};
}

/** Запись отдельного налога в строке SaleItem (массив taxes). */
export interface SaleItemTaxEntry {
	taxUuid: string;
	code: string | null;
	shortName: string | null;
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
		shortName?: string | null;
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
			shortName: t.shortName ?? null,
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
	return {
		...patch,
		...recalcSaleItemAmounts(
			next.quantity,
			next.price,
			next.vatRate,
			next.discountPercent,
		),
	};
}

/**
 * Пересчёт строки при прямом вводе суммы скидки.
 * Обратная формула: discountPercent = (discountAmount / base) * 100
 */
export function withSaleItemRecalcFromDiscountAmount<
	T extends SaleItemCalcInput,
>(current: T, discountAmount: unknown): Record<string, unknown> {
	const q = toNumber(current.quantity);
	const p = toNumber(current.price);
	const vr = toNumber(current.vatRate);

	const base = Math.round(q * p * 100) / 100;
	const discAmt = Math.min(Math.max(toNumber(discountAmount), 0), base);
	const discPct =
		base > 0 ? Math.round((discAmt / base) * 100 * 10000) / 10000 : 0;

	const afterDiscount = base - discAmt;
	const vatAmt =
		vr > 0 ? Math.round(((afterDiscount * vr) / (100 + vr)) * 100) / 100 : 0;

	return {
		discountAmount: discAmt,
		discountPercent: discPct,
		vatAmount: vatAmt,
		amount: afterDiscount,
	};
}
