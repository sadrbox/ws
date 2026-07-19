// ─────────────────────────────────────────────────────────────────────────────
// Проигрывание движений регистра для расчёта себестоимости — ЧИСТАЯ функция.
//
// Один движок для обоих методов (AVERAGE|FIFO), чтобы отчёты не заводили СВОЙ
// счётчик себестоимости и не расходились с главной книгой. Состояние ведётся
// ПО СКЛАДУ (как в проводках: слои ключуются product+warehouse), поэтому расход
// списывается по стоимости того склада, с которого выбывает.
//
// Согласованность с проводками: движок потребляет слои/среднюю строго
// хронологически по всем движениям — ровно как fifoCost/avgCost реконструируют
// это из БД по каждому документу. При одинаковом порядке движений результат
// совпадает с COGS, попавшим в проводки 7010.
//
// Вход НЕ обращается к БД: движения передаёт вызывающий (уже отсортированные).
// ─────────────────────────────────────────────────────────────────────────────

const r = (n, p = 100) => Math.round((Number(n) || 0) * p) / p;

/** Состояние одного склада по товару. */
function newState() {
	return { qty: 0, value: 0, avg: 0, layers: [] }; // layers: [{ qty, unit }] для ФИФО
}

/** Суммарные (по всем складам) кол-во и стоимость остатка. */
function totals(states) {
	let qty = 0, value = 0;
	for (const s of states.values()) { qty += s.qty; value += s.value; }
	return { qty, value: Math.max(value, 0) };
}

/**
 * Проиграть движения одного товара и вернуть агрегаты периода.
 *
 * @param {Array} movements — движения товара, отсортированы (date, documentId, id).
 *   Каждое: { date, movementType:"in"|"out", quantity, amount, documentType, warehouseUuid }.
 * @param {object} opts
 * @param {"AVERAGE"|"FIFO"} opts.method
 * @param {Date|null} opts.from — начало периода (для opening); null → без начального остатка.
 * @param {Set<string>} opts.costBearingInDocs — типы, у которых in.amount = фактическая стоимость.
 * ВЫРУЧКИ здесь НЕТ и быть не может: регистр её не хранит. У расхода реализации
 * `amount` — это СЕБЕСТОИМОСТЬ выбытия (инвариант productRegister.js: out.amount ==
 * кредит 1330 в проводке). Раньше движок возвращал salesRevenue, накапливая туда
 * этот же amount, и потребитель («Ведомость по материалам») показывал прибыль
 * salesRevenue − salesCogs ≡ 0 у всех позиций, а себестоимость единицы — под
 * подписью «цена реализации». Выручку берите из строк документа (sale_items) или
 * из проводок по 6010.
 *
 * @returns {{openQty,openAmount,inQty,inAmount,outQty,cogsOut,salesQty,salesCogs,closeQty,closeAmount,unitCost}}
 */
export function replayProductCosting(movements, { method = "AVERAGE", from = null, costBearingInDocs } = {}) {
	const fifo = method === "FIFO";
	const states = new Map(); // warehouseUuid → state
	const stateOf = (wh) => {
		const key = wh ?? "__no_wh__";
		let s = states.get(key);
		if (!s) { s = newState(); states.set(key, s); }
		return s;
	};

	let openQty = 0, openAmount = 0, openCaptured = !from;
	const p = { inQty: 0, inAmount: 0, outQty: 0, cogsOut: 0, salesQty: 0, salesCogs: 0 };

	for (const mv of movements) {
		// Начальный остаток = состояние (по всем складам) перед первым движением периода.
		if (!openCaptured && from && new Date(mv.date) >= from) {
			const t = totals(states);
			openQty = t.qty; openAmount = t.value; openCaptured = true;
		}
		const inPeriod = !from || new Date(mv.date) >= from;
		const q = Number(mv.quantity) || 0;
		const amt = Number(mv.amount) || 0;
		const s = stateOf(mv.warehouseUuid);

		if (mv.movementType === "in") {
			// Приход по фактической стоимости, если документ её знает (см. costBearingInDocs);
			// иначе — по текущей средней склада (amount не является себестоимостью).
			const addCost = costBearingInDocs?.has(mv.documentType) ? amt : (s.avg > 0 ? q * s.avg : amt);
			s.qty += q;
			s.value += addCost;
			if (s.qty > 0) s.avg = s.value / s.qty;
			if (fifo && q > 0) s.layers.push({ qty: q, unit: addCost / q });
			if (inPeriod) { p.inQty += q; p.inAmount += addCost; }
		} else {
			let outCost;
			if (fifo) {
				// Потребляем слои oldest→newest.
				let need = q; outCost = 0;
				while (need > 1e-9 && s.layers.length > 0) {
					const layer = s.layers[0];
					const take = Math.min(need, layer.qty);
					outCost += take * layer.unit;
					layer.qty -= take; need -= take;
					if (layer.qty <= 1e-9) s.layers.shift();
				}
				// Слоёв не хватило (расход при отрицательном остатке) — у недостающего
				// количества нет основы стоимости, добавляем 0. Проведение таких
				// расходов должно блокировать assertStockForPosting; здесь — отчёт.
			} else {
				outCost = s.avg > 0 ? q * s.avg : 0;
			}
			s.qty -= q;
			s.value -= outCost;
			if (s.qty > 0) s.avg = s.value / s.qty;
			else s.value = Math.max(s.value, 0);
			if (inPeriod) {
				p.outQty += q;
				p.cogsOut += outCost;
				if (mv.documentType === "sale") {
					p.salesQty += q;
					p.salesCogs += outCost;
				}
			}
		}
	}
	if (!openCaptured) { const t = totals(states); openQty = t.qty; openAmount = t.value; }

	const close = totals(states);
	return {
		openQty: r(openQty, 1000), openAmount: r(openAmount),
		inQty: r(p.inQty, 1000), inAmount: r(p.inAmount),
		outQty: r(p.outQty, 1000), cogsOut: r(p.cogsOut),
		salesQty: r(p.salesQty, 1000), salesCogs: r(p.salesCogs),
		closeQty: r(close.qty, 1000), closeAmount: r(close.value),
		unitCost: r(close.qty > 0 ? close.value / close.qty : 0),
	};
}

export default { replayProductCosting };
