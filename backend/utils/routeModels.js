// Карта «первый сегмент пути → модель прав».
//
// ОТДЕЛЬНЫЙ МОДУЛЬ БЕЗ PRISMA (24.09): её читают профили прав, которым база не нужна и которые
// проверяются тестом в гейте `verify`. Заодно видно главное свойство карты: маршрут, которого в
// ней нет, `accessPermissionMiddleware` ПРОПУСКАЕТ без проверки — это и есть находка П1 разбора
// `docs/DESIGN_PREINSTALL_AUDIT_2026-09-24.md`, которую предстоит менять на запрет по умолчанию.


// ═══════════════════════════════════════════════════════════════════════════
// Маппинг URL-путей → имя модели в AccessPermission (PascalCase из ALL_MODEL_NAMES)
// ═══════════════════════════════════════════════════════════════════════════
export const ROUTE_TO_MODEL = {
	organizations: "Organization",
	counterparties: "Counterparty",
	contracts: "Contract",
	"contract-files": "AttachedFile",
	contacts: "Contact",
	contactpersons: "ContactPerson",
	bankaccounts: "BankAccount",
	activityhistories: "ActivityHistory",
	// Входящие события 1С — тот же журнал, только внешний источник: право общее.
	pipeactivities: "ActivityHistory",
	// Ввод остатков серий/партий меняет учётные данные товара → право номенклатуры.
	"opening-balance": "Product",
	todos: "Todo",
	deals: "Deal",
	// Справочник статусов задач — КОНФИГУРАЦИЯ, а не пользовательский контент:
	// переименование/удаление статуса влияет на все задачи организации, поэтому
	// требует того же права, что и сами задачи (фронт гейтит меню так же).
	"todo-statuses": "Todo",
	warehouses: "Warehouse",
	cashboxes: "Cashbox",
	sales: "Sale",
	"sale-returns": "SaleReturn",
	"sale-return-items": "SaleReturnItem",
	purchases: "Purchase",
	"purchase-returns": "PurchaseReturn",
	"purchase-return-items": "PurchaseReturnItem",
	"outgoing-invoices": "OutgoingInvoice",
	"incoming-invoices": "IncomingInvoice",
	"payment-invoices": "PaymentInvoice",
	"purchase-requisitions": "PurchaseRequisition",
	"purchase-requisition-items": "PurchaseRequisitionItem",
	"commercial-offers": "CommercialOffer",
	"commercial-offer-items": "CommercialOfferItem",
	"sales-orders": "SalesOrder",
	"sales-order-items": "SalesOrderItem",
	"reservations": "Reservation",
	"reservation-items": "ReservationItem",
	"purchase-orders": "PurchaseOrder",
	"purchase-order-items": "PurchaseOrderItem",
	importdeclarations: "ImportDeclaration",
	importdeclarationitems: "ImportDeclarationItem",
	writeoffs: "WriteOff",
	writeoffitems: "WriteOffItem",
	goodsreceipts: "GoodsReceipt",
	goodsreceiptitems: "GoodsReceiptItem",
	stockcounts: "StockCount",
	stockcountitems: "StockCountItem",
	serialnumbers: "SerialNumber",
	productbatches: "ProductBatch",
	"bank-statements": "BankStatement",
	"scheduled-tasks": "ScheduledTask",
	"inventory-transfers": "InventoryTransfer",
	"cash-receipt-orders": "CashReceiptOrder",
	"cash-expense-orders": "CashExpenseOrder",
	brands: "Brand",
	products: "Product",
	productbarcodes: "Product",
	saleitems: "SaleItem",
	employees: "Employee",
	positions: "Position",
	"employee-histories": "EmployeeHistory",
	"access-permissions": "AccessPermission",
	currencies: "Currency",
	"unit-of-measures": "UnitOfMeasure",
	"vat-rates": "VatRate",
	"payroll-calculations": "PayrollCalculation",
	"payroll-payments": "PayrollPayment",
	"chart-of-accounts": "ChartOfAccount",
	"subkonto-types": "SubkontoType",
	accounting: "AccountingEntry",
	users: "User",
	files: "AttachedFile",

	// ── Описано по Б12 аудита 26.09 (сканер прав раньше не видел шаблонных путей) ──────────
	// Строки документа правит тот, кто правит документ: право — модели-родителя. Отдельных
	// «прав на строки» никто не раздавал, а право документа уже есть у всех, кто с ним работает.
	purchaseitems: "Purchase",
	purchasefixedassetitems: "Purchase",
	outgoinginvoiceitems: "OutgoingInvoice",
	incominginvoiceitems: "IncomingInvoice",
	paymentinvoiceitems: "PaymentInvoice",
	inventorytransferitems: "InventoryTransfer",
	// Закрытие месяца закрывает период всей организации. Меню панели уже открывает раздел только
	// по праву MonthClose (NavList), а API пускал любого вошедшего — теперь правило одно.
	"month-closes": "MonthClose",
};
