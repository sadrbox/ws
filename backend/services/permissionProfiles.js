// ПРОФИЛИ ПРАВ — именованные наборы доступа (О2 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. Право — это строка «пользователь × модель × организация», а моделей в карте 62. Завести
// бухгалтера, кладовщика и кассира значило проставить сотни галочек — и так на КАЖДОЙ установке,
// при каждом новом сотруднике. Пользователь, присоединившийся по коду приглашения, получал ноль
// прав: входил и не видел ничего, притом что ошибки не было.
//
// ПРОФИЛЬ — ШАБЛОН, А НЕ ЖИВАЯ РОЛЬ. При назначении он РАЗВОРАЧИВАЕТСЯ в обычные
// `access_permissions`, дальше права правятся точечно. Живая роль (правка профиля меняет доступ
// у всех, кому он выдан) выглядит удобнее ровно до первого случая, когда администратор поправил
// шаблон и молча расширил доступ десяти людям — задним числом и не заметив.
//
// ОПРЕДЕЛЕНИЯ ЖИВУТ В КОДЕ, А НЕ В БАЗЕ. Системный профиль — часть поставки: он версионируется
// вместе с моделями, не требует сидов на каждой установке и не расходится между ними. База
// понадобится для ПОЛЬЗОВАТЕЛЬСКИХ профилей (отдельная задача) — интерфейс `listProfiles()` уже
// рассчитан на то, что к этим добавятся хранимые.
//
// БЕЗ PRISMA: модуль проверяется тестом в гейте `verify` и переиспользуется установщиком.
import { ROUTE_TO_MODEL } from "../utils/auth.js";

/** Уровни доступа — те же, что понимает `accessPermissionMiddleware`. */
export const LEVELS = ["none", "readonly", "full"];

/**
 * Все модели, которыми вообще управляют права. Берём из карты маршрутов, а не из отдельного
 * списка: разойдись они — и профиль «всё» тихо перестанет покрывать новый раздел.
 */
export function allModels() {
	return [...new Set(Object.values(ROUTE_TO_MODEL))].sort();
}

// ── Группы моделей ──────────────────────────────────────────────────────────
// Профили описываются группами, а не перечислением 62 имён: список без групп нечитаем, и при
// добавлении модели её забывают вписать во все профили сразу.
const G = {
	sales: ["Sale", "SaleItem", "SaleReturn", "SaleReturnItem", "SalesOrder", "SalesOrderItem",
		"CommercialOffer", "CommercialOfferItem", "Reservation", "ReservationItem", "OutgoingInvoice"],
	purchase: ["Purchase", "PurchaseReturn", "PurchaseReturnItem", "PurchaseOrder", "PurchaseOrderItem",
		"PurchaseRequisition", "PurchaseRequisitionItem", "IncomingInvoice", "ImportDeclaration", "ImportDeclarationItem"],
	warehouse: ["InventoryTransfer", "GoodsReceipt", "GoodsReceiptItem", "StockCount", "StockCountItem",
		"WriteOff", "WriteOffItem", "SerialNumber", "ProductBatch", "Warehouse"],
	cash: ["CashReceiptOrder", "CashExpenseOrder", "Cashbox", "BankAccount", "BankStatement", "PaymentInvoice"],
	hr: ["Employee", "EmployeeHistory", "Position", "PayrollCalculation", "PayrollPayment"],
	accounting: ["AccountingEntry", "ChartOfAccount", "SubkontoType", "VatRate"],
	/** Справочники, без которых не выписать ни одного документа. */
	catalogs: ["Counterparty", "Contract", "Contact", "ContactPerson", "Product", "Brand",
		"Currency", "UnitOfMeasure"],
	/** Управление доступом и самой организацией — власть, а не работа. */
	admin: ["User", "AccessPermission", "Organization"],
	common: ["AttachedFile", "Todo", "ActivityHistory", "Deal", "ScheduledTask"],
};

/**
 * Системные профили.
 *
 * `base` — уровень для всего, что не названо явно. Так профиль остаётся верным, когда в системе
 * появляется новая модель: «Только просмотр» продолжает видеть всё, а кассир по-прежнему не
 * получает лишнего, потому что его умолчание — `none`.
 */
const SYSTEM = [
	{
		code: "owner", name: "Владелец организации", base: "full", none: [],
		description: "Полный доступ ко всему, включая пользователей и права",
	},
	{
		code: "accountant", name: "Бухгалтер", base: "full",
		// Бухгалтер ведёт учёт, но не раздаёт доступ: это разные обязанности, и совмещать их
		// в одном профиле значит выдавать власть вместе с работой.
		readonly: [...G.admin],
		description: "Документы, учёт и справочники; пользователи и права — только просмотр",
	},
	{
		code: "storekeeper", name: "Кладовщик", base: "none",
		full: [...G.warehouse, "AttachedFile"],
		readonly: ["Product", "Counterparty", "UnitOfMeasure", "Brand", "SerialNumber", ...G.sales, ...G.purchase],
		description: "Складские документы; товары и отгрузки — только просмотр",
	},
	{
		code: "cashier", name: "Кассир", base: "none",
		full: [...G.cash, "AttachedFile"],
		readonly: ["Counterparty", "Contract", "Currency", ...G.sales, ...G.purchase],
		description: "Касса и банк; документы продаж и закупок — только просмотр",
	},
	{
		code: "sales", name: "Менеджер по продажам", base: "none",
		full: [...G.sales, "Counterparty", "Contract", "Contact", "ContactPerson", "Deal", "AttachedFile", "Todo"],
		readonly: ["Product", "Brand", "Warehouse", "Currency", "UnitOfMeasure", "Cashbox"],
		description: "Продажи, заказы и клиенты; товары и остатки — только просмотр",
	},
	{
		code: "manager", name: "Руководитель", base: "readonly",
		// Смотрит всё, но не правит: подпись под документом должна оставаться за исполнителем.
		full: ["Todo", "Deal"],
		none: ["AccessPermission"],
		description: "Просмотр всех данных, задачи и сделки — с правкой",
	},
	{
		code: "viewer", name: "Только просмотр", base: "readonly",
		none: [...G.admin],
		description: "Просмотр данных без права изменения",
	},
	{
		// Для обслуживающей фирмы (К2): тот же бухгалтер, но БЕЗ доступа к пользователям и
		// правам клиента — чужой учёт ведут, чужим доступом не распоряжаются.
		code: "service_accountant", name: "Обслуживающий бухгалтер", base: "full",
		none: [...G.admin],
		description: "Учёт клиента по договору обслуживания; доступ клиента не меняет",
	},
];

/** Список профилей для интерфейса (без разворота в права — он бывает длинным). */
export function listProfiles() {
	return SYSTEM.map(({ code, name, description, base }) => ({ code, name, description, base, isSystem: true }));
}

export function findProfile(code) {
	return SYSTEM.find((p) => p.code === code) ?? null;
}

/**
 * Развернуть профиль в набор `{ modelName: level }` по ВСЕМ моделям.
 *
 * Разворачиваем полностью, а не только названное: иначе «не упомянут» означало бы «как было», и
 * смена профиля оставляла бы хвосты прежнего — самый неприятный вид дыры, потому что в интерфейсе
 * он выглядит как аккуратно выданный профиль.
 *
 * Приоритет: явное упоминание (`none` → `readonly` → `full`, каждое следующее перекрывает
 * предыдущее) главнее `base`.
 */
export function expandProfile(code, models = allModels()) {
	const p = findProfile(code);
	if (!p) return null;
	const out = {};
	for (const m of models) out[m] = p.base;
	for (const m of p.none ?? []) if (m in out) out[m] = "none";
	for (const m of p.readonly ?? []) if (m in out) out[m] = "readonly";
	for (const m of p.full ?? []) if (m in out) out[m] = "full";
	return out;
}

/**
 * Профиль по умолчанию для новой связи с организацией.
 *
 * Владелец получает `owner`. Приглашённому по коду даём `viewer`, а не пустоту: пустота —
 * это «вошёл и не видит ничего, хотя всё в порядке», а просмотр безопасен и сразу показывает,
 * что система работает. Расширяет доступ администратор — осознанно.
 */
export function defaultProfileFor(role) {
	return role === "admin" ? "owner" : "viewer";
}

export default { LEVELS, allModels, listProfiles, findProfile, expandProfile, defaultProfileFor };
