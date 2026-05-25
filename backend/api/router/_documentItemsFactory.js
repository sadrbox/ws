// ─────────────────────────────────────────────────────────────────────────────
// Фабрика express-роутера для позиций торгового документа (НК РК ст. 412 ЭСФ).
//
// Параметры:
//   MODEL          — имя prisma-модели строки (camelCase): "purchaseItem"
//   ROUTE          — путь без слэша: "purchaseitems"
//   PARENT_MODEL   — имя prisma-модели документа: "purchase"
//   PARENT_FIELD   — имя FK поля в строке на документ: "purchaseUuid"
//   hasTaxes       — поддержка НДС/акциза/скидки/строкового taxes (Sale-подобные);
//                    false для InventoryTransferItem (внутренние перемещения
//                    не облагаются косвенными налогами — НК РК ст. 372 п.2 пп.3).
//
// Алгоритм расчёта строки (hasTaxes=true) идентичен saleitems.js:
//   base            = quantity × price
//   discountAmount  = base × discountPercent / 100
//   afterDiscount   = base − discountAmount
//   exciseAmount    = afterDiscount × exciseRate / 100      (НК РК ст. 463)
//   vatBase         = afterDiscount + exciseAmount
//   vatAmount       = INCLUDED: vatBase × r / (100 + r)
//                     ADDED:    vatBase × r / 100
//   amount          = INCLUDED: vatBase + ΣaddedTaxes
//                     ADDED:    vatBase + vatAmount + ΣaddedTaxes
//   amountWithoutVat= amount − vatAmount  (графа 13 ЭСФ РК)
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

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

function sumAddedTaxes(entries) {
	if (!Array.isArray(entries)) return 0;
	let s = 0;
	for (const t of entries) {
		if (String(t?.method ?? "").toUpperCase() === "ADDED")
			s += Number(t?.amount) || 0;
	}
	return Math.round(s * 100) / 100;
}

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

/**
 * Загрузить денормализованные поля родительского документа для записи в строку.
 * Возвращает { date, posted, organizationUuid, counterpartyUuid }.
 */
async function loadParentDenormFields(PARENT_MODEL, parentUuid) {
	if (!parentUuid) return {};
	try {
		const doc = await prisma[PARENT_MODEL].findUnique({
			where: { uuid: parentUuid },
			select: { date: true, posted: true, organizationUuid: true, counterpartyUuid: true },
		});
		if (!doc) return {};
		return {
			date: doc.date ?? null,
			posted: doc.posted === true,
			organizationUuid: doc.organizationUuid ?? null,
			counterpartyUuid: doc.counterpartyUuid ?? null,
		};
	} catch {
		return {};
	}
}

/**
 * Синхронизировать денормализованные поля всех строк документа.
 * Вызывается из роутера родительского документа после его обновления.
 */
export async function syncItemsFromParent(ITEM_MODEL, PARENT_FIELD, parentUuid, parentData) {
	try {
		await prisma[ITEM_MODEL].updateMany({
			where: { [PARENT_FIELD]: parentUuid },
			data: {
				date: parentData.date ?? null,
				posted: parentData.posted === true,
				organizationUuid: parentData.organizationUuid ?? null,
				counterpartyUuid: parentData.counterpartyUuid ?? null,
			},
		});
	} catch (err) {
		console.error(`syncItemsFromParent(${ITEM_MODEL}) error:`, err);
	}
}

/**
 * Загрузка метода расчёта НДС (INCLUDED/ADDED) из настроек учёта организации,
 * к которой относится родительский документ.
 */
async function loadVatMethodForParent(PARENT_MODEL, parentUuid) {
	if (!parentUuid) return "INCLUDED";
	try {
		const doc = await prisma[PARENT_MODEL].findUnique({
			where: { uuid: parentUuid },
			select: { organizationUuid: true, date: true },
		});
		if (!doc?.organizationUuid) return "INCLUDED";
		const where = { organizationUuid: doc.organizationUuid };
		if (doc.date) where.startDate = { lte: doc.date };
		let settings = await prisma.organizationAccountingSetting.findFirst({
			where,
			orderBy: { id: "desc" },
			select: { vatCalculationMethod: true },
		});
		if (!settings) {
			settings = await prisma.organizationAccountingSetting.findFirst({
				where: { organizationUuid: doc.organizationUuid, deletedAt: null },
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

export function createDocumentItemsRouter({
	MODEL,
	ROUTE,
	PARENT_MODEL,
	PARENT_FIELD,
	hasTaxes = true,
}) {
	const router = express.Router();

	// ── Пересчёт суммы родительского документа ───────────────────────────
	async function recalcParentAmount(parentUuid) {
		try {
			if (hasTaxes) {
				const result = await prisma[MODEL].aggregate({
					where: { [PARENT_FIELD]: parentUuid },
					_sum: { amount: true, vatAmount: true, discountAmount: true },
				});
				const totalAmount = result._sum.amount ? Number(result._sum.amount) : 0;
				const totalVat = result._sum.vatAmount
					? Number(result._sum.vatAmount)
					: 0;
				const totalDiscount = result._sum.discountAmount
					? Number(result._sum.discountAmount)
					: 0;
				const amountWithoutVat =
					Math.round((totalAmount - totalVat) * 100) / 100;
				await prisma[PARENT_MODEL].update({
					where: { uuid: parentUuid },
					data: {
						amount: totalAmount,
						vatAmount: totalVat,
						discountAmount: totalDiscount,
						amountWithoutVat,
					},
				});
			} else {
				// ТМЗ: только сумма quantity × price (без косвенных налогов)
				const result = await prisma[MODEL].aggregate({
					where: { [PARENT_FIELD]: parentUuid },
					_sum: { amount: true },
				});
				const totalAmount = result._sum.amount ? Number(result._sum.amount) : 0;
				await prisma[PARENT_MODEL].update({
					where: { uuid: parentUuid },
					data: { amount: totalAmount },
				});
			}
		} catch (err) {
			console.error(`recalcParentAmount(${PARENT_MODEL}) error:`, err);
		}
	}

	const NESTED_SORT_FIELDS = {
		"product.name": { product: { name: "asc" } },
		"unitOfMeasure.name": { unitOfMeasure: { name: "asc" } },
	};

	// ── GET list ─────────────────────────────────────────────────────────
	router.get(`/${ROUTE}`, async (req, res) => {
		try {
			const parentParam = req.query[PARENT_FIELD];
			const parentUuid =
				typeof parentParam === "string" ? parentParam.trim() : "";
			if (!parentUuid)
				return res
					.status(400)
					.json({ success: false, message: `${PARENT_FIELD} обязателен` });

			const orderBy = [];
			const sortParam =
				typeof req.query.sort === "string" ? req.query.sort : null;
			if (sortParam) {
				try {
					const s = JSON.parse(sortParam);
					if (s && typeof s === "object")
						for (const [f, d] of Object.entries(s)) {
							if (d !== "asc" && d !== "desc") continue;
							if (NESTED_SORT_FIELDS[f]) {
								const nested = JSON.parse(
									JSON.stringify(NESTED_SORT_FIELDS[f]),
								);
								const setDir = (obj) => {
									for (const k of Object.keys(obj)) {
										if (typeof obj[k] === "object") setDir(obj[k]);
										else obj[k] = d;
									}
								};
								setDir(nested);
								orderBy.push(nested);
							} else {
								orderBy.push({ [f]: d });
							}
						}
				} catch {}
			}
			if (orderBy.length === 0) orderBy.push({ id: "asc" });
			else if (!orderBy.some((o) => "id" in o)) orderBy.push({ id: "asc" });

			const items = await prisma[MODEL].findMany({
				where: { [PARENT_FIELD]: parentUuid },
				orderBy,
				include: {
					product: { include: { brand: true } },
					unitOfMeasure: true,
				},
			});
			return res
				.status(200)
				.json({ success: true, items, total: items.length });
		} catch (error) {
			console.error(`GET /${ROUTE} error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── GET by id ────────────────────────────────────────────────────────
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
			return res.status(200).json({ success: true, item });
		} catch (error) {
			console.error(`GET /${ROUTE}/:id error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── POST ─────────────────────────────────────────────────────────────
	router.post(`/${ROUTE}`, async (req, res) => {
		try {
			const parentUuid = req.body[PARENT_FIELD];
			const {
				productUuid,
				quantity,
				price,
				unitOfMeasureUuid,
				vatRate,
				exciseRate,
				discountPercent,
				taxes,
			} = req.body;
			if (!parentUuid)
				return res
					.status(400)
					.json({ success: false, message: `${PARENT_FIELD} обязателен` });
			const qty = quantity != null ? parseFloat(quantity) : 0;
			const prc = price != null ? parseFloat(price) : 0;
			const denorm = await loadParentDenormFields(PARENT_MODEL, parentUuid);

			let data;
			if (hasTaxes) {
				const discPct =
					discountPercent != null ? parseFloat(discountPercent) : 0;
				const vRate = vatRate != null ? parseFloat(vatRate) : 12;
				const exRate = exciseRate != null ? parseFloat(exciseRate) : 0;
				const vatMethod = await loadVatMethodForParent(
					PARENT_MODEL,
					parentUuid,
				);
				const calc = recalcLineAmounts({
					quantity: qty,
					price: prc,
					discountPercent: discPct,
					vatRate: vRate,
					exciseRate: exRate,
					vatMethod,
					taxes,
				});
				data = {
					[PARENT_FIELD]: parentUuid,
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
					...denorm,
				};
			} else {
				const amount = Math.round(qty * prc * 100) / 100;
				data = {
					[PARENT_FIELD]: parentUuid,
					productUuid: productUuid || null,
					quantity: qty,
					price: prc,
					amount,
					unitOfMeasureUuid: unitOfMeasureUuid || null,
				};
			}

			const item = await prisma[MODEL].create({
				data,
				include: {
					product: { include: { brand: true } },
					unitOfMeasure: true,
				},
			});
			await recalcParentAmount(parentUuid);
			return res.status(201).json({ success: true, item });
		} catch (error) {
			console.error(`POST /${ROUTE} error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── PUT ──────────────────────────────────────────────────────────────
	router.put(`/${ROUTE}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w =
				!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

			const data = {};
			if (req.body.productUuid !== undefined) {
				data.product = req.body.productUuid
					? { connect: { uuid: req.body.productUuid } }
					: { disconnect: true };
			}
			if (req.body.unitOfMeasureUuid !== undefined) {
				data.unitOfMeasure = req.body.unitOfMeasureUuid
					? { connect: { uuid: req.body.unitOfMeasureUuid } }
					: { disconnect: true };
			}

			const parseNum = (v) => {
				if (v === undefined || v === null || v === "") return undefined;
				const n = parseFloat(v);
				return Number.isFinite(n) ? n : undefined;
			};
			const qty = parseNum(req.body.quantity);
			const prc = parseNum(req.body.price);

			if (qty !== undefined) data.quantity = qty;
			if (prc !== undefined) data.price = prc;

			if (hasTaxes) {
				const discPct = parseNum(req.body.discountPercent);
				const vRate = parseNum(req.body.vatRate);
				const exRate = parseNum(req.body.exciseRate);
				if (discPct !== undefined) data.discountPercent = discPct;
				if (vRate !== undefined) data.vatRate = vRate;
				if (exRate !== undefined) data.exciseRate = exRate;

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
						return res
							.status(404)
							.json({ success: false, message: "Не найдено" });
					const finalQty = qty !== undefined ? qty : Number(existing.quantity);
					const finalPrc = prc !== undefined ? prc : Number(existing.price);
					const finalDiscPct =
						discPct !== undefined ? discPct : Number(existing.discountPercent);
					const finalVatRate =
						vRate !== undefined ? vRate : Number(existing.vatRate);
					const finalExRate =
						exRate !== undefined ? exRate : Number(existing.exciseRate);
					const vatMethod = await loadVatMethodForParent(
						PARENT_MODEL,
						existing[PARENT_FIELD],
					);
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
			} else {
				// ТМЗ: amount = qty × price
				if (qty !== undefined || prc !== undefined) {
					const existing = await prisma[MODEL].findUnique({ where: w });
					if (!existing)
						return res
							.status(404)
							.json({ success: false, message: "Не найдено" });
					const finalQty = qty !== undefined ? qty : Number(existing.quantity);
					const finalPrc = prc !== undefined ? prc : Number(existing.price);
					data.amount = Math.round(finalQty * finalPrc * 100) / 100;
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
			await recalcParentAmount(item[PARENT_FIELD]);
			return res.status(200).json({ success: true, item });
		} catch (error) {
			if (error.code === "P2025")
				return res.status(404).json({ success: false, message: "Не найдено" });
			console.error(`PUT /${ROUTE}/:id error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── DELETE ───────────────────────────────────────────────────────────
	router.delete(`/${ROUTE}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w =
				!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };
			const item = await prisma[MODEL].findUnique({ where: w });
			if (!item)
				return res.status(404).json({ success: false, message: "Не найдено" });
			await prisma[MODEL].delete({ where: w });
			await recalcParentAmount(item[PARENT_FIELD]);
			return res.status(200).json({ success: true, message: "Удалено" });
		} catch (error) {
			if (error.code === "P2025")
				return res.status(404).json({ success: false, message: "Не найдено" });
			console.error(`DELETE /${ROUTE}/:id error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	});

	return router;
}

export default createDocumentItemsRouter;
