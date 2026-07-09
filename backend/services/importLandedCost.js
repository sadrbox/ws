// ─────────────────────────────────────────────────────────────────────────────
// Распределение таможенных платежей ГТД по позициям (landed cost) — Этап 2.
//
// Таможенная пошлина, сбор за оформление и акциз КАПИТАЛИЗИРУЮТСЯ в себестоимость
// товара (увеличивают стоимость прихода на склад и дебет счёта 1330). Импортный
// НДС — к возмещению (счёт 1420) для плательщика НДС; для НЕплательщика он также
// капитализируется в себестоимость.
//
// Распределение — пропорционально таможенной стоимости позиции (item.amount);
// при нулевой сумме — по количеству; иначе поровну. Копейки остатка относятся на
// позицию с наибольшим весом (метод наибольшего остатка) — суммы долей точно
// сходятся с итогами по декларации.
//
// Чистая функция без обращений к БД — переиспользуется productRegister
// (стоимость прихода) и accountingPosting (проводки).
// ─────────────────────────────────────────────────────────────────────────────

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Разнести сумму total по весам weights[] с округлением до 2 знаков так, чтобы
 * сумма долей == r2(total). Остаток относится на позицию с макс. весом.
 * @returns {number[]} доли (длина = weights.length)
 */
function allocateProportional(total, weights) {
	const t = r2(total);
	const n = weights.length;
	if (n === 0 || t === 0) return new Array(n).fill(0);
	let base = weights.map((w) => Number(w) || 0);
	let sum = base.reduce((s, w) => s + w, 0);
	if (sum <= 0) {
		// нет весов → поровну
		base = new Array(n).fill(1);
		sum = n;
	}
	const raw = base.map((w) => (t * w) / sum);
	const floored = raw.map((v) => Math.floor(v * 100) / 100);
	let allocated = r2(floored.reduce((s, v) => s + v, 0));
	let remainder = r2(t - allocated);
	const shares = floored.slice();
	// Раздаём остаток по 1 копейке позициям с наибольшей дробной частью.
	if (remainder !== 0) {
		const cents = Math.round(Math.abs(remainder) * 100);
		const step = remainder > 0 ? 0.01 : -0.01;
		const order = raw
			.map((v, i) => ({ i, frac: v * 100 - Math.floor(v * 100), w: base[i] }))
			.sort((a, b) => b.frac - a.frac || b.w - a.w);
		for (let k = 0; k < cents; k++) {
			shares[order[k % n].i] = r2(shares[order[k % n].i] + step);
		}
	}
	return shares;
}

/**
 * Распределить таможенные платежи ГТД по позициям.
 * @param {object} doc  — ImportDeclaration (dutyAmount/customsFeeAmount/exciseAmount/importVatAmount)
 * @param {object[]} items — позиции (amount = таможенная стоимость строки)
 * @param {boolean} useVat — организация — плательщик НДС
 * @returns {Map<string, {customsValue:number, capitalized:number, importVat:number, landed:number}>}
 *   ключ — item.uuid. landed = customsValue + capitalized (стоимость прихода и дебет 1330).
 */
export function allocateImportLandedCost(doc, items, useVat) {
	const duty = r2(doc?.dutyAmount);
	const fee = r2(doc?.customsFeeAmount);
	const excise = r2(doc?.exciseAmount);
	const importVat = r2(doc?.importVatAmount);

	// Капитализируемая база: пошлина + сбор + акциз (+ импортный НДС, если НЕ плательщик).
	const capBase = r2(duty + fee + excise + (useVat ? 0 : importVat));
	// НДС к возмещению (1420) — только для плательщика НДС.
	const vatBase = useVat ? importVat : 0;

	const weights = items.map((it) => Number(it.amount) || 0);
	const hasValue = weights.some((w) => w > 0);
	const effWeights = hasValue ? weights : items.map((it) => Number(it.quantity) || 0);

	const capShares = allocateProportional(capBase, effWeights);
	const vatShares = allocateProportional(vatBase, effWeights);

	const out = new Map();
	items.forEach((it, i) => {
		const customsValue = r2(it.amount);
		const capitalized = capShares[i] ?? 0;
		const importVatShare = vatShares[i] ?? 0;
		out.set(it.uuid, {
			customsValue,
			capitalized,
			importVat: importVatShare,
			landed: r2(customsValue + capitalized),
		});
	});
	return out;
}

export default { allocateImportLandedCost };
