import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildOrderBy } from "../../utils/sortOrder.js";
import { reconcileDocumentRegister } from "../../services/productRegister.js";
import { reconcileDocumentEntries } from "../../services/accountingPosting.js";
import { checkOwnership } from "../../utils/auth.js";

const router = express.Router();

const MODEL = "saleItem";
const ROUTE = "saleitems";

// Изоляция: строки реализации доступны только если документ-родитель (sale)
// принадлежит организации пользователя. Возвращает true, либо шлёт 404.
async function assertSaleOwned(saleUuid, req, res) {
	if (!saleUuid) {
		res.status(404).json({ success: false, message: "Документ не найден" });
		return false;
	}
	const sale = await prisma.sale.findUnique({ where: { uuid: saleUuid }, select: { organizationUuid: true } });
	if (!sale || !checkOwnership(sale, req)) {
		res.status(404).json({ success: false, message: "Документ не найден" });
		return false;
	}
	return true;
}

/**
 * Пересчёт массива налогов с учётом calculationMethod каждого:
 *   INCLUDED ("в т.ч."):  taxAmount = base * rate / (100 + rate)
 *   ADDED   ("сверху"):   taxAmount = base * rate / 100
 * Возвращает массив записей `{ taxUuid, code, name, rate, method, amount }`.
 * Базовая Сумма без налогов строки (amountAfterDiscount) при INCLUDED не меняется,
 * при ADDED итоговый `amount` строки = afterDiscount + Σ ADDED-сумм.
 */
function recalcTaxes(amountAfterDiscount, taxes) {
	if (!Array.isArray(taxes)) return null;
	return taxes.map((t) => {
		const rate = Number(t?.rate ?? 0) || 0;
		const taxUuid = String(t?.taxUuid ?? "");
		const code = t?.code ?? null;
		const name = t?.name ?? null;
		const rawMethod = String(
			t?.calculationMethod ?? t?.method ?? "INCLUDED",
		).toUpperCase();
		const method = rawMethod === "ADDED" ? "ADDED" : "INCLUDED";
		let amount = 0;
		if (rate > 0) {
			amount =
				method === "INCLUDED"
					? Math.round(((amountAfterDiscount * rate) / (100 + rate)) * 100) /
						100
					: Math.round(((amountAfterDiscount * rate) / 100) * 100) / 100;
		}
		return { taxUuid, code, name, rate, method, amount };
	});
}

/** Сумма ADDED-налогов (надбавка к базовой стоимости). */
function sumAddedTaxes(entries) {
	if (!Array.isArray(entries)) return 0;
	let s = 0;
	for (const t of entries) {
		if (String(t?.method ?? "").toUpperCase() === "ADDED")
			s += Number(t?.amount) || 0;
	}
	return Math.round(s * 100) / 100;
}

/**
 * Расчёт vatAmount для строки SaleItem согласно методу из справочника VatRate.
 *   INCLUDED — НДС включён в цену:    vat = base * rate / (100 + rate)
 *   ADDED    — НДС начисляется сверху: vat = base * rate / 100
 * Возвращает 0 если ставка ≤ 0.
 */
function calcVatAmount(amountAfterDiscount, rate, method) {
	const r = Number(rate) || 0;
	if (r <= 0) return 0;
	const m =
		String(method ?? "INCLUDED").toUpperCase() === "ADDED"
			? "ADDED"
			: "INCLUDED";
	const v =
		m === "ADDED"
			? (amountAfterDiscount * r) / 100
			: (amountAfterDiscount * r) / (100 + r);
	return Math.round(v * 100) / 100;
}

/**
 * Загрузка способа расчёта НДС из настроек учёта организации,
 * к которой относится продажа. Возвращает "INCLUDED" по умолчанию.
 * Справочник VatRate удалён — метод теперь хранится напрямую в
 * OrganizationAccountingSetting.vatCalculationMethod.
 */
async function loadVatMethodForSale(saleUuid) {
	if (!saleUuid) return "INCLUDED";
	try {
		const sale = await prisma.sale.findUnique({
			where: { uuid: saleUuid },
			select: { organizationUuid: true, date: true },
		});
		if (!sale?.organizationUuid) return "INCLUDED";
		// Историческая выборка: настройки, действовавшие на дату документа
		// (startDate <= sale.date). Фолбэк — последняя активная запись.
		const where = { organizationUuid: sale.organizationUuid };
		if (sale.date) where.startDate = { lte: sale.date };
		let settings = await prisma.organizationAccountingSetting.findFirst({
			where,
			orderBy: { id: "desc" },
			select: { vatCalculationMethod: true },
		});
		if (!settings) {
			settings = await prisma.organizationAccountingSetting.findFirst({
				where: { organizationUuid: sale.organizationUuid, deletedAt: null },
				orderBy: { id: "desc" },
				select: { vatCalculationMethod: true },
			});
		}
		return String(
			settings?.vatCalculationMethod ?? "INCLUDED",
		).toUpperCase() === "ADDED"
			? "ADDED"
			: "INCLUDED";
	} catch {
		return "INCLUDED";
	}
}

/**
 * Полный пересчёт сумм строки SaleItem с учётом акциза (НК РК ст. 463).
 *
 *   base            = quantity × price
 *   discountAmount  = base × discountPercent / 100
 *   afterDiscount   = base − discountAmount
 *   exciseAmount    = afterDiscount × exciseRate / 100   (акциз ADDED)
 *   vatBase         = afterDiscount + exciseAmount        (база для НДС)
 *
 * Метод НДС определяется записью справочника VatRate:
 *   INCLUDED:  vatAmount = vatBase × rate / (100 + rate)
 *              amount    = vatBase
 *   ADDED:     vatAmount = vatBase × rate / 100
 *              amount    = vatBase + vatAmount
 *
 *   amountWithoutVat = amount − vatAmount   (графа 13 ЭСФ РК)
 *
 * @param {object} input { quantity, price, discountPercent, vatRate, exciseRate, vatMethod, taxes }
 * @returns {{ discountAmount, exciseAmount, vatAmount, amount, amountWithoutVat, taxes }}
 */
function recalcLineAmounts(input) {
	const qty = Number(input.quantity) || 0;
	const prc = Number(input.price) || 0;
	const discPct = Number(input.discountPercent) || 0;
	const vRate = Number(input.vatRate) || 0;
	const exciseRate = Number(input.exciseRate) || 0;
	const vatMethod =
		String(input.vatMethod ?? "INCLUDED").toUpperCase() === "ADDED"
			? "ADDED"
			: "INCLUDED";

	const base = Math.round(qty * prc * 100) / 100;
	const discountAmount = Math.round(((base * discPct) / 100) * 100) / 100;
	const afterDiscount = Math.round((base - discountAmount) * 100) / 100;
	const exciseAmount =
		exciseRate > 0
			? Math.round(((afterDiscount * exciseRate) / 100) * 100) / 100
			: 0;
	const vatBase = Math.round((afterDiscount + exciseAmount) * 100) / 100;

	const vatAmount = calcVatAmount(vatBase, vRate, vatMethod);
	const recomputedTaxes = recalcTaxes(vatBase, input.taxes);
	const vatAddedDelta = vatMethod === "ADDED" ? vatAmount : 0;
	const amount =
		Math.round(
			(vatBase + sumAddedTaxes(recomputedTaxes) + vatAddedDelta) * 100,
		) / 100;
	const amountWithoutVat = Math.round((amount - vatAmount) * 100) / 100;

	return {
		discountAmount,
		exciseAmount,
		vatAmount,
		amount,
		amountWithoutVat,
		taxes: recomputedTaxes,
	};
}

// ── GET list by saleUuid ────────────────────────────────────────────────
router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const saleUuid =
			typeof req.query.saleUuid === "string" ? req.query.saleUuid.trim() : "";
		if (!saleUuid)
			return res
				.status(400)
				.json({ success: false, message: "saleUuid обязателен" });
		// Изоляция: строки чужой реализации не отдаём.
		if (!(await assertSaleOwned(saleUuid, req, res))) return;

		// Сортировка по схеме: скаляры и пути "связь.поле" (product.name и т.п.)
		// пропускаются, виртуальные колонки (serials/batch/lineNumber/…) — нет.
		const orderBy = buildOrderBy(MODEL, req.query.sort);

		const items = await prisma[MODEL].findMany({
			where: { saleUuid },
			orderBy,
			include: {
				product: { include: { brand: true } },
				unitOfMeasure: true,
			},
		});
		return res.status(200).json({ success: true, items, total: items.length });
	} catch (error) {
		console.error(`GET /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET by id ───────────────────────────────────────────────────────────
router.get(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
		const item = await prisma[MODEL].findUnique({
			where: w,
			include: {
				product: { include: { brand: true } },
				unitOfMeasure: true,
			},
		});
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });
		// Изоляция: строка доступна только если её реализация принадлежит юзеру.
		if (!(await assertSaleOwned(item.saleUuid, req, res))) return;
		return res.status(200).json({ success: true, item });
	} catch (error) {
		console.error(`GET /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST ────────────────────────────────────────────────────────────────
router.post(`/${ROUTE}`, async (req, res) => {
	try {
		const {
			saleUuid,
			productUuid,
			quantity,
			price,
			unitOfMeasureUuid,
			vatRate,
			exciseRate,
			discountPercent,
			taxes,
		} = req.body;
		if (!saleUuid)
			return res
				.status(400)
				.json({ success: false, message: "saleUuid обязателен" });
		// Изоляция: создавать строку можно только в своей реализации.
		if (!(await assertSaleOwned(saleUuid, req, res))) return;

		const qty = quantity != null ? parseFloat(quantity) : 0;
		const prc = price != null ? parseFloat(price) : 0;
		const discPct = discountPercent != null ? parseFloat(discountPercent) : 0;
		const vRate = vatRate != null ? parseFloat(vatRate) : 12;
		const exRate = exciseRate != null ? parseFloat(exciseRate) : 0;
		const vatMethod = await loadVatMethodForSale(saleUuid);
		const calc = recalcLineAmounts({
			quantity: qty,
			price: prc,
			discountPercent: discPct,
			vatRate: vRate,
			exciseRate: exRate,
			vatMethod,
			taxes,
		});

		const item = await prisma[MODEL].create({
			data: {
				saleUuid,
				productUuid: productUuid || null,
				quantity: qty,
				price: prc,
				amount: calc.amount,
				amountWithoutVat: calc.amountWithoutVat,
				unitOfMeasureUuid: unitOfMeasureUuid || null,
				vatRate: vRate,
				vatAmount: calc.vatAmount,
				exciseRate: exRate,
				exciseAmount: calc.exciseAmount,
				discountPercent: discPct,
				discountAmount: calc.discountAmount,
				taxes: calc.taxes ?? undefined,
				// uuid строки документа-основания — для идемпотентного refill.
				...(req.body.sourceRowId ? { sourceRowId: String(req.body.sourceRowId) } : {}),
				// Партия (T6.1): выбрана по FEFO на строке реализации.
				batchUuid: req.body.batchUuid || null,
			},
			include: {
				product: { include: { brand: true } },
				unitOfMeasure: true,
			},
		});

		// Пересчитываем сумму документа
		await recalcSaleAmount(saleUuid);

		return res.status(201).json({ success: true, item });
	} catch (error) {
		console.error(`POST /${ROUTE} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── PUT ─────────────────────────────────────────────────────────────────
router.put(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		// Изоляция: править строку может только владелец реализации.
		const _owned = await prisma[MODEL].findUnique({ where: w, select: { saleUuid: true } });
		if (!_owned)
			return res.status(404).json({ success: false, message: "Не найдено" });
		if (!(await assertSaleOwned(_owned.saleUuid, req, res))) return;

		const data = {};
		// Prisma 7+ запрещает прямую запись скалярных FK (productUuid,
		// unitOfMeasureUuid) в update — нужно использовать вложенные
		// connect/disconnect через relation-поля.
		if (req.body.productUuid !== undefined) {
			data.product = req.body.productUuid
				? { connect: { uuid: req.body.productUuid } }
				: { disconnect: true };
		}
		// lineNumber управляется сервером автоматически — ручное обновление игнорируется
		if (req.body.unitOfMeasureUuid !== undefined) {
			data.unitOfMeasure = req.body.unitOfMeasureUuid
				? { connect: { uuid: req.body.unitOfMeasureUuid } }
				: { disconnect: true };
		}
		// Партия (T6.1): выбор по FEFO на строке реализации.
		if (req.body.batchUuid !== undefined) data.batchUuid = req.body.batchUuid || null;
		// Закрепляем sourceRowId на UPDATE (усыновление легаси-строк по основанию).
		if (req.body.sourceRowId !== undefined) {
			data.sourceRowId = req.body.sourceRowId ? String(req.body.sourceRowId) : null;
		}

		// parseFloat("") и parseFloat(null) → NaN. Превращаем NaN в undefined,
		// чтобы не записывать недопустимое значение в БД (Prisma пропустит).
		const parseNum = (v) => {
			if (v === undefined || v === null || v === "") return undefined;
			const n = parseFloat(v);
			return Number.isFinite(n) ? n : undefined;
		};

		const qty = parseNum(req.body.quantity);
		const prc = parseNum(req.body.price);
		const discPct = parseNum(req.body.discountPercent);
		const vRate = parseNum(req.body.vatRate);
		const exRate = parseNum(req.body.exciseRate);

		if (qty !== undefined) data.quantity = qty;
		if (prc !== undefined) data.price = prc;
		if (discPct !== undefined) data.discountPercent = discPct;
		if (vRate !== undefined) data.vatRate = vRate;
		if (exRate !== undefined) data.exciseRate = exRate;

		// Если обновились кол-во, цена, Сумма скидки, НДС, акциз или taxes — пересчитать суммы
		const recalcNeeded =
			qty !== undefined ||
			prc !== undefined ||
			discPct !== undefined ||
			vRate !== undefined ||
			exRate !== undefined ||
			req.body.taxes !== undefined;

		if (recalcNeeded) {
			const existing = await prisma[MODEL].findUnique({ where: w });
			if (!existing)
				return res.status(404).json({ success: false, message: "Не найдено" });
			const finalQty = qty !== undefined ? qty : Number(existing.quantity);
			const finalPrc = prc !== undefined ? prc : Number(existing.price);
			const finalDiscPct =
				discPct !== undefined ? discPct : Number(existing.discountPercent);
			const finalVatRate =
				vRate !== undefined ? vRate : Number(existing.vatRate);
			const finalExRate =
				exRate !== undefined ? exRate : Number(existing.exciseRate);
			const vatMethod = await loadVatMethodForSale(existing.saleUuid);

			// Источник массива taxes: payload (если задан), иначе существующий.
			const incomingTaxes = req.body.taxes;
			const existingTaxes = Array.isArray(existing.taxes)
				? existing.taxes
				: null;
			const sourceTaxes =
				incomingTaxes === undefined
					? existingTaxes
					: Array.isArray(incomingTaxes)
						? incomingTaxes
						: null;

			const calc = recalcLineAmounts({
				quantity: finalQty,
				price: finalPrc,
				discountPercent: finalDiscPct,
				vatRate: finalVatRate,
				exciseRate: finalExRate,
				vatMethod,
				taxes: sourceTaxes,
			});

			data.discountAmount = calc.discountAmount;
			data.exciseAmount = calc.exciseAmount;
			data.vatAmount = calc.vatAmount;
			data.amount = calc.amount;
			data.amountWithoutVat = calc.amountWithoutVat;
			if (incomingTaxes === null) {
				data.taxes = null;
			} else if (calc.taxes != null) {
				data.taxes = calc.taxes;
			}
		}

		const item = await prisma[MODEL].update({
			where: w,
			data,
			include: {
				product: { include: { brand: true } },
				unitOfMeasure: true,
			},
		});

		// Пересчитываем сумму документа
		await recalcSaleAmount(item.saleUuid);

		return res.status(200).json({ success: true, item });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`PUT /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── DELETE ──────────────────────────────────────────────────────────────
router.delete(`/${ROUTE}/:id`, async (req, res) => {
	try {
		const p = req.params.id;
		const n = Number(p);
		const w =
			!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

		const item = await prisma[MODEL].findUnique({ where: w });
		if (!item)
			return res.status(404).json({ success: false, message: "Не найдено" });
		// Изоляция: удалять строку может только владелец реализации.
		if (!(await assertSaleOwned(item.saleUuid, req, res))) return;

		await prisma[MODEL].delete({ where: w });

		// Пересчитываем сумму документа
		await recalcSaleAmount(item.saleUuid);

		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025")
			return res.status(404).json({ success: false, message: "Не найдено" });
		console.error(`DELETE /${ROUTE}/:id error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Пересчёт суммы документа Sale ──────────────────────────────────────
async function recalcSaleAmount(saleUuid) {
	try {
		const result = await prisma[MODEL].aggregate({
			where: { saleUuid },
			_sum: { amount: true, vatAmount: true, discountAmount: true },
		});
		const totalAmount = result._sum.amount ? Number(result._sum.amount) : 0;
		const totalVat = result._sum.vatAmount ? Number(result._sum.vatAmount) : 0;
		const totalDiscount = result._sum.discountAmount
			? Number(result._sum.discountAmount)
			: 0;
		const amountWithoutVat = Math.round((totalAmount - totalVat) * 100) / 100;
		await prisma.sale.update({
			where: { uuid: saleUuid },
			data: {
				amount: totalAmount,
				vatAmount: totalVat,
				discountAmount: totalDiscount,
				amountWithoutVat: amountWithoutVat,
			},
		});
		// Строки продажи изменились → пересобираем движения регистра товаров и
		// бухгалтерские проводки. Это единая точка после любой мутации строк
		// (POST/PUT/DELETE/batch). Сервисы сами пропускают непроведённые документы,
		// поэтому для черновиков — no-op. Гарантирует, что склад/проводки не
		// отстают от строк независимо от порядка сохранения шапки/строк на фронте.
		try { await reconcileDocumentRegister("sale", saleUuid); } catch (e) { console.error("reconcile register(sale)", e); }
		try { await reconcileDocumentEntries("sale", saleUuid); } catch (e) { console.error("reconcile entries(sale)", e); }
	} catch (err) {
		console.error("recalcSaleAmount error:", err);
	}
}

// ── POST /saleitems/batch ─────────────────────────────────────────────────
router.post(`/${ROUTE}/batch`, async (req, res) => {
	try {
		const { operations } = req.body;
		if (!Array.isArray(operations) || operations.length === 0)
			return res.status(400).json({ success: false, message: "operations обязателен" });

		let saleUuid = null;
		for (const op of operations) {
			if (op.data?.saleUuid) { saleUuid = op.data.saleUuid; break; }
		}
		if (!saleUuid) {
			const uuidOp = operations.find(op => op.uuid);
			if (uuidOp?.uuid) {
				const ex = await prisma[MODEL].findFirst({ where: { uuid: uuidOp.uuid }, select: { saleUuid: true } });
				saleUuid = ex?.saleUuid ?? null;
			}
		}

		// Изоляция: ВСЕ реализации, затронутые батчем, должны принадлежать юзеру.
		{
			const sales = new Set();
			const refItemUuids = [];
			for (const op of operations) {
				if (op.action === "create" && op.data?.saleUuid) sales.add(op.data.saleUuid);
				else if ((op.action === "update" || op.action === "delete") && op.uuid) refItemUuids.push(op.uuid);
			}
			if (refItemUuids.length) {
				const refItems = await prisma[MODEL].findMany({ where: { uuid: { in: refItemUuids } }, select: { saleUuid: true } });
				for (const it of refItems) if (it.saleUuid) sales.add(it.saleUuid);
			}
			for (const sUuid of sales) {
				if (!(await assertSaleOwned(sUuid, req, res))) return;
			}
		}

		const vatMethod = saleUuid ? await loadVatMethodForSale(saleUuid) : "INCLUDED";

		const parseNum = (v) => {
			if (v === undefined || v === null || v === "") return undefined;
			const n = parseFloat(v);
			return Number.isFinite(n) ? n : undefined;
		};

		await prisma.$transaction(async (tx) => {
			for (const op of operations) {
				const { action, uuid, data } = op;
				if (!action) continue;

				if (action === "create" && data) {
					if (!data.saleUuid) continue;
					const qty = parseFloat(data.quantity) || 0;
					const prc = parseFloat(data.price) || 0;
					const discPct = parseFloat(data.discountPercent) || 0;
					const vRate = data.vatRate != null ? parseFloat(data.vatRate) : 12;
					const exRate = parseFloat(data.exciseRate) || 0;
					const calc = recalcLineAmounts({ quantity: qty, price: prc, discountPercent: discPct, vatRate: vRate, exciseRate: exRate, vatMethod, taxes: data.taxes });
					await tx[MODEL].create({
						data: {
							saleUuid: data.saleUuid,
							productUuid: data.productUuid || null,
							quantity: qty, price: prc,
							amount: calc.amount, amountWithoutVat: calc.amountWithoutVat,
							unitOfMeasureUuid: data.unitOfMeasureUuid || null,
							vatRate: vRate, vatAmount: calc.vatAmount,
							exciseRate: exRate, exciseAmount: calc.exciseAmount,
							discountPercent: discPct, discountAmount: calc.discountAmount,
							taxes: calc.taxes ?? undefined,
							// Партия строки. Форма коммитит строки ПАЧКОЙ через этот эндпоинт,
							// а он раньше batchUuid не знал — выбор партии молча терялся
							// (в строке оставалась прежняя партия).
							batchUuid: data.batchUuid || null,
							...(data.sourceRowId ? { sourceRowId: String(data.sourceRowId) } : {}),
						},
					});
				} else if (action === "update" && uuid && data) {
					const w = { uuid };
					const updateData = {};
					if (data.productUuid !== undefined)
						updateData.product = data.productUuid ? { connect: { uuid: data.productUuid } } : { disconnect: true };
					if (data.unitOfMeasureUuid !== undefined)
						updateData.unitOfMeasure = data.unitOfMeasureUuid ? { connect: { uuid: data.unitOfMeasureUuid } } : { disconnect: true };
						if (data.sourceRowId !== undefined)
							updateData.sourceRowId = data.sourceRowId ? String(data.sourceRowId) : null;
					// Партия строки — см. комментарий в ветке create.
					if (data.batchUuid !== undefined) updateData.batchUuid = data.batchUuid || null;
					const qty = parseNum(data.quantity), prc = parseNum(data.price);
					const discPct = parseNum(data.discountPercent), vRate = parseNum(data.vatRate), exRate = parseNum(data.exciseRate);
					if (qty !== undefined) updateData.quantity = qty;
					if (prc !== undefined) updateData.price = prc;
					if (discPct !== undefined) updateData.discountPercent = discPct;
					if (vRate !== undefined) updateData.vatRate = vRate;
					if (exRate !== undefined) updateData.exciseRate = exRate;
					const recalcNeeded = qty !== undefined || prc !== undefined || discPct !== undefined || vRate !== undefined || exRate !== undefined || data.taxes !== undefined;
					if (recalcNeeded) {
						const existing = await tx[MODEL].findUnique({ where: w });
						if (existing) {
							const fQty = qty ?? Number(existing.quantity), fPrc = prc ?? Number(existing.price);
							const fDisc = discPct ?? Number(existing.discountPercent), fVat = vRate ?? Number(existing.vatRate), fEx = exRate ?? Number(existing.exciseRate);
							const srcTaxes = data.taxes === undefined ? (Array.isArray(existing.taxes) ? existing.taxes : null) : (Array.isArray(data.taxes) ? data.taxes : null);
							const calc = recalcLineAmounts({ quantity: fQty, price: fPrc, discountPercent: fDisc, vatRate: fVat, exciseRate: fEx, vatMethod, taxes: srcTaxes });
							Object.assign(updateData, { discountAmount: calc.discountAmount, exciseAmount: calc.exciseAmount, vatAmount: calc.vatAmount, amount: calc.amount, amountWithoutVat: calc.amountWithoutVat });
							if (data.taxes === null) updateData.taxes = null;
							else if (calc.taxes != null) updateData.taxes = calc.taxes;
						}
					}
					if (Object.keys(updateData).length > 0) await tx[MODEL].update({ where: w, data: updateData });
				} else if (action === "delete" && uuid) {
					try { await tx[MODEL].delete({ where: { uuid } }); } catch {}
				}
			}
		});

		if (saleUuid) await recalcSaleAmount(saleUuid);
		return res.status(200).json({ success: true });
	} catch (error) {
		console.error(`POST /${ROUTE}/batch error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
