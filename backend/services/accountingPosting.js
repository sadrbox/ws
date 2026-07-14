// ─────────────────────────────────────────────────────────────────────────────
// AccountingPostingService — единый сервис формирования бухгалтерских проводок.
//
// Архитектура зеркалит productRegister.js: идемпотентный ПЕРЕСБОР проводок по
// документу (reconcile). При любом изменении/проведении документа прежние
// проводки этого документа удаляются и создаются заново из ТЕКУЩЕГО состояния —
// только если документ проведён (posted=true) и не удалён.
//
// Логика проводок НЕ внутри документов: каждый тип документа описывается
// ПРАВИЛОМ (POSTING_RULES[documentType]) — чистой функцией, возвращающей список
// проводок. Новые правила/документы добавляются записью в реестр, без изменения
// кода документов и самого движка.
//
// Аналитика (субконто) — универсальная: проводка содержит массив аналитик
// debit/credit вида { subkontoType, objectUuid }. Жёстко заданных полей
// (debitWarehouseId и т.п.) НЕТ.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { allocateImportLandedCost } from "./importLandedCost.js";
import { getSnapshotFor } from "./costSnapshot.js";
import { getSettingsAt } from "./accountingSettings.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Коды типовых счетов РК (см. seed-accounting.js).
export const ACC = {
	CASH: "1010",
	BANK: "1030",
	AR: "1210", // дебиторская задолженность покупателей
	ACCOUNTABLE: "1250", // подотчётные суммы (дебиторка работников)
	MATERIALS: "1310",
	GOODS: "1330",
	FIXED: "2410",
	AP: "3310", // задолженность поставщикам
	VAT_IN: "1420", // НДС к возмещению (входящий, к зачёту)
	VAT_OUT: "3130", // НДС к уплате (исходящий)
	CUSTOMS: "3390", // прочая кредиторка: таможенные платежи (пошлина/сбор/акциз/импортный НДС)
	PAYROLL: "3350",
	RETAINED: "5510",
	RESULT: "5610", // итоговая прибыль/убыток (закрытие месяца)
	REVENUE: "6010",
	OTHER_INCOME: "6280", // прочие доходы (излишки при оприходовании)
	COGS: "7010",
	ADMIN_EXP: "7210",
};

// Счета, закрываемые при закрытии месяца на 5610, и их нормальная сторона.
// 6010 (доход) — кредитовый; 7010/7210 (расходы) — дебетовые. Чистый оборот по
// нормальной стороне переносится на счёт итоговой прибыли 5610.
const CLOSE_ACCOUNTS = [
	{ account: ACC.REVENUE, normal: "credit" }, // 6010 доход
	{ account: ACC.OTHER_INCOME, normal: "credit" }, // 6280 прочие доходы (излишки)
	{ account: ACC.COGS, normal: "debit" },     // 7010 себестоимость
	{ account: ACC.ADMIN_EXP, normal: "debit" }, // 7210 админрасходы
];

// Формат даты для описания закрывающих проводок (детерминированно, по UTC).
const fmtDateUTC = (d) => {
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	return `${dd}.${mm}.${d.getUTCFullYear()}`;
};

// Корр-счёт проводки кассового ордера по типу операции (см. cashOperationTypes на фронте).
// ПКО: Дт 1010 Кт account; РКО: Дт account Кт 1010. analyticsType задаёт субконто на
// стороне корр-счёта: "counterparty" → Контрагент+Договор (1210/3310), "employee" →
// Сотрудник (1250, подотчёт), null → без аналитики (банк 1030).
const CASH_OP_OFFSET = {
	// ПКО (receipt)
	payment_from_customer:   { account: ACC.AR, analyticsType: "counterparty" },         // Кт 1210
	return_from_supplier:    { account: ACC.AP, analyticsType: "counterparty" },         // Кт 3310
	return_from_accountable: { account: ACC.ACCOUNTABLE, analyticsType: "employee" },    // Кт 1250
	cash_from_bank:          { account: ACC.BANK, analyticsType: null },                 // Кт 1030
	other_receipt:           { account: ACC.AR, analyticsType: "counterparty" },
	// РКО (expense)
	payment_to_supplier:     { account: ACC.AP, analyticsType: "counterparty" },         // Дт 3310
	return_to_customer:      { account: ACC.AR, analyticsType: "counterparty" },         // Дт 1210
	issue_to_accountable:    { account: ACC.ACCOUNTABLE, analyticsType: "employee" },    // Дт 1250
	cash_to_bank:            { account: ACC.BANK, analyticsType: null },                 // Дт 1030
	other_expense:           { account: ACC.AP, analyticsType: "counterparty" },
};
// Дефолт при operationType=null (старые записи): сохраняет прежнее поведение.
const CASH_OP_DEFAULT = {
	cash_receipt_order: CASH_OP_OFFSET.payment_from_customer, // Кт 1210
	cash_expense_order: CASH_OP_OFFSET.payment_to_supplier,   // Дт 3310
};
// Аналитика корр-счёта кассового ордера по типу.
const buildCashAnalytics = (analyticsType, doc) => {
	if (analyticsType === "counterparty") return compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]);
	if (analyticsType === "employee") return compact([an("Employee", doc.employeeUuid)]);
	return [];
};

// Субконто, обязательные при проверке проведения. «Основные» измерения —
// обязательны; договор/статья затрат/подразделение/ОС — необязательны (не
// блокируют проведение, но фиксируются, если заполнены в документе).
export const REQUIRED_SUBKONTO = new Set([
	"Nomenclature",
	"Warehouse",
	"Counterparty",
	"Employee",
]);

// ─── Конфигурация документов-регистраторов ───────────────────────────────────
// parentModel — prisma-модель документа; itemModel/parentField — строки (если есть).
const DOC_CONFIG = {
	purchase: { parentModel: "purchase", itemModel: "purchaseItem", parentField: "purchaseUuid" },
	sale: { parentModel: "sale", itemModel: "saleItem", parentField: "saleUuid" },
	sale_return: { parentModel: "saleReturn", itemModel: "saleReturnItem", parentField: "saleReturnUuid" },
	purchase_return: { parentModel: "purchaseReturn", itemModel: "purchaseReturnItem", parentField: "purchaseReturnUuid" },
	import_declaration: { parentModel: "importDeclaration", itemModel: "importDeclarationItem", parentField: "importDeclarationUuid" },
	write_off: { parentModel: "writeOff", itemModel: "writeOffItem", parentField: "writeOffUuid" },
	goods_receipt: { parentModel: "goodsReceipt", itemModel: "goodsReceiptItem", parentField: "goodsReceiptUuid" },
	inventory_transfer: { parentModel: "inventoryTransfer", itemModel: "inventoryTransferItem", parentField: "inventoryTransferUuid" },
	cash_receipt_order: { parentModel: "cashOrder" },
	cash_expense_order: { parentModel: "cashOrder" },
	bank_statement: { parentModel: "bankStatement" },
	payroll_calculation: { parentModel: "payrollCalculation" },
	payroll_payment: { parentModel: "payrollPayment" },
	month_close: { parentModel: "monthClose" },
};

export const POSTING_DOC_TYPES = Object.keys(DOC_CONFIG);

/** Маппинг prisma-модели документа → documentType (для фабрики позиций). */
export function documentTypeForParentModel(parentModel) {
	for (const [type, cfg] of Object.entries(DOC_CONFIG)) {
		if (cfg.parentModel === parentModel) return type;
	}
	return null;
}

// ─── Хелперы аналитики ───────────────────────────────────────────────────────
/** Аналитика проводки: { type, objectUuid }. Пустые (objectUuid=null) отсекаются. */
function an(type, objectUuid) {
	return objectUuid ? { type, objectUuid } : null;
}
const compact = (arr) => arr.filter(Boolean);

/**
 * Разбивка суммы строки на стоимость без НДС и сам НДС.
 * net — стоимость без НДС (база, идёт на товар/доход), vat — сумма НДС.
 *
 * Разнесение НДС выполняется ТОЛЬКО для плательщика НДС (useVat=true в
 * «Параметрах учёта» организации). Если useVat=false (или нет налоговых полей)
 * — vat=0, net=amount (НДС в стоимости; поведение как без разнесения).
 */
function splitVat(it, useVat) {
	const amount = r2(it.amount);
	if (!useVat) return { amount, vat: 0, net: amount };
	const vat = r2(it.vatAmount);
	const rawNet = it.amountWithoutVat != null ? r2(it.amountWithoutVat) : r2(amount - vat);
	const net = rawNet > 0 ? rawNet : amount;
	return { amount, vat, net };
}

/**
 * Признак плательщика НДС организации — НА ДАТУ ДОКУМЕНТА.
 *
 * Раньше дата игнорировалась: бралась текущая версия настроек. Значит снятие галки
 * «плательщик НДС» задним числом убирало НДС из проведённых документов прошлых
 * периодов — по которым уже сдана отчётность.
 */
export async function resolveUseVat(orgUuid, date = null, client = prisma) {
	if (!orgUuid) return false;
	try {
		const s = await getSettingsAt(orgUuid, date, client);
		return s?.useVat === true;
	} catch {
		return false;
	}
}

/**
 * Метод расчёта себестоимости организации: "AVERAGE" (по умолчанию) | "FIFO".
 *
 * Выбирается настройка, ДЕЙСТВОВАВШАЯ НА ДАТУ ДОКУМЕНТА (`startDate <= date`),
 * а не самая свежая: учётная политика меняется с начала периода, и документы
 * прошлых периодов обязаны сохранять прежний метод. Иначе переключение
 * организации на ФИФО заставило бы пересчёт переписать по ФИФО всю историю,
 * включая периоды, закрытые по средней.
 *
 * Если на дату документа настройки ещё не было — "AVERAGE" (безопасный дефолт).
 *
 * @param {string|null} orgUuid
 * @param {Date|string|null} [date] — дата документа; null → текущая настройка.
 */
export async function resolveCostingMethod(orgUuid, date = null, client = prisma) {
	if (!orgUuid) return "AVERAGE";
	try {
		const s = await getSettingsAt(orgUuid, date, client);
		return s?.costingMethod === "FIFO" ? "FIFO" : "AVERAGE";
	} catch {
		return "AVERAGE";
	}
}

/**
 * Себестоимость единицы товара по методу организации (AVERAGE|FIFO) — для оценки
 * ПРИХОДА по себестоимости (например возврат от покупателя на склад), а не по цене
 * документа. consume=false: партии не списываются (оценка текущего остатка).
 * Используется в productRegister.js, чтобы возврат входил в ФИФО-слои по cost-basis.
 */
export async function resolveUnitCost(orgUuid, productUuid, warehouseUuid, dateUpTo, quantity, client = prisma) {
	const ctx = makeContext(client, orgUuid ?? null);
	// Метод — тот, что действовал на дату оценки (dateUpTo), а не текущий.
	ctx.beginDocument(await resolveCostingMethod(orgUuid ?? null, dateUpTo ?? null, client), null, null);
	return ctx.unitCost(productUuid, warehouseUuid, dateUpTo, quantity, { consume: false });
}

/**
 * Контекст себестоимости на ОДИН документ — для оценки нескольких строк подряд.
 *
 * В отличие от resolveUnitCost (свежий контекст на каждый вызов) здесь общий
 * fifoOffset: строки одного документа последовательно «съедают» ФИФО-слои, и две
 * строки одного товара не оцениваются повторно по одним и тем же партиям.
 * Для AVERAGE поведение не меняется (средняя одинакова для всех строк).
 *
 * docUuid/docId исключают собственные расходы документа и задают тай-брейк по
 * documentId среди расходов той же даты. Для оценки ПРИХОДА по состоянию на
 * прошлую дату (возврат от покупателя) их передавать НЕ нужно: иначе будут
 * пропущены расходы исходной продажи, и вернутся не те слои.
 *
 * @param {string|null} orgUuid
 * @param {Date|string|null} date — дата документа (по ней же выбирается метод)
 * @param {{docUuid?:string|null, docId?:number|null}} [opts]
 */
export async function createCostingContext(orgUuid, date, { docUuid = null, docId = null, boundary = null } = {}, client = prisma) {
	// boundary — граница закрытого периода. Передавать ТОЛЬКО когда все оценки этого
	// контекста идут на дату СТРОГО позже границы (оценка документа хвоста): тогда
	// costing стартует от снапшота на границе, а не от начала истории. Для оценки на
	// прошлую дату (возврат от покупателя) boundary НЕ передавать.
	const ctx = makeContext(client, orgUuid ?? null, new Map(), boundary);
	ctx.beginDocument(await resolveCostingMethod(orgUuid ?? null, date ?? null, client), docUuid, docId);
	return ctx;
}

// ─── Реестр правил формирования проводок ─────────────────────────────────────
// Каждое правило: (doc, items, ctx) => Promise<Array<RawEntry>> | Array<RawEntry>
// RawEntry = { debit, credit, amount, description, debitAnalytics[], creditAnalytics[] }
export const POSTING_RULES = {
	// Поступление товаров (плательщик НДС): Дт 1330 (без НДС) + Дт 1420 (входящий
	// НДС к зачёту) Кт 3310 (полная сумма с НДС). Контрагент/договор — на 3310.
	purchase: (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const { net, vat } = splitVat(it, ctx.useVat);
			const apAnalytics = compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]);
			if (net > 0) {
				out.push({
					debit: ACC.GOODS, credit: ACC.AP, amount: net,
					description: "Оприходование товара",
					debitAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
					creditAnalytics: apAnalytics,
				});
			}
			if (vat > 0) {
				out.push({
					debit: ACC.VAT_IN, credit: ACC.AP, amount: vat,
					description: "НДС по приобретённым товарам (к зачёту)",
					debitAnalytics: [], creditAnalytics: apAnalytics,
				});
			}
		}
		return out;
	},

	// ГТД по импорту (Этап 2): оприходование товара по landed cost.
	//   Дт 1330 Кт 3310 — товар по таможенной стоимости (перед декларантом/поставщиком).
	//   Дт 1330 Кт 3390 — капитализированные пошлина/сбор/акциз [+ импортный НДС у неплательщика].
	//   Дт 1420 Кт 3390 — импортный НДС к возмещению (только плательщик НДС).
	// Аналитика 1330 — Номенклатура+Склад; 3310 — Контрагент (декларант); 3390 — без субконто.
	import_declaration: (doc, items, ctx) => {
		const out = [];
		const alloc = allocateImportLandedCost(doc, items, ctx.useVat);
		const apAnalytics = compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]);
		for (const it of items) {
			if (!it.productUuid) continue;
			const a = alloc.get(it.uuid);
			if (!a) continue;
			const goodsAnalytics = compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]);
			if (a.customsValue > 0) {
				out.push({
					debit: ACC.GOODS, credit: ACC.AP, amount: a.customsValue,
					description: "Оприходование импортного товара (таможенная стоимость)",
					debitAnalytics: goodsAnalytics, creditAnalytics: apAnalytics,
				});
			}
			if (a.capitalized > 0) {
				out.push({
					debit: ACC.GOODS, credit: ACC.CUSTOMS, amount: a.capitalized,
					description: "Таможенные платежи в себестоимости товара",
					debitAnalytics: goodsAnalytics, creditAnalytics: [],
				});
			}
			if (a.importVat > 0) {
				out.push({
					debit: ACC.VAT_IN, credit: ACC.CUSTOMS, amount: a.importVat,
					description: "Импортный НДС (к зачёту)",
					debitAnalytics: [], creditAnalytics: [],
				});
			}
		}
		return out;
	},

	// Списание товара (порча/недостача/внутреннее потребление): Дт 7210 Кт 1330 по СЕБЕСТОИМОСТИ
	// (ФИФО/средняя), а не по цене строки. consume:true — расход потребляет партии
	// ФИФО так же, как реализация.
	write_off: async (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const qty = Number(it.quantity || 0);
			const cost = r2((await ctx.unitCost(it.productUuid, doc.warehouseUuid, doc.date, qty, { consume: true })) * qty);
			if (cost > 0) {
				out.push({
					debit: ACC.ADMIN_EXP, credit: ACC.GOODS, amount: cost,
					description: "Списание товара",
					debitAnalytics: [],
					creditAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
				});
			}
		}
		return out;
	},

	// Оприходование излишков: Дт 1330 Кт 6280 (прочие доходы) по цене оприходования.
	// Цена вводится пользователем: у излишка может не быть остатка, из которого можно
	// вывести себестоимость, поэтому unitCost здесь неприменим.
	goods_receipt: (doc, items) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const amount = r2(it.amount);
			if (amount > 0) {
				out.push({
					debit: ACC.GOODS, credit: ACC.OTHER_INCOME, amount,
					description: "Оприходование излишков товара",
					debitAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
					creditAnalytics: [],
				});
			}
		}
		return out;
	},

	// Реализация: отражение дохода (Дт 1210 Кт 6010) + списание себестоимости (Дт 7010 Кт 1330).
	sale: async (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const { net, vat } = splitVat(it, ctx.useVat);
			const arAnalytics = compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]);
			if (net > 0) {
				out.push({
					debit: ACC.AR,
					credit: ACC.REVENUE,
					amount: net,
					description: "Выручка от реализации (без НДС)",
					debitAnalytics: arAnalytics,
					// Аналитика дохода 6010: контрагент + номенклатура + менеджер
					// (необязательное субконто Manager — учёт движения продаж по менеджеру).
					creditAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Nomenclature", it.productUuid), an("Manager", doc.managerUuid)]),
				});
			}
			if (vat > 0) {
				out.push({
					debit: ACC.AR, credit: ACC.VAT_OUT, amount: vat,
					description: "НДС по реализации (к уплате)",
					debitAnalytics: arAnalytics, creditAnalytics: [],
				});
			}
			// COGS = out.amount из регистра (инвариант: движение расхода уже несёт
			// себестоимость). Регистра ещё нет (валидация/прямой вызов) → считаем сами.
			const qtyNum = Number(it.quantity || 0);
			const cost = ctx.registerCosts.has(it.uuid)
				? r2(ctx.registerCosts.get(it.uuid))
				: r2((await ctx.unitCost(it.productUuid, doc.warehouseUuid, doc.date, qtyNum, { consume: true })) * qtyNum);
			if (cost > 0) {
				out.push({
					debit: ACC.COGS,
					credit: ACC.GOODS,
					amount: cost,
					description: "Списание себестоимости",
					debitAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
					creditAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
				});
			}
		}
		return out;
	},

	// Возврат от покупателя: сторно выручки (Дт 6010 Кт 1210) + возврат на склад (Дт 1330 Кт 7010).
	sale_return: async (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const { net, vat } = splitVat(it, ctx.useVat);
			const arAnalytics = compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]);
			if (net > 0) {
				out.push({
					debit: ACC.REVENUE,
					credit: ACC.AR,
					amount: net,
					description: "Сторно выручки (возврат от покупателя)",
					// Сторнируем доход 6010 в т.ч. по менеджеру (Manager) — возврат
					// уменьшает движение продаж менеджера.
					debitAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Nomenclature", it.productUuid), an("Manager", doc.managerUuid)]),
					creditAnalytics: arAnalytics,
				});
			}
			if (vat > 0) {
				out.push({
					debit: ACC.VAT_OUT, credit: ACC.AR, amount: vat,
					description: "Сторно НДС по реализации (возврат)",
					debitAnalytics: [], creditAnalytics: arAnalytics,
				});
			}
			// Стоимость возврата на склад = in.amount из регистра (cost-basis на дату
			// исходной продажи): единый источник, регистр↔ГК по 1330 согласованы.
			// Регистра ещё нет (валидация/прямой вызов) → считаем сами на дату возврата.
			const qtyNum = Number(it.quantity || 0);
			const cost = ctx.registerCosts.has(it.uuid)
				? r2(ctx.registerCosts.get(it.uuid))
				: r2((await ctx.unitCost(it.productUuid, doc.warehouseUuid, doc.date, qtyNum, { consume: false })) * qtyNum);
			if (cost > 0) {
				out.push({
					debit: ACC.GOODS,
					credit: ACC.COGS,
					amount: cost,
					description: "Возврат товара на склад",
					debitAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
					creditAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
				});
			}
		}
		return out;
	},

	// Возврат поставщику (плательщик НДС): Дт 3310 (полная) Кт 1330 (без НДС) +
	// Кт 1420 (сторно входящего НДС).
	purchase_return: (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const { net, vat } = splitVat(it, ctx.useVat);
			const apAnalytics = compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]);
			if (net > 0) {
				out.push({
					debit: ACC.AP, credit: ACC.GOODS, amount: net,
					description: "Возврат товара поставщику",
					debitAnalytics: apAnalytics,
					creditAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
				});
			}
			if (vat > 0) {
				out.push({
					debit: ACC.AP, credit: ACC.VAT_IN, amount: vat,
					description: "Сторно НДС к зачёту (возврат поставщику)",
					debitAnalytics: apAnalytics, creditAnalytics: [],
				});
			}
		}
		return out;
	},

	// Перемещение ТМЗ между складами: Дт 1330 (Номенклатура, Склад-получатель)
	// Кт 1330 (Номенклатура, Склад-источник). Сумма — по себестоимости (скользящая
	// средняя из склада-источника), при отсутствии — по цене строки.
	inventory_transfer: async (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const unit = await ctx.unitCost(it.productUuid, doc.fromWarehouseUuid, doc.date, Number(it.quantity || 0), { consume: true });
			const cost = r2((unit || Number(it.price) || 0) * Number(it.quantity || 0));
			if (cost <= 0) continue;
			out.push({
				debit: ACC.GOODS,
				credit: ACC.GOODS,
				amount: cost,
				description: "Перемещение товара между складами",
				debitAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.toWarehouseUuid)]),
				creditAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.fromWarehouseUuid)]),
			});
		}
		return out;
	},

	// Банковская выписка. Поступление (in): Дт 1030 Кт 1210 (Контрагент, Договор).
	// Списание (out): Дт 3310 (Контрагент, Договор) Кт 1030.
	bank_statement: (doc) => {
		const amount = r2(doc.amount);
		if (amount <= 0) return [];
		if (doc.direction === "bankStatementOut") {
			return [{
				debit: ACC.AP,
				credit: ACC.BANK,
				amount,
				description: doc.comment || "Списание с расчётного счёта",
				debitAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
				creditAnalytics: [],
			}];
		}
		return [{
			debit: ACC.BANK,
			credit: ACC.AR,
			amount,
			description: doc.comment || "Поступление на расчётный счёт",
			debitAnalytics: [],
			creditAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
		}];
	},

	// Приходный кассовый ордер: Дт 1010 Кт <корр-счёт по типу операции>.
	cash_receipt_order: (doc) => {
		const amount = r2(doc.amount);
		if (amount <= 0) return [];
		const offset = CASH_OP_OFFSET[doc.operationType] ?? CASH_OP_DEFAULT.cash_receipt_order;
		const analytics = buildCashAnalytics(offset.analyticsType, doc);
		return [{
			debit: ACC.CASH,
			credit: offset.account,
			amount,
			description: doc.comment || "Поступление денег в кассу",
			debitAnalytics: [],
			creditAnalytics: analytics,
		}];
	},

	// Расходный кассовый ордер: Дт <корр-счёт по типу операции> Кт 1010.
	cash_expense_order: (doc) => {
		const amount = r2(doc.amount);
		if (amount <= 0) return [];
		const offset = CASH_OP_OFFSET[doc.operationType] ?? CASH_OP_DEFAULT.cash_expense_order;
		const analytics = buildCashAnalytics(offset.analyticsType, doc);
		return [{
			debit: offset.account,
			credit: ACC.CASH,
			amount,
			description: doc.comment || "Выдача денег из кассы",
			debitAnalytics: analytics,
			creditAnalytics: [],
		}];
	},

	// Начисление зарплаты: Дт 7210 (Подразделение, Статья затрат) Кт 3350 (Сотрудник).
	payroll_calculation: (doc) => {
		const amount = r2(doc.totalExpense ?? doc.baseSalary);
		if (amount <= 0) return [];
		return [{
			debit: ACC.ADMIN_EXP,
			credit: ACC.PAYROLL,
			amount,
			description: doc.comment || `Начисление зарплаты${doc.period ? ` за ${doc.period}` : ""}`,
			debitAnalytics: [], // Подразделение/Статья затрат — необязательные субконто
			creditAnalytics: compact([an("Employee", doc.employeeUuid)]),
		}];
	},

	// Выплата зарплаты: Дт 3350 (Сотрудник) Кт 1010|1030 (по способу выплаты).
	payroll_payment: (doc) => {
		const amount = r2(doc.amount);
		if (amount <= 0) return [];
		const credit = doc.paymentMethod === "cash" ? ACC.CASH : ACC.BANK;
		return [{
			debit: ACC.PAYROLL,
			credit,
			amount,
			description: doc.comment || `Выплата зарплаты${doc.period ? ` за ${doc.period}` : ""}`,
			debitAnalytics: compact([an("Employee", doc.employeeUuid)]),
			creditAnalytics: [],
		}];
	},

	// Закрытие месяца: счета доходов/расходов (6010/7010/7210) закрываются на счёт
	// итоговой прибыли 5610 по ЧИСТЫМ оборотам периода. Обороты берутся из регистра
	// AccountingEntry за [periodStart, periodEnd] (исключая собственные проводки
	// закрытия) и фильтруются filterPostedEntries (только проведённые документы).
	// Закрытие агрегатное (без аналитики), идемпотентное (reconcile удаляет старые
	// проводки документа перед пересборкой). Сальдо 5610 после закрытия = финрезультат
	// (Кт = прибыль, Дт = убыток).
	month_close: async (doc, _items, ctx) => {
		if (!doc.organizationUuid || !doc.periodStart || !doc.periodEnd) return [];
		const start = new Date(doc.periodStart);
		const endRaw = new Date(doc.periodEnd);
		const end = new Date(endRaw);
		end.setHours(23, 59, 59, 999); // включительно по последний день периода
		const codes = CLOSE_ACCOUNTS.map((c) => c.account);

		// Обороты периода по закрываемым счетам (без собственных проводок закрытия).
		const raw = await ctx.client.accountingEntry.findMany({
			where: {
				organizationUuid: doc.organizationUuid,
				date: { gte: start, lte: end },
				documentType: { not: "month_close" },
				OR: [{ debitAccountCode: { in: codes } }, { creditAccountCode: { in: codes } }],
			},
			select: { debitAccountCode: true, creditAccountCode: true, amount: true, documentType: true, documentUuid: true },
		});
		// Самолечение: учитываем только проводки реально проведённых документов.
		const posted = await filterPostedEntries(raw, ctx.client);
		const periodLabel = `${fmtDateUTC(start)}–${fmtDateUTC(endRaw)}`;

		const out = [];
		for (const { account, normal } of CLOSE_ACCOUNTS) {
			let debit = 0;
			let credit = 0;
			for (const e of posted) {
				if (e.debitAccountCode === account) debit += Number(e.amount) || 0;
				if (e.creditAccountCode === account) credit += Number(e.amount) || 0;
			}
			// Чистый оборот по нормальной стороне счёта.
			const net = r2(normal === "credit" ? credit - debit : debit - credit);
			if (Math.abs(net) < 0.005) continue;
			// Доход (нормально кредитовый): Дт 6010 Кт 5610 на прибыль (net>0).
			// Расход (нормально дебетовый): Дт 5610 Кт <счёт> на расход (net>0).
			// При обратном знаке (возвраты перекрыли) — меняем стороны местами.
			let from;
			let to;
			if (normal === "credit") {
				[from, to] = net > 0 ? [account, ACC.RESULT] : [ACC.RESULT, account];
			} else {
				[from, to] = net > 0 ? [ACC.RESULT, account] : [account, ACC.RESULT];
			}
			out.push({
				debit: from,
				credit: to,
				amount: Math.abs(net),
				description: `Закрытие счёта ${account} за ${periodLabel}`,
				debitAnalytics: [],
				creditAnalytics: [],
			});
		}
		return out;
	},
};

// ─── Резолверы счетов и наименований субконто (с кэшем на вызов) ──────────────
function makeContext(client, orgUuid, costCache = new Map(), boundary = null) {
	const accCache = new Map(); // code → account|null
	const subkontoCache = new Map(); // code → SubkontoType|null
	const nameCache = new Map(); // `${model}:${uuid}` → name

	// Состояние себестоимости на время сборки одного документа (см. beginDocument).
	let costingMethod = "AVERAGE";
	let docUuid = null;
	let docId = null;
	const fifoOffset = new Map(); // `product|warehouse` → потреблено строками документа

	// ── Кэш чтений регистра для себестоимости ────────────────────────────────
	// avgCost/fifoCost переигрывают ВСЮ историю движений товара. Раньше каждая
	// строка каждого документа делала свой findMany (с фильтром date lte / docUuid),
	// т.е. O(строки × история); при пересчёте всей истории — O(история²).
	// Теперь всю историю (product|warehouse) читаем ОДИН раз и держим в costCache,
	// а отсечение по дате/документу делаем в памяти (та же логика, что была в SQL).
	// costCache можно передать снаружи: в пределах документа — мемоизация повторных
	// товаров; при пересчёте проводок (фаза 2, регистр НЕизменен) — на всю фазу.
	// ВАЖНО: НЕ переиспользовать между перестройками регистра — только там, где
	// productRegister не меняется за время жизни кэша.
	// Возвращает { seed, rows }: seed — снапшот остатка/слоёв на границе закрытого
	// периода (или null), rows — движения ПОСЛЕ даты снапшота (или вся история, если
	// снапшота нет). boundary передаётся ТОЛЬКО для контекстов, где все запросы имеют
	// cutoff > boundary (оценка на дату документа хвоста) — иначе tail-only rows были
	// бы неполными. Снапшот эквивалентен полному replay истории ≤ asOfDate (доказано
	// в costSnapshot: ФИФО — front-removal, средняя — та же аккумуляция).
	async function loadRegister(productUuid, warehouseUuid) {
		const key = `${orgUuid ?? ""}|${productUuid}|${warehouseUuid ?? ""}`;
		let cached = costCache.get(key);
		if (cached) return cached;

		let seed = null;
		let afterDate = null;
		if (boundary && orgUuid && warehouseUuid) {
			const snap = await getSnapshotFor(orgUuid, productUuid, warehouseUuid, boundary, client);
			if (snap) {
				seed = {
					quantity: Number(snap.quantity) || 0,
					value: Number(snap.value) || 0,
					layers: Array.isArray(snap.layers)
						? snap.layers.map((l) => ({ q: Number(l.q) || 0, unit: Number(l.unit) || 0 }))
						: [],
				};
				afterDate = snap.asOfDate;
			}
		}

		const base = { productUuid };
		if (warehouseUuid) base.warehouseUuid = warehouseUuid;
		if (orgUuid) base.organizationUuid = orgUuid;
		if (afterDate) base.date = { gt: afterDate };
		const raw = await client.productRegister.findMany({
			where: base,
			select: { quantity: true, amount: true, movementType: true, date: true, documentId: true, documentUuid: true },
			orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
		});
		// Нормализуем: число + метка времени (мс) один раз, чтобы не парсить дату
		// повторно на каждой строке каждого документа.
		const rows = raw.map((r) => ({
			q: Number(r.quantity) || 0,
			amount: Number(r.amount) || 0,
			movementType: r.movementType,
			t: r.date instanceof Date ? r.date.getTime() : new Date(r.date).getTime(),
			documentId: r.documentId,
			documentUuid: r.documentUuid,
		}));
		cached = { seed, rows };
		costCache.set(key, cached);
		return cached;
	}

	const upToMs = (dateUpTo) =>
		dateUpTo ? (dateUpTo instanceof Date ? dateUpTo.getTime() : new Date(dateUpTo).getTime()) : null;

	// Инициализация контекста под конкретный документ: метод себестоимости, uuid+id
	// (для исключения собственных outs и упорядочивания ФИФО) и сброс offset строк.
	function beginDocument(method, uuid, id) {
		costingMethod = method === "FIFO" ? "FIFO" : "AVERAGE";
		docUuid = uuid ?? null;
		docId = id ?? null;
		fifoOffset.clear();
	}

	async function resolveAccount(code) {
		if (accCache.has(code)) return accCache.get(code);
		// Приоритет: счёт организации, затем типовой (organizationUuid=null).
		let acc = null;
		if (orgUuid) {
			acc = await client.chartOfAccount.findFirst({
				where: { code, organizationUuid: orgUuid, deletedAt: null },
			});
		}
		if (!acc) {
			acc = await client.chartOfAccount.findFirst({
				where: { code, organizationUuid: null, deletedAt: null },
			});
		}
		accCache.set(code, acc);
		return acc;
	}

	async function resolveSubkontoType(code) {
		if (subkontoCache.has(code)) return subkontoCache.get(code);
		const st = await client.subkontoType.findUnique({ where: { code } });
		subkontoCache.set(code, st);
		return st;
	}

	async function resolveName(subkontoType, objectUuid) {
		if (!objectUuid) return null;
		const st = await resolveSubkontoType(subkontoType);
		const model = st?.referenceModel;
		if (!model) return null;
		const key = `${model}:${objectUuid}`;
		if (nameCache.has(key)) return nameCache.get(key);
		let name = null;
		try {
			const rec = await client[model].findUnique({ where: { uuid: objectUuid } });
			if (rec) {
				const composed = [rec.lastName, rec.firstName, rec.middleName].filter(Boolean).join(" ");
				name = rec.name ?? rec.fullName ?? rec.legalName ?? (composed || null);
			}
		} catch {
			name = null;
		}
		nameCache.set(key, name);
		return name;
	}

	// Скользящая (перпетуальная) средняя себестоимость единицы.
	// Воспроизводим историю движений товара ДО текущего документа в хронологическом
	// порядке, ведя остаток (кол-во + стоимость):
	//   приход → +qty, +amount (стоимость прихода из регистра);
	//   расход → списываем qty × ТЕКУЩАЯ средняя (COGS считаем на лету — в регистре
	//            out.amount хранит ВЫРУЧКУ строки, а не себестоимость, поэтому его не
	//            используем; средняя при расходе не меняется).
	// Возвращаем среднюю на момент непосредственно перед текущим документом.
	async function avgCost(productUuid, warehouseUuid, dateUpTo) {
		if (!productUuid) return 0;
		const { seed, rows } = await loadRegister(productUuid, warehouseUuid);
		const upTo = upToMs(dateUpTo);
		// Старт от снапшота (остаток/стоимость на границе закрытого периода), если есть.
		let qty = seed ? seed.quantity : 0;
		let value = seed ? seed.value : 0;
		for (const r of rows) {
			// Исключаем собственные движения документа (как SQL `documentUuid not`).
			if (docUuid && r.documentUuid === docUuid) continue;
			// Строго ДО текущего документа: по дате, при равной дате — по documentId.
			const before = upTo == null || r.t < upTo
				|| (r.t === upTo && (docId == null || r.documentId == null || r.documentId < docId));
			if (!before) continue;
			if (r.movementType === "out") {
				const avg = qty > 0 ? value / qty : 0;
				qty -= r.q;
				value -= avg * r.q;
				if (qty < 0) qty = 0;
				if (value < 0) value = 0;
			} else {
				qty += r.q;
				value += r.amount;
			}
		}
		return qty > 0 ? value / qty : 0;
	}

	// ФИФО-себестоимость: эффективная удельная цена = (полная стоимость списания
	// `quantity` единиц по слоям прихода)/quantity. Слои — приходы (in) по дате;
	// пропускаем уже потреблённые единицы (outs других документов до даты +
	// потреблённое ранними строками ЭТОГО документа), затем потребляем `quantity`.
	// consume=true фиксирует потребление в offset (для следующих строк документа).
	// Путь-зависимость (правка старых документов) страхуется блокировкой периодов.
	async function fifoCost(productUuid, warehouseUuid, dateUpTo, quantity, consume) {
		const qtyNeed = Number(quantity) || 0;
		if (!productUuid || qtyNeed <= 0) return 0;

		const { seed, rows } = await loadRegister(productUuid, warehouseUuid);
		const upTo = upToMs(dateUpTo);

		// Слои прихода (oldest → newest) и «уже потреблённое» — из одной выборки,
		// упорядоченной по (date, documentId, id). Порядок ОБЯЗАН совпадать для слоёв
		// и расходов, иначе при нескольких документах одной датой ФИФО списывает не те
		// партии. Приходы берём по date lte (как SQL), расходы других документов —
		// строго ДО текущего (date, затем documentId), собственные исключаем.
		// Снапшот (если есть) даёт остаточные слои на границе закрытого периода —
		// в начало (oldest); его pre-boundary расходы уже вычтены (front-removal),
		// поэтому priorOut считаем только по движениям ПОСЛЕ границы (rows).
		const ins = [];
		let priorOut = 0;
		if (seed) {
			for (const l of seed.layers) {
				if (l.q > 0) ins.push({ q: l.q, amount: l.q * l.unit });
			}
		}
		for (const r of rows) {
			if (r.movementType === "in") {
				if (upTo == null || r.t <= upTo) ins.push(r);
			} else {
				if (docUuid && r.documentUuid === docUuid) continue;
				const before =
					upTo == null || r.t < upTo
						? true
						: r.t === upTo && docId != null && r.documentId != null && r.documentId < docId;
				if (before) priorOut += r.q;
			}
		}
		const key = `${productUuid}|${warehouseUuid ?? ""}`;
		let skip = priorOut + (fifoOffset.get(key) || 0);

		let total = 0;
		let consumed = 0;
		let need = qtyNeed;
		for (const layer of ins) {
			let lQty = layer.q;
			const lAmt = layer.amount;
			if (lQty <= 0) continue;
			const unit = lAmt / lQty;
			if (skip > 0) {
				const s = Math.min(skip, lQty);
				skip -= s;
				lQty -= s;
				if (lQty <= 0) continue;
			}
			const take = Math.min(need, lQty);
			total += take * unit;
			consumed += take;
			need -= take;
			if (need <= 0) break;
		}
		if (consume) fifoOffset.set(key, (fifoOffset.get(key) || 0) + qtyNeed);
		// Эффективная удельная: полную стоимость доступной части распределяем на
		// весь запрошенный объём (недостаток → 0; вызывающий применит fallback цены).
		return consumed > 0 ? total / qtyNeed : 0;
	}

	// Удельная себестоимость по выбранному методу (AVERAGE по умолчанию, FIFO опц.).
	async function unitCost(productUuid, warehouseUuid, dateUpTo, quantity, opts) {
		if (costingMethod === "FIFO") {
			return fifoCost(productUuid, warehouseUuid, dateUpTo, quantity, opts?.consume === true);
		}
		return avgCost(productUuid, warehouseUuid, dateUpTo);
	}

	return { resolveAccount, resolveSubkontoType, resolveName, avgCost, unitCost, beginDocument, client };
}

// ─── Сборка проводок документа (без записи в БД) ─────────────────────────────
/**
 * Формирует список проводок (с резолвом счетов и наименований субконто) для
 * документа. Агрегирует одинаковые проводки (тот же Дт/Кт + та же аналитика +
 * описание), суммируя amount — это устраняет дубли. НЕ пишет в БД.
 *
 * @returns {Promise<Array>} массив готовых проводок:
 *   { debitAccountUuid, debitAccountCode, creditAccountUuid, creditAccountCode,
 *     amount, description, debitAnalytics:[{subkontoType,objectUuid,objectName}], creditAnalytics:[...] }
 */
export async function buildDocumentEntries(documentType, doc, items, client = prisma, costCache = new Map()) {
	const rule = POSTING_RULES[documentType];
	if (!rule) return [];
	const ctx = makeContext(client, doc.organizationUuid ?? null, costCache);
	// Плательщик НДС? (определяет разнесение НДС на 1420/3130) — НА ДАТУ ДОКУМЕНТА,
	// а не «сейчас»: иначе снятие галки задним числом убрало бы НДС из проводок уже
	// проведённых документов прошлых периодов.
	ctx.useVat = await resolveUseVat(doc.organizationUuid ?? null, doc.date ?? null, client);
	// Метод себестоимости организации (AVERAGE|FIFO) + инициализация ФИФО-состояния.
	ctx.beginDocument(await resolveCostingMethod(doc.organizationUuid ?? null, doc.date ?? null, client), doc.uuid, doc.id);
	// Себестоимость движения — из УЖЕ построенного регистра (amount по строке
	// документа): единый источник, проводка проецирует регистр, а не считает
	// себестоимость повторно. Расход (sale) — out.amount = COGS; приход возврата
	// покупателя (sale_return) — in.amount = cost-basis на дату исходной продажи.
	// Пусто (валидация ДО пересбора регистра / прямой вызов buildDocumentEntries в
	// тестах) → правило посчитает себестоимость само (fallback). У документа один тип
	// движения на строку (кроме перемещения in+out одной цены — оно карту не читает).
	ctx.registerCosts = new Map();
	if (doc.uuid) {
		const movs = await client.productRegister.findMany({
			where: { documentType, documentUuid: doc.uuid },
			select: { documentItemUuid: true, amount: true },
		});
		for (const m of movs) {
			if (m.documentItemUuid) ctx.registerCosts.set(m.documentItemUuid, Number(m.amount) || 0);
		}
	}
	const raw = await rule(doc, items ?? [], ctx);
	if (!raw?.length) return [];

	// Резолв счетов + наименований аналитик.
	const resolved = [];
	for (const e of raw) {
		const amount = r2(e.amount);
		if (amount <= 0) continue;
		const [debitAcc, creditAcc] = await Promise.all([
			ctx.resolveAccount(e.debit),
			ctx.resolveAccount(e.credit),
		]);
		const resolveSide = async (list) =>
			Promise.all(
				(list ?? []).map(async (a) => ({
					subkontoType: a.type,
					objectUuid: a.objectUuid ?? null,
					objectName: await ctx.resolveName(a.type, a.objectUuid),
				})),
			);
		resolved.push({
			debitAccountUuid: debitAcc?.uuid ?? null,
			debitAccountCode: e.debit,
			debitAccountName: debitAcc?.name ?? null,
			creditAccountUuid: creditAcc?.uuid ?? null,
			creditAccountCode: e.credit,
			creditAccountName: creditAcc?.name ?? null,
			amount,
			description: e.description ?? null,
			debitAnalytics: await resolveSide(e.debitAnalytics),
			creditAnalytics: await resolveSide(e.creditAnalytics),
		});
	}

	// Агрегация одинаковых проводок (дедуп).
	const sig = (e) => {
		const a = (list) =>
			(list ?? [])
				.map((x) => `${x.subkontoType}=${x.objectUuid ?? ""}`)
				.sort()
				.join(",");
		return `${e.debitAccountCode}|${e.creditAccountCode}|${e.description ?? ""}|D{${a(e.debitAnalytics)}}|C{${a(e.creditAnalytics)}}`;
	};
	const map = new Map();
	for (const e of resolved) {
		const k = sig(e);
		const prev = map.get(k);
		if (prev) prev.amount = r2(prev.amount + e.amount);
		else map.set(k, e);
	}
	return Array.from(map.values());
}

// ─── Проверки проведения ─────────────────────────────────────────────────────
export class PostingValidationError extends Error {
	constructor(errors) {
		super(Array.isArray(errors) ? errors.join("\n") : String(errors));
		this.name = "PostingValidationError";
		this.errors = Array.isArray(errors) ? errors : [errors];
	}
}

/**
 * Проверяет возможность проведения документа. Бросает PostingValidationError
 * при нарушениях. Не пишет в БД.
 *
 * Проверки: организация, дата, наличие счетов учёта, обязательные субконто,
 * сумма проводок > 0 (если проводки сформированы), дебет=кредит, отсутствие
 * дублирующихся проводок (гарантируется агрегацией).
 */
export async function validatePosting(documentType, doc, items, client = prisma) {
	const errors = [];
	if (!doc) {
		throw new PostingValidationError(["Документ не найден"]);
	}
	if (!doc.organizationUuid) errors.push("Не заполнена организация");
	if (!doc.date) errors.push("Не заполнена дата документа");

	const entries = await buildDocumentEntries(documentType, doc, items, client);

	if (entries.length > 0) {
		// Счета учёта существуют.
		for (const e of entries) {
			if (!e.debitAccountUuid) errors.push(`Не найден счёт учёта Дт ${e.debitAccountCode}`);
			if (!e.creditAccountUuid) errors.push(`Не найден счёт учёта Кт ${e.creditAccountCode}`);
		}

		// Обязательные субконто заполнены (по объявленным на счёте видам).
		const ctx = makeContext(client, doc.organizationUuid ?? null);
		const checkSide = async (accCode, analytics, sideLabel) => {
			// Закрытие месяца — агрегатная операция без аналитики: обязательность
			// субконто счетов 6010/7010/7210 здесь не применяется.
			if (documentType === "month_close") return;
			const acc = await ctx.resolveAccount(accCode);
			if (!acc) return;
			const declared = [acc.subkonto1Type, acc.subkonto2Type, acc.subkonto3Type].filter(Boolean);
			const present = new Set((analytics ?? []).filter((a) => a.objectUuid).map((a) => a.subkontoType));
			for (const st of declared) {
				if (REQUIRED_SUBKONTO.has(st) && !present.has(st)) {
					const stRec = await ctx.resolveSubkontoType(st);
					errors.push(`Не заполнено обязательное субконто «${stRec?.name ?? st}» для счёта ${accCode} (${sideLabel})`);
				}
			}
		};
		for (const e of entries) {
			await checkSide(e.debitAccountCode, e.debitAnalytics, "Дт");
			await checkSide(e.creditAccountCode, e.creditAnalytics, "Кт");
		}

		// Сумма проводок > 0.
		const total = r2(entries.reduce((s, e) => s + e.amount, 0));
		if (total <= 0) errors.push("Сумма проводок должна быть больше нуля");

		// Дебет = Кредит (для одиночных проводок Дт/Кт выполняется по построению).
		const totalDebit = r2(entries.reduce((s, e) => s + e.amount, 0));
		const totalCredit = totalDebit;
		if (Math.abs(totalDebit - totalCredit) > 0.005) errors.push("Дебет не равен кредиту");
	}

	if (errors.length) throw new PostingValidationError(errors);
	return { entries };
}

/** Загружает документ и строки по типу/uuid. */
async function loadDocument(documentType, documentUuid, client) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return { cfg: null, doc: null, items: [] };
	const doc = await client[cfg.parentModel].findUnique({ where: { uuid: documentUuid } });
	let items = [];
	if (doc && cfg.itemModel && cfg.parentField) {
		items = await client[cfg.itemModel].findMany({
			where: { [cfg.parentField]: documentUuid, deletedAt: null },
		});
	}
	return { cfg, doc, items };
}

// ─── Пересбор проводок документа ─────────────────────────────────────────────
/**
 * Полный пересбор проводок одного документа. Удаляет прежние проводки документа
 * и, если документ проведён (posted=true) и не удалён, создаёт новые из текущего
 * состояния. Идемпотентно. Безопасно вызывать при каждом сохранении.
 */
export async function reconcileDocumentEntries(documentType, documentUuid, client = prisma, costCache = new Map()) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	try {
		// 1. Удаляем прежние проводки документа (аналитика удалится каскадом).
		await client.accountingEntry.deleteMany({ where: { documentType, documentUuid } });

		// 2. Загружаем документ; проводки только для проведённого и не удалённого.
		const { doc, items } = await loadDocument(documentType, documentUuid, client);
		if (!doc || doc.posted !== true || doc.deletedAt) return;

		// 3. Формируем проводки. costCache разделяется на всю фазу пересчёта проводок
		//    (регистр в это время НЕизменен) — история товара читается один раз.
		const entries = await buildDocumentEntries(documentType, doc, items, client, costCache);
		if (!entries.length) return;

		// 4. Создаём проводки + аналитику.
		for (const e of entries) {
			await client.accountingEntry.create({
				data: {
					organizationUuid: doc.organizationUuid ?? null,
					documentType,
					documentUuid,
					documentId: doc.id ?? null,
					date: doc.date ?? new Date(),
					debitAccountUuid: e.debitAccountUuid,
					debitAccountCode: e.debitAccountCode,
					creditAccountUuid: e.creditAccountUuid,
					creditAccountCode: e.creditAccountCode,
					amount: e.amount,
					description: e.description,
					analytics: {
						create: [
							...e.debitAnalytics.map((a) => ({
								side: "debit",
								subkontoType: a.subkontoType,
								objectUuid: a.objectUuid,
								objectName: a.objectName,
							})),
							...e.creditAnalytics.map((a) => ({
								side: "credit",
								subkontoType: a.subkontoType,
								objectUuid: a.objectUuid,
								objectName: a.objectName,
							})),
						],
					},
				},
			});
		}
	} catch (err) {
		console.error(`reconcileDocumentEntries(${documentType}, ${documentUuid}) error:`, err);
	}
}

/** Пересбор по prisma-модели документа (для фабрики позиций). */
export async function reconcileByParentModel(parentModel, documentUuid, client = prisma) {
	const type = documentTypeForParentModel(parentModel);
	if (!type) return;
	await reconcileDocumentEntries(type, documentUuid, client);
}

/** Удалить все проводки документа (при удалении документа-регистратора). */
export async function removeDocumentEntries(documentType, documentUuid, client = prisma) {
	if (!DOC_CONFIG[documentType] || !documentUuid) return;
	try {
		await client.accountingEntry.deleteMany({ where: { documentType, documentUuid } });
	} catch (err) {
		console.error(`removeDocumentEntries(${documentType}, ${documentUuid}) error:`, err);
	}
}

/**
 * Бэкенд-гард ПЕРЕД фиксацией проведения. Принимает «прогнозируемый» документ
 * (актуальные поля из payload) и проверяет возможность проведения. Бросает
 * PostingValidationError при нарушениях — до записи в БД.
 */
export async function assertPostable(documentType, documentUuid, prospectiveDoc, client = prisma) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	const { doc, items } = await loadDocument(documentType, documentUuid, client);
	const merged = { ...(doc ?? {}), ...(prospectiveDoc ?? {}) };
	if (merged.posted !== true) return; // проверяем только при проведении
	await validatePosting(documentType, merged, items, client);
}

/** Проводки документа (для просмотра в карточке/Drawer). */
export async function getDocumentEntries(documentType, documentUuid, client = prisma) {
	return client.accountingEntry.findMany({
		where: { documentType, documentUuid },
		include: { analytics: true },
		orderBy: { id: "asc" },
	});
}

/**
 * Защитный фильтр для отчётов/просмотра проводок: оставляет только проводки,
 * чей документ-источник СЕЙЧАС проведён (posted=true) и не удалён (deletedAt=null).
 *
 * Инвариант «проводки есть ⇔ документ проведён» поддерживается reconcile при
 * сохранении, но read-time проверка гарантирует его даже при «осиротевших»
 * проводках (legacy-данные, сид, не покрытый код-путь). Дополнительно
 * САМОИСЦЕЛЯЕТСЯ: найденные осиротевшие проводки физически удаляются.
 *
 * Принимает массив проводок (нужны поля documentType, documentUuid) и клиент.
 */
export async function filterPostedEntries(entries, client = prisma) {
	const list = entries ?? [];
	if (!list.length) return list;

	// Группируем uuid документов по типу.
	const byType = new Map();
	for (const e of list) {
		if (!e.documentType || !e.documentUuid) continue;
		if (!byType.has(e.documentType)) byType.set(e.documentType, new Set());
		byType.get(e.documentType).add(e.documentUuid);
	}

	const postedKey = new Set(); // `${type}:${uuid}` проведённых и не удалённых
	const orphans = new Map(); // type → Set(uuid) — осиротевшие (известный тип)
	for (const [type, uuids] of byType) {
		const cfg = DOC_CONFIG[type];
		if (!cfg) continue; // неизвестный тип — исключаем из отчёта, но не удаляем
		let okRows = [];
		try {
			okRows = await client[cfg.parentModel].findMany({
				where: { uuid: { in: Array.from(uuids) }, posted: true, deletedAt: null },
				select: { uuid: true },
			});
		} catch (err) {
			console.error(`filterPostedEntries(${type}) lookup error:`, err);
			continue; // при ошибке проверки — исключаем (не доверяем), но не удаляем
		}
		const ok = new Set(okRows.map((r) => r.uuid));
		for (const u of uuids) {
			if (ok.has(u)) postedKey.add(`${type}:${u}`);
			else {
				if (!orphans.has(type)) orphans.set(type, new Set());
				orphans.get(type).add(u);
			}
		}
	}

	// Самоисцеление: удаляем проводки документов, которые не проведены/удалены.
	for (const [type, uuids] of orphans) {
		try {
			await client.accountingEntry.deleteMany({
				where: { documentType: type, documentUuid: { in: Array.from(uuids) } },
			});
		} catch (err) {
			console.error(`filterPostedEntries purge(${type}) error:`, err);
		}
	}

	return list.filter((e) => postedKey.has(`${e.documentType}:${e.documentUuid}`));
}

/** Маппинг PostingValidationError → HTTP 422. Возвращает true, если ответ отправлен. */
export function respondPostingError(err, res) {
	if (err instanceof PostingValidationError) {
		res.status(422).json({ success: false, message: err.message, errors: err.errors });
		return true;
	}
	return false;
}

export default {
	ACC,
	POSTING_DOC_TYPES,
	POSTING_RULES,
	documentTypeForParentModel,
	buildDocumentEntries,
	validatePosting,
	reconcileDocumentEntries,
	reconcileByParentModel,
	removeDocumentEntries,
	assertPostable,
	getDocumentEntries,
	filterPostedEntries,
	PostingValidationError,
	respondPostingError,
};
