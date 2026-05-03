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
