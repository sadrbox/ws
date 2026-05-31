/**
 * modelRegistry.ts — Единый реестр всех моделей приложения.
 *
 * Заменяет 3 дублирующихся реестра:
 *   - formModuleRegistry + formComponentNameMap  (LookupField.tsx)
 *   - listComponentRegistry + listComponentNameMap (SelectPaneWrapper.tsx)
 *   - FORM_REGISTRY                               (UnsavedForms/index.tsx)
 *
 * Каждая запись описывает одну модель:
 *   endpoint    — API-endpoint (ключ маршрутизации)
 *   module      — lazy-импорт модуля
 *   formName    — экспортируемое имя Form-компонента
 *   listName    — экспортируемое имя List-компонента
 *   storageKey  — ключ sessionStorage для useFormStore
 *   label       — русское название (для UnsavedForms / табов)
 */

import type { FC } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// Типы
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelRegistryEntry {
	endpoint: string;
	module: () => Promise<any>;
	formName: string;
	listName: string;
	storageKey: string;
	label: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Реестр (единый массив)
// ═══════════════════════════════════════════════════════════════════════════

const MODEL_REGISTRY: ModelRegistryEntry[] = [
	{
		endpoint: "organizations",
		module: () => import("src/models/Organizations"),
		formName: "OrganizationsForm",
		listName: "OrganizationsList",
		storageKey: "organizations-form",
		label: "Организации",
	},
	{
		endpoint: "counterparties",
		module: () => import("src/models/Counterparties"),
		formName: "CounterpartiesForm",
		listName: "CounterpartiesList",
		storageKey: "counterparties-form",
		label: "Контрагенты",
	},
	{
		endpoint: "contactpersons",
		module: () => import("src/models/ContactPersons"),
		formName: "ContactPersonsForm",
		listName: "ContactPersonsList",
		storageKey: "contact-persons-form",
		label: "Контактные лица",
	},
	{
		endpoint: "contacts",
		module: () => import("src/models/Contacts"),
		formName: "ContactsForm",
		listName: "ContactsList",
		storageKey: "contacts-form",
		label: "Контакты",
	},
	{
		endpoint: "contracts",
		module: () => import("src/models/Contracts"),
		formName: "ContractsForm",
		listName: "ContractsList",
		storageKey: "contracts-form",
		label: "Договора",
	},
	{
		endpoint: "bankaccounts",
		module: () => import("src/models/BankAccounts"),
		formName: "BankAccountsForm",
		listName: "BankAccountsList",
		storageKey: "bank-accounts-form",
		label: "Банковские счета",
	},
	{
		endpoint: "users",
		module: () => import("src/models/Users"),
		formName: "UsersForm",
		listName: "UsersList",
		storageKey: "users-form",
		label: "Пользователи",
	},
	{
		endpoint: "activityhistories",
		module: () => import("src/models/ActivityHistories"),
		formName: "ActivityHistoriesForm",
		listName: "ActivityHistoriesList",
		storageKey: "activity-histories-form",
		label: "Журнал действий",
	},
	{
		endpoint: "todos",
		module: () => import("src/models/Todos"),
		formName: "TodosForm",
		listName: "TodosList",
		storageKey: "todos-form",
		label: "Задачи",
	},
	{
		endpoint: "brands",
		module: () => import("src/models/Brands"),
		formName: "BrandsForm",
		listName: "BrandsList",
		storageKey: "brands-form",
		label: "Бренды",
	},
	{
		endpoint: "products",
		module: () => import("src/models/Products"),
		formName: "ProductsForm",
		listName: "ProductsList",
		storageKey: "products-form",
		label: "Номенклатура",
	},
	{
		endpoint: "currencies",
		module: () => import("src/models/Currencies"),
		formName: "CurrenciesForm",
		listName: "CurrenciesList",
		storageKey: "currencies-form",
		label: "Валюты",
	},
	{
		endpoint: "employees",
		module: () => import("src/models/Employees"),
		formName: "EmployeesForm",
		listName: "EmployeesList",
		storageKey: "employees-form",
		label: "Сотрудники",
	},
	{
		endpoint: "positions",
		module: () => import("src/models/Positions"),
		formName: "PositionsForm",
		listName: "PositionsList",
		storageKey: "positions-form",
		label: "Должности",
	},
	{
		endpoint: "warehouses",
		module: () => import("src/models/Warehouses"),
		formName: "WarehousesForm",
		listName: "WarehousesList",
		storageKey: "warehouses-form",
		label: "Склады",
	},
	{
		endpoint: "cashboxes",
		module: () => import("src/models/Cashboxes"),
		formName: "CashboxesForm",
		listName: "CashboxesList",
		storageKey: "cashboxes-form",
		label: "Кассы",
	},
	{
		endpoint: "sales",
		module: () => import("src/models/Sales"),
		formName: "SalesForm",
		listName: "SalesList",
		storageKey: "sales-form",
		label: "Реализация товара и услуг",
	},
	{
		endpoint: "purchases",
		module: () => import("src/models/Purchases"),
		formName: "PurchasesForm",
		listName: "PurchasesList",
		storageKey: "purchases-form",
		label: "Поступления",
	},
	{
		endpoint: "sale-returns",
		module: () => import("src/models/SalesReturns"),
		formName: "SalesReturnsForm",
		listName: "SalesReturnsList",
		storageKey: "sale-returns-form",
		label: "Возврат от покупателя",
	},
	{
		endpoint: "purchase-returns",
		module: () => import("src/models/PurchaseReturns"),
		formName: "PurchaseReturnsForm",
		listName: "PurchaseReturnsList",
		storageKey: "purchase-returns-form",
		label: "Возврат поставщику",
	},
	{
		endpoint: "incoming-invoices",
		module: () => import("src/models/IncomingInvoices"),
		formName: "IncomingInvoicesForm",
		listName: "IncomingInvoicesList",
		storageKey: "incoming-invoices-form",
		label: "Счет-фактуры входящие",
	},
	{
		endpoint: "outgoing-invoices",
		module: () => import("src/models/OutgoingInvoices"),
		formName: "OutgoingInvoicesForm",
		listName: "OutgoingInvoicesList",
		storageKey: "outgoing-invoices-form",
		label: "Счет-фактуры исходящие",
	},
	{
		endpoint: "payment-invoices",
		module: () => import("src/models/PaymentInvoices"),
		formName: "PaymentInvoicesForm",
		listName: "PaymentInvoicesList",
		storageKey: "payment-invoices-form",
		label: "Счета на оплату",
	},
	{
		endpoint: "purchase-requisitions",
		module: () => import("src/models/PurchaseRequisitions"),
		formName: "PurchaseRequisitionsForm",
		listName: "PurchaseRequisitionsList",
		storageKey: "purchase-requisitions-form",
		label: "Заявки на закупку",
	},
	{
		endpoint: "cash-receipt-orders",
		module: () => import("src/models/CashReceiptOrders"),
		formName: "CashReceiptOrdersForm",
		listName: "CashReceiptOrdersList",
		storageKey: "cash-receipt-orders-form",
		label: "Приходный кассовый ордер",
	},
	{
		endpoint: "cash-expense-orders",
		module: () => import("src/models/CashExpenseOrders"),
		formName: "CashExpenseOrdersForm",
		listName: "CashExpenseOrdersList",
		storageKey: "cash-expense-orders-form",
		label: "Расходный кассовый ордер",
	},
	{
		endpoint: "inventory-transfers",
		module: () => import("src/models/InventoryTransfers"),
		formName: "InventoryTransfersForm",
		listName: "InventoryTransfersList",
		storageKey: "inventory-transfers-form",
		label: "Перемещение ТМЗ",
	},
	{
		endpoint: "scheduled-tasks",
		module: () => import("src/models/ScheduledTasks"),
		formName: "ScheduledTasksForm",
		listName: "ScheduledTasksList",
		storageKey: "scheduled-tasks-form",
		label: "Регламентные задачи",
	},
	{
		endpoint: "user-permissions",
		module: () => import("src/models/UserAccessRights"),
		formName: "UserAccessRightsForm",
		listName: "UserAccessRightsList",
		storageKey: "user-access-rights-form",
		label: "Права доступа",
	},
	{
		endpoint: "payroll-calculations",
		module: () => import("src/models/PayrollCalculations"),
		formName: "PayrollCalculationsForm",
		listName: "PayrollCalculationsList",
		storageKey: "payroll-calculations-form",
		label: "Начисление заработной платы",
	},
	{
		endpoint: "payroll-payments",
		module: () => import("src/models/PayrollPayments"),
		formName: "PayrollPaymentsForm",
		listName: "PayrollPaymentsList",
		storageKey: "payroll-payments-form",
		label: "Выплата заработной платы",
	},
	{
		endpoint: "unit-of-measures",
		module: () => import("src/models/UnitOfMeasures"),
		formName: "UnitOfMeasuresForm",
		listName: "UnitOfMeasuresList",
		storageKey: "unit-of-measures-form",
		label: "Единицы измерения",
	},
	{
		endpoint: "taxes",
		module: () => import("src/models/Taxes"),
		formName: "TaxesForm",
		listName: "TaxesList",
		storageKey: "taxes-form",
		label: "Налоги",
	},
	{
		endpoint: "organization-accounting-settings",
		module: () => import("src/models/OrganizationAccountingSettings"),
		formName: "OrganizationAccountingSettingsForm",
		listName: "OrganizationAccountingSettingsList",
		storageKey: "organization-accounting-settings-form",
		label: "Настройки учёта организации",
	},
	{
		endpoint: "chart-of-accounts",
		module: () => import("src/models/ChartOfAccounts"),
		formName: "ChartOfAccountsForm",
		listName: "ChartOfAccountsList",
		storageKey: "chart-of-accounts-form",
		label: "План счетов",
	},
	{
		endpoint: "subkonto-types",
		module: () => import("src/models/SubkontoTypes"),
		formName: "SubkontoTypesForm",
		listName: "SubkontoTypesList",
		storageKey: "subkonto-types-form",
		label: "Виды субконто",
	},
];

// ═══════════════════════════════════════════════════════════════════════════
// Индексы (O(1) поиск)
// ═══════════════════════════════════════════════════════════════════════════

/** endpoint → ModelRegistryEntry */
const byEndpoint = new Map<string, ModelRegistryEntry>();
/** storageKey → ModelRegistryEntry */
const byStorageKey = new Map<string, ModelRegistryEntry>();

for (const entry of MODEL_REGISTRY) {
	byEndpoint.set(entry.endpoint, entry);
	byStorageKey.set(entry.storageKey, entry);
}

// ═══════════════════════════════════════════════════════════════════════════
// Публичное API
// ═══════════════════════════════════════════════════════════════════════════

/** Получить запись по endpoint (например "organizations", "cash-receipt-orders") */
export function getByEndpoint(
	endpoint: string,
): ModelRegistryEntry | undefined {
	return byEndpoint.get(endpoint);
}

/** Получить запись по storageKey (например "organizations-form", "cash-receipt-orders-form") */
export function getByStorageKey(
	storageKey: string,
): ModelRegistryEntry | undefined {
	return byStorageKey.get(storageKey);
}

/** Весь массив записей (для итерации) */
export function getAllEntries(): readonly ModelRegistryEntry[] {
	return MODEL_REGISTRY;
}

/**
 * Загрузить Form-компонент по endpoint.
 * Возвращает React FC или undefined, если endpoint не найден в реестре.
 */
export async function loadFormByEndpoint(
	endpoint: string,
): Promise<FC<any> | undefined> {
	const entry = byEndpoint.get(endpoint);
	if (!entry) return undefined;
	const mod = await entry.module();
	return mod[entry.formName] || mod.default;
}

/**
 * Загрузить List-компонент по endpoint.
 * Возвращает React FC или undefined, если endpoint не найден в реестре.
 */
export async function loadListByEndpoint(
	endpoint: string,
): Promise<FC<any> | undefined> {
	const entry = byEndpoint.get(endpoint);
	if (!entry) return undefined;
	const mod = await entry.module();
	return mod[entry.listName] || mod.default;
}

export default MODEL_REGISTRY;
