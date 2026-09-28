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
//   client         — prisma-клиент (для тестов; по умолчанию общий prisma).
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
//
// ЗАПИСЬ СТРОК — ОДНА ОПЕРАЦИЯ (аудит 26.09, У1–У3). Любая правка строк (POST/PUT/DELETE/
// batch) идёт так:
//   1. владелец документа И открытый период: строки проведённого документа закрытого месяца
//      больше не меняются в обход блокировки (раньше проверялся только владелец, а пересбор
//      потом переписывал закрытые обороты, остатки и снапшоты ФИФО) — 423;
//   2. в ОДНОЙ транзакции под блокировкой документа: запись строк → сумма шапки → контроль
//      остатка (по новым строкам, до пересбора; блокировки товаров) → возврат не больше
//      проданного → пересбор регистра, проводок и резервов. Отказ любой проверки или сбой
//      откатывает всё: строки, сумма, регистр и ГК не расходятся (раньше 409 приходил
//      ПОСЛЕ записи строк — строки и сумма менялись, а регистр и проводки оставались от
//      старых строк);
//   3. после фиксации — пересчёт себестоимости хвоста, если документ проведён задним числом
//      (в фоне, см. recomputeCosting).
// Проверить потом (У3): шапка всё ещё пишется ОТДЕЛЬНЫМ запросом до строк (frontend
// useFormStore: PUT шапки → batch строк). Проверки PUT шапки (серии, партии, assertPostable)
// идут по строкам из БД, а строки затем проверяются здесь заново — рассинхрона регистра и ГК
// уже нет, но проведение «шапка + новые строки» не одна операция: при отказе на строках шапка
// остаётся проведённой со старыми строками. Нужен единый эндпоинт «шапка + строки» (фабрики
// шапок — зона «backend-безопасность», useFormStore — frontend).
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/prisma-client.js";
import { checkOwnership } from "../../utils/auth.js";
import { buildOrderBy } from "../../utils/sortOrder.js";
import {
	reconcileByParentModel,
	assertStockAvailable,
	stockPairsOfDocument,
	documentTypeForParentModel,
	respondStockError,
} from "../../services/productRegister.js";
import {
	reconcileByParentModel as reconcileEntriesByParentModel,
	documentTypeForParentModel as postingTypeForParentModel,
	respondPostingError,
} from "../../services/accountingPosting.js";
import { reconcileReservationByParentModel } from "../../services/reservationRegister.js";
import { PERIOD_LOCKED_MODELS, assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { lockDocument, lockStockPairs, POSTING_TX_OPTIONS } from "../../services/documentLock.js";
import { recomputeIfRetroactive } from "../../services/recomputeCosting.js";
import { assertReturnWithinBasis, respondBasisError } from "../../services/basisValidation.js";
import { r2 } from "../../services/money.js";

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
					? r2((amountAfterDiscount * rate) / (100 + rate))
					: r2((amountAfterDiscount * rate) / 100);
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
	return r2(s);
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
	return r2(v);
}

export function recalcLineAmounts(input) {
	const qty = Number(input.quantity) || 0;
	const prc = Number(input.price) || 0;
	const discPct = Number(input.discountPercent) || 0;
	const vRate = Number(input.vatRate) || 0;
	const exciseRate = Number(input.exciseRate) || 0;
	const vatMethod =
		String(input.vatMethod ?? "INCLUDED").toUpperCase() === "ADDED"
			? "ADDED"
			: "INCLUDED";
	const base = r2(qty * prc);
	const discountAmount = r2((base * discPct) / 100);
	const afterDiscount = r2(base - discountAmount);
	const exciseAmount =
		exciseRate > 0
			? r2((afterDiscount * exciseRate) / 100)
			: 0;
	const vatBase = r2(afterDiscount + exciseAmount);
	const vatAmount = calcVatAmount(vatBase, vRate, vatMethod);
	const recomputedTaxes = recalcTaxes(vatBase, input.taxes);
	const vatAddedDelta = vatMethod === "ADDED" ? vatAmount : 0;
	const amount = r2(vatBase + sumAddedTaxes(recomputedTaxes) + vatAddedDelta);
	const amountWithoutVat = r2(amount - vatAmount);
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
async function loadParentDenormFields(PARENT_MODEL, parentUuid, client = prisma) {
	if (!parentUuid) return {};
	try {
		const doc = await client[PARENT_MODEL].findUnique({
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
export async function syncItemsFromParent(ITEM_MODEL, PARENT_FIELD, parentUuid, parentData, client = prisma) {
	try {
		await client[ITEM_MODEL].updateMany({
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
async function loadVatMethodForParent(PARENT_MODEL, parentUuid, client = prisma) {
	if (!parentUuid) return "INCLUDED";
	try {
		const doc = await client[PARENT_MODEL].findUnique({
			where: { uuid: parentUuid },
			select: { organizationUuid: true, date: true },
		});
		if (!doc?.organizationUuid) return "INCLUDED";
		const where = { organizationUuid: doc.organizationUuid };
		if (doc.date) where.startDate = { lte: doc.date };
		let settings = await client.organizationAccountingSetting.findFirst({
			where,
			orderBy: { id: "desc" },
			select: { vatCalculationMethod: true },
		});
		if (!settings) {
			settings = await client.organizationAccountingSetting.findFirst({
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

/** Отказ в данных строки (→ 422). */
export class LineValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = "LineValidationError";
	}
}

/**
 * Отрицательное количество в строке — отказ (аудит 26.09, У9): у расхода «−5» увеличивало
 * бы остаток в обход контроля, у прихода — уменьшало без проверки. Возврат оформляется
 * своим документом, а не минусом в строке.
 */
export function assertLineQuantity(value) {
	if (value === undefined || value === null || value === "") return;
	const n = Number(value);
	if (!Number.isFinite(n)) throw new LineValidationError("Количество в строке должно быть числом");
	if (n < 0) throw new LineValidationError("Количество в строке не может быть отрицательным");
}

/** Общий ответ на ошибки записи строк. true — ответ отправлен. */
export function respondItemsError(error, res) {
	if (error instanceof LineValidationError) {
		res.status(422).json({ success: false, message: error.message });
		return true;
	}
	return respondPeriodLockError(error, res)
		|| respondStockError(error, res)
		|| respondBasisError(error, res)
		|| respondPostingError(error, res);
}

export function createDocumentItemsRouter({
	MODEL,
	ROUTE,
	PARENT_MODEL,
	PARENT_FIELD,
	hasTaxes = true,
	// Модель строки имеет колонку sourceRowId (uuid строки документа-основания)
	// — включается для документов-приёмников «Перезаполнить по основанию»,
	// чтобы refill был идемпотентным (без дублирования строк).
	hasSourceRowId = false,
	// Модель строки имеет пер-строчные поля ЭСФ (tnvedCode/truOriginCode) —
	// только для позиций СФ исходящей (переопределяют карточку товара).
	esfLineFields = false,
	// Произвольные строковые поля строки (напр. positionNumber у позиций ГТД) —
	// просто пробрасываются в create/update без спец-логики.
	extraStringFields = [],
	// Произвольные числовые поля строки (напр. accountingQuantity у Инвентаризации).
	extraNumberFields = [],
	client = prisma,
}) {
	const router = express.Router();
	const db = client;
	const ITEM_INCLUDE = { product: { include: { brand: true } }, unitOfMeasure: true };

	// Документ-регистратор (регистр товаров) и тип проведения (проводки) родителя.
	const registerType = documentTypeForParentModel(PARENT_MODEL);
	const postingType = postingTypeForParentModel(PARENT_MODEL);
	const lockType = postingType ?? registerType ?? PARENT_MODEL;
	const periodLocked = PERIOD_LOCKED_MODELS.has(PARENT_MODEL);

	/** Пер-строчные ЭСФ-поля строки (только для моделей с esfLineFields). */
	const ESF_LINE_FIELDS = ["tnvedCode", "truOriginCode", "productDeclaration", "productNumberInDeclaration"];
	const esfFields = (body) => (esfLineFields
		? Object.fromEntries(ESF_LINE_FIELDS.map((f) => [f, body[f] || null]))
		: {});
	/** Произвольные строковые поля строки (positionNumber и т.п.). */
	const extraFields = (body) => ({
		...Object.fromEntries(extraStringFields.map((f) => [f, body[f] != null ? String(body[f]).trim() || null : null])),
		...Object.fromEntries(extraNumberFields.map((f) => [f, body[f] != null && body[f] !== "" ? Number(body[f]) || 0 : 0])),
	});
	/** sourceRowId строки (идемпотентный refill по основанию). */
	const sourceRow = (body) => (hasSourceRowId && body.sourceRowId ? { sourceRowId: String(body.sourceRowId) } : {});

	// Изоляция: строки документа доступны только если РОДИТЕЛЬСКИЙ документ
	// принадлежит организации пользователя (строки сами по себе фильтра не имеют).
	// write=true — ещё и открытый период документа (У1): иначе 423.
	// Возвращает true если доступ есть; иначе уже отправлен ответ.
	async function assertParentOwned(parentUuid, req, res, { write = false } = {}) {
		if (!parentUuid) {
			res.status(404).json({ success: false, message: "Документ не найден" });
			return false;
		}
		const parent = await db[PARENT_MODEL].findUnique({
			where: { uuid: parentUuid },
			select: { organizationUuid: true, ...(periodLocked ? { date: true } : {}) },
		});
		if (!parent || !checkOwnership(parent, req)) {
			res.status(404).json({ success: false, message: "Документ не найден" });
			return false;
		}
		if (write && periodLocked) {
			try {
				await assertPeriodOpen(parent.organizationUuid, parent.date, db);
			} catch (err) {
				if (respondPeriodLockError(err, res)) return false;
				throw err;
			}
		}
		return true;
	}

	// ── Сумма документа по строкам (внутри транзакции записи) ─────────────────
	/*
	 * Итоговые поля — только те, что есть у документа-родителя по схеме (КР-2 аудита 27.09). У инвентаризации
	 * (StockCount) суммы нет вовсе: раньше её «пересчёт» падал внутри try/catch и молча пропускался, а с переносом
	 * в транзакцию записи строк та же ошибка (`Unknown argument amount`) откатывала сами строки — 500 на любой записи.
	 */
	const parentFields = (() => {
		const model = Prisma.dmmf?.datamodel?.models?.find((m) => m.name.toLowerCase() === String(PARENT_MODEL).toLowerCase());
		return model ? new Set(model.fields.map((f) => f.name)) : null;
	})();
	const parentTotals = (data) => {
		if (!parentFields) return data;
		return Object.fromEntries(Object.entries(data).filter(([k]) => parentFields.has(k)));
	};

	async function recalcParentTotals(parentUuid, tx) {
		// Поступление: к сумме ТМЗ добавляется табличная часть «Основные средства»
		// (аудит 26.09, У8) — иначе запись строк ТМЗ затирала итог, собранный формой.
		const fa = PARENT_MODEL === "purchase" && tx.purchaseFixedAssetItem
			? await tx.purchaseFixedAssetItem.aggregate({
				where: { purchaseUuid: parentUuid, deletedAt: null },
				_sum: { amount: true, vatAmount: true },
			})
			: null;
		const faAmount = Number(fa?._sum?.amount) || 0;
		const faVat = Number(fa?._sum?.vatAmount) || 0;
		if (hasTaxes) {
			const result = await tx[MODEL].aggregate({
				where: { [PARENT_FIELD]: parentUuid },
				_sum: { amount: true, vatAmount: true, discountAmount: true },
			});
			const totalAmount = r2((Number(result._sum.amount) || 0) + faAmount);
			const totalVat = r2((Number(result._sum.vatAmount) || 0) + faVat);
			const totalDiscount = r2(Number(result._sum.discountAmount) || 0);
			const totals = parentTotals({
				amount: totalAmount,
				vatAmount: totalVat,
				discountAmount: totalDiscount,
				amountWithoutVat: r2(totalAmount - totalVat),
			});
			if (Object.keys(totals).length) await tx[PARENT_MODEL].update({ where: { uuid: parentUuid }, data: totals });
		} else {
			// ТМЗ: только сумма quantity × price (Сумма без налогов). Итога у родителя нет (инвентаризация) — нечего писать.
			if (parentFields && !parentFields.has("amount")) return;
			const result = await tx[MODEL].aggregate({
				where: { [PARENT_FIELD]: parentUuid },
				_sum: { amount: true },
			});
			await tx[PARENT_MODEL].update({
				where: { uuid: parentUuid },
				data: { amount: r2(Number(result._sum.amount) || 0) },
			});
		}
	}

	// ── Сумма + проверки + пересбор регистров и проводок (внутри транзакции) ──
	async function repostParent(parentUuid, tx) {
		await recalcParentTotals(parentUuid, tx);
		// Контроль остатка по НОВЫМ строкам ДО пересбора регистра (в регистре ещё прежние
		// движения документа): отказ откатывает и строки, и сумму.
		if (registerType) await assertStockAvailable(registerType, parentUuid, tx);
		// Возврат не больше проданного/купленного по основанию (проведённый возврат).
		if (postingType === "sale_return" || postingType === "purchase_return") {
			await assertReturnWithinBasis(postingType, parentUuid, {}, tx);
		}
		// Строки документа изменились — пересобираем движения регистра товаров,
		// проводки и резервы (сервисы сами пропускают непроведённые документы).
		if (registerType) await reconcileByParentModel(PARENT_MODEL, parentUuid, tx);
		if (postingType) await reconcileEntriesByParentModel(PARENT_MODEL, parentUuid, tx);
		await reconcileReservationByParentModel(PARENT_MODEL, parentUuid, tx);
	}

	/**
	 * Выполнить work(tx) и пересбор затронутых документов ОДНОЙ транзакцией под
	 * блокировками документов (в отсортированном порядке — без взаимного ожидания).
	 */
	async function mutateLines(parentUuids, work) {
		const parents = [...new Set(parentUuids.filter(Boolean))].sort();
		const result = await db.$transaction(async (tx) => {
			for (const p of parents) await lockDocument(tx, lockType, p);
			const r = await work(tx);
			// Товары всех документов пакета — ОДНИМ отсортированным набором до проверок (P3 аудита
			// 27.09): раньше каждый документ брал свои по очереди, и два пакета с общими товарами
			// могли ждать друг друга по кругу (deadlock → 500). Проверка остатка ниже берёт те же
			// локи повторно — в своей транзакции это мгновенно.
			if (registerType && parents.length > 1) {
				const pairs = [];
				for (const p of parents) pairs.push(...(await stockPairsOfDocument(registerType, p, tx)));
				await lockStockPairs(tx, pairs);
			}
			for (const p of parents) await repostParent(p, tx);
			return r;
		}, POSTING_TX_OPTIONS);
		// Строки проведённого документа задним числом меняют себестоимость последующих
		// документов — пересчёт хвоста (в фоне; не для черновиков и не для документов без
		// регистра).
		if (registerType) {
			for (const p of parents) {
				try {
					const doc = await db[PARENT_MODEL].findUnique({ where: { uuid: p }, select: { organizationUuid: true, date: true, posted: true } });
					if (doc?.posted) await recomputeIfRetroactive({ organizationUuid: doc.organizationUuid, date: doc.date }, db);
				} catch (err) {
					console.error(`recompute after ${ROUTE} error:`, err?.message ?? err);
				}
			}
		}
		return result;
	}

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
			// Изоляция: строки чужого документа не отдаём.
			if (!(await assertParentOwned(parentUuid, req, res))) return;

			// Сортировка по схеме: скаляры и пути "связь.поле" (product.name и т.п.)
			// пропускаются, виртуальные колонки (serials/batch/lineNumber/…) — нет.
			const orderBy = buildOrderBy(MODEL, req.query.sort);

			const items = await db[MODEL].findMany({
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
			const item = await db[MODEL].findUnique({
				where: w,
				include: {
					product: { include: { brand: true } },
					unitOfMeasure: true,
				},
			});
			if (!item)
				return res.status(404).json({ success: false, message: "Не найдено" });
			// Изоляция: строка доступна только если её документ принадлежит юзеру.
			if (!(await assertParentOwned(item[PARENT_FIELD], req, res))) return;
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
			// Изоляция: создавать строку можно только в своём документе открытого периода.
			if (!(await assertParentOwned(parentUuid, req, res, { write: true }))) return;
			assertLineQuantity(quantity);
			const qty = quantity != null ? parseFloat(quantity) : 0;
			const prc = price != null ? parseFloat(price) : 0;
			const denorm = await loadParentDenormFields(PARENT_MODEL, parentUuid, db);

			let data;
			if (hasTaxes) {
				const discPct =
					discountPercent != null ? parseFloat(discountPercent) : 0;
				const vRate = vatRate != null ? parseFloat(vatRate) : 12;
				const exRate = exciseRate != null ? parseFloat(exciseRate) : 0;
				const vatMethod = await loadVatMethodForParent(
					PARENT_MODEL,
					parentUuid,
					db,
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
					...sourceRow(req.body),
					...esfFields(req.body),
					...extraFields(req.body),
					...denorm,
				};
			} else {
				data = {
					[PARENT_FIELD]: parentUuid,
					productUuid: productUuid || null,
					quantity: qty,
					price: prc,
					amount: r2(qty * prc),
					unitOfMeasureUuid: unitOfMeasureUuid || null,
					...sourceRow(req.body),
					...esfFields(req.body),
					...extraFields(req.body),
				};
			}

			// Связи (товар, единица) — после фиксации: внутри транзакции Prisma грузит include
			// параллельными запросами, а у транзакции одно соединение.
			const created = await mutateLines([parentUuid], (tx) => tx[MODEL].create({ data, select: { uuid: true } }));
			const item = await db[MODEL].findUnique({ where: { uuid: created.uuid }, include: ITEM_INCLUDE });
			return res.status(201).json({ success: true, item });
		} catch (error) {
			if (respondItemsError(error, res)) return;
			console.error(`POST /${ROUTE} error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	});

	/**
	 * Данные обновления строки (общие для PUT и batch update). existingOf — ленивое
	 * чтение текущей строки (для пересчёта сумм).
	 */
	async function buildUpdateData(body, existingOf, vatMethodOf) {
		const data = {};
		if (body.productUuid !== undefined) {
			data.product = body.productUuid
				? { connect: { uuid: body.productUuid } }
				: { disconnect: true };
		}
		if (body.unitOfMeasureUuid !== undefined) {
			data.unitOfMeasure = body.unitOfMeasureUuid
				? { connect: { uuid: body.unitOfMeasureUuid } }
				: { disconnect: true };
		}
		// Закрепляем sourceRowId на UPDATE — чтобы «усыновление» легаси-строк
		// по основанию (без sourceRowId) сохранялось после первого перезаполнения.
		if (hasSourceRowId && body.sourceRowId !== undefined) {
			data.sourceRowId = body.sourceRowId ? String(body.sourceRowId) : null;
		}
		if (esfLineFields) {
			for (const f of ESF_LINE_FIELDS) if (body[f] !== undefined) data[f] = body[f] || null;
		}
		for (const f of extraStringFields) {
			if (body[f] !== undefined) data[f] = body[f] != null ? String(body[f]).trim() || null : null;
		}
		// Числовые доп. поля (accountingQuantity у инвентаризации) — раньше пакетное
		// обновление их не знало, и учётное количество не сохранялось (У8).
		for (const f of extraNumberFields) {
			if (body[f] !== undefined) data[f] = body[f] != null && body[f] !== "" ? Number(body[f]) || 0 : 0;
		}

		assertLineQuantity(body.quantity);
		const parseNum = (v) => {
			if (v === undefined || v === null || v === "") return undefined;
			const n = parseFloat(v);
			return Number.isFinite(n) ? n : undefined;
		};
		const qty = parseNum(body.quantity);
		const prc = parseNum(body.price);
		if (qty !== undefined) data.quantity = qty;
		if (prc !== undefined) data.price = prc;

		if (hasTaxes) {
			const discPct = parseNum(body.discountPercent);
			const vRate = parseNum(body.vatRate);
			const exRate = parseNum(body.exciseRate);
			if (discPct !== undefined) data.discountPercent = discPct;
			if (vRate !== undefined) data.vatRate = vRate;
			if (exRate !== undefined) data.exciseRate = exRate;

			const recalcNeeded =
				qty !== undefined ||
				prc !== undefined ||
				discPct !== undefined ||
				vRate !== undefined ||
				exRate !== undefined ||
				body.taxes !== undefined;

			if (recalcNeeded) {
				const existing = await existingOf();
				if (!existing) return null;
				const incomingTaxes = body.taxes;
				const existingTaxes = Array.isArray(existing.taxes) ? existing.taxes : null;
				const sourceTaxes =
					incomingTaxes === undefined
						? existingTaxes
						: Array.isArray(incomingTaxes)
							? incomingTaxes
							: null;
				const calc = recalcLineAmounts({
					quantity: qty !== undefined ? qty : Number(existing.quantity),
					price: prc !== undefined ? prc : Number(existing.price),
					discountPercent: discPct !== undefined ? discPct : Number(existing.discountPercent),
					vatRate: vRate !== undefined ? vRate : Number(existing.vatRate),
					exciseRate: exRate !== undefined ? exRate : Number(existing.exciseRate),
					vatMethod: await vatMethodOf(existing),
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
		} else if (qty !== undefined || prc !== undefined) {
			// ТМЗ: amount = qty × price
			const existing = await existingOf();
			if (!existing) return null;
			const finalQty = qty !== undefined ? qty : Number(existing.quantity);
			const finalPrc = prc !== undefined ? prc : Number(existing.price);
			data.amount = r2(finalQty * finalPrc);
		}
		return data;
	}

	// ── PUT ──────────────────────────────────────────────────────────────
	router.put(`/${ROUTE}/:id`, async (req, res) => {
		try {
			const p = req.params.id;
			const n = Number(p);
			const w =
				!isNaN(n) && Number.isInteger(n) && n > 0 ? { id: n } : { uuid: p };

			// Изоляция: править строку может только владелец документа-родителя.
			const _owned = await db[MODEL].findUnique({ where: w, select: { [PARENT_FIELD]: true } });
			if (!_owned)
				return res.status(404).json({ success: false, message: "Не найдено" });
			const parentUuid = _owned[PARENT_FIELD];
			if (!(await assertParentOwned(parentUuid, req, res, { write: true }))) return;

			const data = await buildUpdateData(
				req.body,
				() => db[MODEL].findUnique({ where: w }),
				(existing) => loadVatMethodForParent(PARENT_MODEL, existing[PARENT_FIELD], db),
			);
			if (!data)
				return res.status(404).json({ success: false, message: "Не найдено" });

			const updated = await mutateLines([parentUuid], (tx) => tx[MODEL].update({ where: w, data, select: { uuid: true } }));
			const item = await db[MODEL].findUnique({ where: { uuid: updated.uuid }, include: ITEM_INCLUDE });
			return res.status(200).json({ success: true, item });
		} catch (error) {
			if (respondItemsError(error, res)) return;
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
			const item = await db[MODEL].findUnique({ where: w });
			if (!item)
				return res.status(404).json({ success: false, message: "Не найдено" });
			// Изоляция: удалять строку может только владелец документа-родителя.
			if (!(await assertParentOwned(item[PARENT_FIELD], req, res, { write: true }))) return;
			await mutateLines([item[PARENT_FIELD]], (tx) => tx[MODEL].delete({ where: w }));
			return res.status(200).json({ success: true, message: "Удалено" });
		} catch (error) {
			if (respondItemsError(error, res)) return;
			if (error.code === "P2025")
				return res.status(404).json({ success: false, message: "Не найдено" });
			console.error(`DELETE /${ROUTE}/:id error:`, error);
			return res
				.status(500)
				.json({ success: false, message: "Ошибка сервера" });
		}
	});

	// ── POST /batch ──────────────────────────────────────────────────────────
	router.post(`/${ROUTE}/batch`, async (req, res) => {
		try {
			const { operations } = req.body;
			if (!Array.isArray(operations) || operations.length === 0)
				return res.status(400).json({ success: false, message: "operations обязателен" });

			// Изоляция и период: ВСЕ документы-родители, затронутые батчем (create по data,
			// update/delete по строке), должны принадлежать организации пользователя и быть
			// в открытом периоде. Любая чужая ссылка → отказ для всего батча (ничего не пишем).
			const parents = new Set();
			const itemParent = new Map(); // uuid строки → документ
			{
				const refItemUuids = [];
				for (const op of operations) {
					if (op.action === "create" && op.data?.[PARENT_FIELD]) parents.add(op.data[PARENT_FIELD]);
					else if ((op.action === "update" || op.action === "delete") && op.uuid) refItemUuids.push(op.uuid);
				}
				if (refItemUuids.length) {
					const refItems = await db[MODEL].findMany({ where: { uuid: { in: refItemUuids } }, select: { uuid: true, [PARENT_FIELD]: true } });
					for (const it of refItems) {
						if (!it[PARENT_FIELD]) continue;
						parents.add(it[PARENT_FIELD]);
						itemParent.set(it.uuid, it[PARENT_FIELD]);
					}
				}
				for (const pUuid of parents) {
					if (!(await assertParentOwned(pUuid, req, res, { write: true }))) return;
				}
			}
			// Отрицательное количество — отказ до записи чего-либо.
			for (const op of operations) {
				if (op.action === "create" || op.action === "update") assertLineQuantity(op.data?.quantity);
			}

			// Метод НДС и денормализованные поля — по каждому документу батча.
			const vatByParent = new Map();
			const denormByParent = new Map();
			for (const pUuid of parents) {
				if (hasTaxes) vatByParent.set(pUuid, await loadVatMethodForParent(PARENT_MODEL, pUuid, db));
				denormByParent.set(pUuid, await loadParentDenormFields(PARENT_MODEL, pUuid, db));
			}
			const vatOf = (pUuid) => vatByParent.get(pUuid) ?? "INCLUDED";

			await mutateLines([...parents], async (tx) => {
				for (const op of operations) {
					const { action, uuid, data } = op;
					if (!action) continue;

					if (action === "create" && data) {
						const pUuid = data[PARENT_FIELD];
						if (!pUuid) continue;
						const qty = parseFloat(data.quantity) || 0;
						const prc = parseFloat(data.price) || 0;
						let itemData;
						if (hasTaxes) {
							const discPct = parseFloat(data.discountPercent) || 0;
							const vRate = data.vatRate != null ? parseFloat(data.vatRate) : 12;
							const exRate = parseFloat(data.exciseRate) || 0;
							const calc = recalcLineAmounts({ quantity: qty, price: prc, discountPercent: discPct, vatRate: vRate, exciseRate: exRate, vatMethod: vatOf(pUuid), taxes: data.taxes });
							itemData = {
								[PARENT_FIELD]: pUuid, productUuid: data.productUuid || null,
								quantity: qty, price: prc,
								amount: calc.amount, amountWithoutVat: calc.amountWithoutVat,
								unitOfMeasureUuid: data.unitOfMeasureUuid || null,
								vatRate: vRate, vatAmount: calc.vatAmount,
								exciseRate: exRate, exciseAmount: calc.exciseAmount,
								discountPercent: discPct, discountAmount: calc.discountAmount,
								taxes: calc.taxes ?? undefined,
								...sourceRow(data),
								...esfFields(data),
								// Доп. поля строки (в т.ч. batchUuid). Форма коммитит строки
								// ПАЧКОЙ через этот эндпоинт, а он их не применял — выбор
								// партии молча терялся, в строке оставалась прежняя.
								...extraFields(data),
								...(denormByParent.get(pUuid) ?? {}),
							};
						} else {
							// Без налогов (оприходование, ГТД, списание, перемещение, инвентаризация):
							// раньше здесь терялись партия, № позиции ГТД, учётное количество и
							// sourceRowId — перемещение партионного товара получало 422, а
							// перезаполнение по инвентаризации дублировало строки (У8).
							itemData = {
								[PARENT_FIELD]: pUuid, productUuid: data.productUuid || null,
								quantity: qty, price: prc,
								amount: r2(qty * prc),
								unitOfMeasureUuid: data.unitOfMeasureUuid || null,
								...sourceRow(data),
								...esfFields(data),
								...extraFields(data),
							};
						}
						await tx[MODEL].create({ data: itemData });

					} else if (action === "update" && uuid && data) {
						const w = { uuid };
						const pUuid = itemParent.get(uuid);
						const updateData = await buildUpdateData(
							data,
							() => tx[MODEL].findUnique({ where: w }),
							async () => vatOf(pUuid),
						);
						if (updateData && Object.keys(updateData).length > 0)
							await tx[MODEL].update({ where: w, data: updateData });

					} else if (action === "delete" && uuid) {
						// deleteMany: уже удалённая строка — не ошибка и не обрыв транзакции.
						await tx[MODEL].deleteMany({ where: { uuid } });
					}
				}
			});

			return res.status(200).json({ success: true });
		} catch (error) {
			if (respondItemsError(error, res)) return;
			console.error(`POST /${ROUTE}/batch error:`, error);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	return router;
}

export default createDocumentItemsRouter;
