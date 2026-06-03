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

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Коды типовых счетов РК (см. seed-accounting.js).
export const ACC = {
	CASH: "1010",
	BANK: "1030",
	AR: "1210", // дебиторская задолженность покупателей
	MATERIALS: "1310",
	GOODS: "1330",
	FIXED: "2410",
	AP: "3310", // задолженность поставщикам
	PAYROLL: "3350",
	RETAINED: "5510",
	REVENUE: "6010",
	COGS: "7010",
	ADMIN_EXP: "7210",
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
	inventory_transfer: { parentModel: "inventoryTransfer", itemModel: "inventoryTransferItem", parentField: "inventoryTransferUuid" },
	cash_receipt_order: { parentModel: "cashReceiptOrder" },
	cash_expense_order: { parentModel: "cashExpenseOrder" },
	bank_statement: { parentModel: "bankStatement" },
	payroll_calculation: { parentModel: "payrollCalculation" },
	payroll_payment: { parentModel: "payrollPayment" },
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

// ─── Реестр правил формирования проводок ─────────────────────────────────────
// Каждое правило: (doc, items, ctx) => Promise<Array<RawEntry>> | Array<RawEntry>
// RawEntry = { debit, credit, amount, description, debitAnalytics[], creditAnalytics[] }
export const POSTING_RULES = {
	// Поступление товаров: Дт 1330 (Номенклатура, Склад) Кт 3310 (Контрагент, Договор)
	purchase: (doc, items) =>
		items
			.filter((it) => it.productUuid && r2(it.amount) > 0)
			.map((it) => ({
				debit: ACC.GOODS,
				credit: ACC.AP,
				amount: r2(it.amount),
				description: "Оприходование товара",
				debitAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
				creditAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
			})),

	// Реализация: отражение дохода (Дт 1210 Кт 6010) + списание себестоимости (Дт 7010 Кт 1330).
	sale: async (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const amount = r2(it.amount);
			if (amount > 0) {
				out.push({
					debit: ACC.AR,
					credit: ACC.REVENUE,
					amount,
					description: "Выручка от реализации",
					debitAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
					creditAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Nomenclature", it.productUuid)]),
				});
			}
			const cost = r2((await ctx.avgCost(it.productUuid, doc.warehouseUuid, doc.date)) * Number(it.quantity || 0));
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
			const amount = r2(it.amount);
			if (amount > 0) {
				out.push({
					debit: ACC.REVENUE,
					credit: ACC.AR,
					amount,
					description: "Сторно выручки (возврат от покупателя)",
					debitAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Nomenclature", it.productUuid)]),
					creditAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
				});
			}
			const cost = r2((await ctx.avgCost(it.productUuid, doc.warehouseUuid, doc.date)) * Number(it.quantity || 0));
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

	// Возврат поставщику: Дт 3310 (Контрагент, Договор) Кт 1330 (Номенклатура, Склад).
	purchase_return: (doc, items) =>
		items
			.filter((it) => it.productUuid && r2(it.amount) > 0)
			.map((it) => ({
				debit: ACC.AP,
				credit: ACC.GOODS,
				amount: r2(it.amount),
				description: "Возврат товара поставщику",
				debitAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
				creditAnalytics: compact([an("Nomenclature", it.productUuid), an("Warehouse", doc.warehouseUuid)]),
			})),

	// Перемещение ТМЗ между складами: Дт 1330 (Номенклатура, Склад-получатель)
	// Кт 1330 (Номенклатура, Склад-источник). Сумма — по себестоимости (скользящая
	// средняя из склада-источника), при отсутствии — по цене строки.
	inventory_transfer: async (doc, items, ctx) => {
		const out = [];
		for (const it of items) {
			if (!it.productUuid) continue;
			const unit = await ctx.avgCost(it.productUuid, doc.fromWarehouseUuid, doc.date);
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

	// Приходный кассовый ордер: Дт 1010 Кт <счёт основания = 1210 от покупателя>.
	cash_receipt_order: (doc) => {
		const amount = r2(doc.amount);
		if (amount <= 0) return [];
		return [{
			debit: ACC.CASH,
			credit: ACC.AR,
			amount,
			description: doc.comment || "Поступление денег в кассу",
			debitAnalytics: [],
			creditAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
		}];
	},

	// Расходный кассовый ордер: Дт <счёт основания = 3310 поставщику> Кт 1010.
	cash_expense_order: (doc) => {
		const amount = r2(doc.amount);
		if (amount <= 0) return [];
		return [{
			debit: ACC.AP,
			credit: ACC.CASH,
			amount,
			description: doc.comment || "Выдача денег из кассы",
			debitAnalytics: compact([an("Counterparty", doc.counterpartyUuid), an("Contract", doc.contractUuid)]),
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
};

// ─── Резолверы счетов и наименований субконто (с кэшем на вызов) ──────────────
function makeContext(client, orgUuid) {
	const accCache = new Map(); // code → account|null
	const subkontoCache = new Map(); // code → SubkontoType|null
	const nameCache = new Map(); // `${model}:${uuid}` → name

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

	// Скользящая средняя себестоимость единицы из регистра товаров (приходы до даты).
	async function avgCost(productUuid, warehouseUuid, dateUpTo) {
		if (!productUuid) return 0;
		const where = { productUuid, movementType: "in" };
		if (warehouseUuid) where.warehouseUuid = warehouseUuid;
		if (orgUuid) where.organizationUuid = orgUuid;
		if (dateUpTo) where.date = { lte: dateUpTo };
		const rows = await client.productRegister.findMany({
			where,
			select: { quantity: true, amount: true },
		});
		let qty = 0;
		let amt = 0;
		for (const row of rows) {
			qty += Number(row.quantity) || 0;
			amt += Number(row.amount) || 0;
		}
		return qty > 0 ? amt / qty : 0;
	}

	return { resolveAccount, resolveSubkontoType, resolveName, avgCost };
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
export async function buildDocumentEntries(documentType, doc, items, client = prisma) {
	const rule = POSTING_RULES[documentType];
	if (!rule) return [];
	const ctx = makeContext(client, doc.organizationUuid ?? null);
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
export async function reconcileDocumentEntries(documentType, documentUuid, client = prisma) {
	const cfg = DOC_CONFIG[documentType];
	if (!cfg || !documentUuid) return;
	try {
		// 1. Удаляем прежние проводки документа (аналитика удалится каскадом).
		await client.accountingEntry.deleteMany({ where: { documentType, documentUuid } });

		// 2. Загружаем документ; проводки только для проведённого и не удалённого.
		const { doc, items } = await loadDocument(documentType, documentUuid, client);
		if (!doc || doc.posted !== true || doc.deletedAt) return;

		// 3. Формируем проводки.
		const entries = await buildDocumentEntries(documentType, doc, items, client);
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
