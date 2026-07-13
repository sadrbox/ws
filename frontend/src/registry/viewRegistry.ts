/**
 * viewRegistry — единый реестр ПАНЕЛЕЙ-ПРЕДСТАВЛЕНИЙ (то, что открывается вкладкой).
 *
 * Зачем отдельный модуль: панель хранит живой React-компонент, а его нельзя записать
 * в localStorage. Значит после перезагрузки панель можно поднять только по ИМЕНИ —
 * а для этого имя должно где-то резолвиться в компонент. Раньше lazy-компоненты были
 * объявлены прямо в навбаре (components/UI), наружу не отдавались, и открытые из меню
 * панели после F5 просто исчезали.
 *
 * Здесь они объявлены один раз и доступны:
 *   • навбару  — чтобы открывать панели;
 *   • paneRestore — чтобы восстанавливать их по имени.
 *
 * displayName ОБЯЗАТЕЛЕН: по нему дедуплицируются панели (getComponentName) и по нему
 * же идёт восстановление.
 */
import React from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyView(name: string, loader: () => Promise<{ default: React.ComponentType<any> }>): React.FC<any> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const C = React.lazy(loader) as unknown as React.FC<any> & { displayName?: string };
	C.displayName = name;
	return C;
}

export const ContractsList = lazyView("ContractsList", () => import('src/models/Contracts').then(m => ({ default: m.ContractsList })));
export const ActivityHistoriesList = lazyView("ActivityHistoriesList", () => import('src/models/ActivityHistories').then(m => ({ default: m.ActivityHistoriesList })));
export const PipeActivitiesList = lazyView("PipeActivitiesList", () => import('src/models/PipeActivities').then(m => ({ default: m.PipeActivitiesList })));
export const OrganizationsList = lazyView("OrganizationsList", () => import('src/models/Organizations').then(m => ({ default: m.OrganizationsList })));
export const BankAccountsList = lazyView("BankAccountsList", () => import('src/models/BankAccounts').then(m => ({ default: m.BankAccountsList })));
export const CounterpartiesList = lazyView("CounterpartiesList", () => import('src/models/Counterparties').then(m => ({ default: m.CounterpartiesList })));
export const ContactsList = lazyView("ContactsList", () => import('src/models/Contacts').then(m => ({ default: m.ContactsList })));
export const ContactPersonsList = lazyView("ContactPersonsList", () => import('src/models/ContactPersons').then(m => ({ default: m.ContactPersonsList })));
export const UsersList = lazyView("UsersList", () => import('src/models/Users').then(m => ({ default: m.UsersList })));
export const TodosList = lazyView("TodosList", () => import('src/models/Todos').then(m => ({ default: m.TodosList })));
export const NotificationsList = lazyView("NotificationsList", () => import('src/models/Notifications').then(m => ({ default: m.NotificationsList })));
export const WarehousesList = lazyView("WarehousesList", () => import('src/models/Warehouses').then(m => ({ default: m.WarehousesList })));
export const CashboxesList = lazyView("CashboxesList", () => import('src/models/Cashboxes').then(m => ({ default: m.CashboxesList })));
export const PriceTypesList = lazyView("PriceTypesList", () => import('src/models/PriceTypes').then(m => ({ default: m.PriceTypesList })));
export const SalesList = lazyView("SalesList", () => import('src/models/Sales').then(m => ({ default: m.SalesList })));
export const ProductPriceCorrection = lazyView("ProductPriceCorrection", () => import('src/models/ProductPriceProcessing').then(m => ({ default: m.ProductPriceCorrection })));
export const ProductPriceImport = lazyView("ProductPriceImport", () => import('src/models/ProductPriceProcessing').then(m => ({ default: m.ProductPriceImport })));
export const ProductImportExport = lazyView("ProductImportExport", () => import('src/models/ProductImportExport').then(m => ({ default: m.ProductImportExport })));
export const SaleReturnsList = lazyView("SaleReturnsList", () => import('src/models/SaleReturns').then(m => ({ default: m.SaleReturnsList })));
export const PurchasesList = lazyView("PurchasesList", () => import('src/models/Purchases').then(m => ({ default: m.PurchasesList })));
export const PurchaseReturnsList = lazyView("PurchaseReturnsList", () => import('src/models/PurchaseReturns').then(m => ({ default: m.PurchaseReturnsList })));
export const PurchaseRequisitionsList = lazyView("PurchaseRequisitionsList", () => import('src/models/PurchaseRequisitions').then(m => ({ default: m.PurchaseRequisitionsList })));
export const OutgoingInvoicesList = lazyView("OutgoingInvoicesList", () => import('src/models/OutgoingInvoices').then(m => ({ default: m.OutgoingInvoicesList })));
export const EdoInboxList = lazyView("EdoInboxList", () => import('src/models/Edo').then(m => ({ default: m.EdoInboxList })));
export const EdoOutboxList = lazyView("EdoOutboxList", () => import('src/models/Edo').then(m => ({ default: m.EdoOutboxList })));
export const ClassifiersList = lazyView("ClassifiersList", () => import('src/models/Classifiers').then(m => ({ default: m.ClassifiersList })));
export const EsfIncomingList = lazyView("EsfIncomingList", () => import('src/models/EsfIncoming').then(m => ({ default: m.EsfIncomingList })));
export const AwpOutboxList = lazyView("AwpOutboxList", () => import('src/models/GovDocs').then(m => ({ default: m.AwpOutboxList })));
export const SntOutboxList = lazyView("SntOutboxList", () => import('src/models/GovDocs').then(m => ({ default: m.SntOutboxList })));
export const AwpIncomingList = lazyView("AwpIncomingList", () => import('src/models/GovDocs').then(m => ({ default: m.AwpIncomingList })));
export const SntIncomingList = lazyView("SntIncomingList", () => import('src/models/GovDocs').then(m => ({ default: m.SntIncomingList })));
export const IncomingInvoicesList = lazyView("IncomingInvoicesList", () => import('src/models/IncomingInvoices').then(m => ({ default: m.IncomingInvoicesList })));
export const PaymentInvoicesList = lazyView("PaymentInvoicesList", () => import('src/models/PaymentInvoices').then(m => ({ default: m.PaymentInvoicesList })));
export const ScheduledTasksList = lazyView("ScheduledTasksList", () => import('src/models/ScheduledTasks').then(m => ({ default: m.ScheduledTasksList })));
export const InventoryTransfersList = lazyView("InventoryTransfersList", () => import('src/models/InventoryTransfers').then(m => ({ default: m.InventoryTransfersList })));
export const ImportDeclarationsList = lazyView("ImportDeclarationsList", () => import('src/models/ImportDeclarations').then(m => ({ default: m.ImportDeclarationsList })));
export const WriteOffsList = lazyView("WriteOffsList", () => import('src/models/WriteOffs').then(m => ({ default: m.WriteOffsList })));
export const SerialNumbersList = lazyView("SerialNumbersList", () => import('src/models/SerialNumbers').then(m => ({ default: m.SerialNumbersList })));
export const GoodsReceiptsList = lazyView("GoodsReceiptsList", () => import('src/models/GoodsReceipts').then(m => ({ default: m.GoodsReceiptsList })));
export const StockCountsList = lazyView("StockCountsList", () => import('src/models/StockCounts').then(m => ({ default: m.StockCountsList })));
export const CommercialOffersList = lazyView("CommercialOffersList", () => import('src/models/CommercialOffers').then(m => ({ default: m.CommercialOffersList })));
export const SalesOrdersList = lazyView("SalesOrdersList", () => import('src/models/SalesOrders').then(m => ({ default: m.SalesOrdersList })));
export const ReservationsList = lazyView("ReservationsList", () => import('src/models/Reservations').then(m => ({ default: m.ReservationsList })));
export const PurchaseOrdersList = lazyView("PurchaseOrdersList", () => import('src/models/PurchaseOrders').then(m => ({ default: m.PurchaseOrdersList })));
export const BankStatementsList = lazyView("BankStatementsList", () => import('src/models/BankStatements').then(m => ({ default: m.BankStatementsList })));
export const MonthClosesList = lazyView("MonthClosesList", () => import('src/models/MonthCloses').then(m => ({ default: m.MonthClosesList })));
export const FiscalReceiptsList = lazyView("FiscalReceiptsList", () => import('src/models/FiscalReceipts').then(m => ({ default: m.FiscalReceiptsList })));
export const CashReceiptOrdersList = lazyView("CashReceiptOrdersList", () => import('src/models/CashReceiptOrders').then(m => ({ default: m.CashReceiptOrdersList })));
export const CashExpenseOrdersList = lazyView("CashExpenseOrdersList", () => import('src/models/CashExpenseOrders').then(m => ({ default: m.CashExpenseOrdersList })));
export const BrandsList = lazyView("BrandsList", () => import('src/models/Brands').then(m => ({ default: m.BrandsList })));
export const ProductsList = lazyView("ProductsList", () => import('src/models/Products').then(m => ({ default: m.ProductsList })));
export const UnitOfMeasuresList = lazyView("UnitOfMeasuresList", () => import('src/models/UnitOfMeasures').then(m => ({ default: m.UnitOfMeasuresList })));
export const TaxesList = lazyView("TaxesList", () => import('src/models/Taxes').then(m => ({ default: m.TaxesList })));
export const OrganizationAccountingSettingsList = lazyView("OrganizationAccountingSettingsList", () => import('src/models/OrganizationAccountingSettings').then(m => ({ default: m.OrganizationAccountingSettingsList })));
export const GeneralSettings = lazyView("GeneralSettings", () => import('src/models/GeneralSettings').then(m => ({ default: m.default })));
export const DocumentNumberSettings = lazyView("DocumentNumberSettings", () => import('src/models/DocumentNumberSettings').then(m => ({ default: m.default })));
export const FilesList = lazyView("FilesList", () => import('src/models/Files').then(m => ({ default: m.FilesList })));
export const CurrenciesList = lazyView("CurrenciesList", () => import('src/models/Currencies').then(m => ({ default: m.CurrenciesList })));
export const EmployeesList = lazyView("EmployeesList", () => import('src/models/Employees').then(m => ({ default: m.EmployeesList })));
export const PositionsList = lazyView("PositionsList", () => import('src/models/Positions').then(m => ({ default: m.PositionsList })));
export const PayrollCalculationsList = lazyView("PayrollCalculationsList", () => import('src/models/PayrollCalculations').then(m => ({ default: m.PayrollCalculationsList })));
export const PayrollPaymentsList = lazyView("PayrollPaymentsList", () => import('src/models/PayrollPayments').then(m => ({ default: m.PayrollPaymentsList })));
export const SalesReport = lazyView("SalesReport", () => import('src/models/Reports/SalesReport').then(m => ({ default: m.SalesReport })));
export const MaterialStatement = lazyView("MaterialStatement", () => import('src/models/Reports/MaterialStatement').then(m => ({ default: m.MaterialStatement })));
export const CashReport = lazyView("CashReport", () => import('src/models/Reports/CashReport').then(m => ({ default: m.CashReport })));
export const ProductRegisterReport = lazyView("ProductRegisterReport", () => import('src/models/Reports/ProductRegisterReport').then(m => ({ default: m.ProductRegisterReport })));
export const AccountingJournal = lazyView("AccountingJournal", () => import('src/models/Reports/AccountingJournal').then(m => ({ default: m.AccountingJournal })));
export const TurnoverBalanceSheet = lazyView("TurnoverBalanceSheet", () => import('src/models/Reports/TurnoverBalanceSheet').then(m => ({ default: m.TurnoverBalanceSheet })));
export const AccountCard = lazyView("AccountCard", () => import('src/models/Reports/AccountCard').then(m => ({ default: m.AccountCard })));
export const ManagerReport = lazyView("ManagerReport", () => import('src/models/Reports/ManagerReport').then(m => ({ default: m.ManagerReport })));
export const SettlementsReport = lazyView("SettlementsReport", () => import('src/models/Reports/SettlementsReport').then(m => ({ default: m.SettlementsReport })));
export const InventoryTurnoverReport = lazyView("InventoryTurnoverReport", () => import('src/models/Reports/InventoryTurnoverReport').then(m => ({ default: m.InventoryTurnoverReport })));
export const InventoryBatchesReport = lazyView("InventoryBatchesReport", () => import('src/models/Reports/InventoryBatchesReport').then(m => ({ default: m.InventoryBatchesReport })));
export const ABCReport = lazyView("ABCReport", () => import('src/models/Reports/ABCReport').then(m => ({ default: m.ABCReport })));
export const PriceListReport = lazyView("PriceListReport", () => import('src/models/Reports/PriceListReport').then(m => ({ default: m.PriceListReport })));
export const SalesTerminal = lazyView("SalesTerminal", () => import('src/models/SalesTerminal').then(m => ({ default: m.SalesTerminal })));
export const ChartOfAccountsList = lazyView("ChartOfAccountsList", () => import('src/models/ChartOfAccounts').then(m => ({ default: m.ChartOfAccountsList })));
export const SubkontoTypesList = lazyView("SubkontoTypesList", () => import('src/models/SubkontoTypes').then(m => ({ default: m.SubkontoTypesList })));
export const UnsavedFormsList = lazyView("UnsavedFormsList", () => import('src/models/UnsavedForms').then(m => ({ default: m.UnsavedFormsList })));
export const SyncDashboard = lazyView("SyncDashboard", () => import('src/models/SyncDashboard').then(m => ({ default: m.SyncDashboard })));
export const SearchReplaceRefsForm = lazyView("SearchReplaceRefsForm", () => import('src/models/SearchReplaceRefs').then(m => ({ default: m.SearchReplaceRefsForm })));
export const OpeningBalanceForm = lazyView("OpeningBalanceForm", () => import('src/models/OpeningBalance').then(m => ({ default: m.OpeningBalanceForm })));
export const OrphanRefsForm = lazyView("OrphanRefsForm", () => import('src/models/OrphanRefs').then(m => ({ default: m.OrphanRefsForm })));

/** Имя → компонент. Восстановление панели после перезагрузки идёт по этой карте. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const VIEWS: Record<string, React.FC<any>> = {
	ContractsList: ContractsList,
	ActivityHistoriesList: ActivityHistoriesList,
	PipeActivitiesList: PipeActivitiesList,
	OrganizationsList: OrganizationsList,
	BankAccountsList: BankAccountsList,
	CounterpartiesList: CounterpartiesList,
	ContactsList: ContactsList,
	ContactPersonsList: ContactPersonsList,
	UsersList: UsersList,
	TodosList: TodosList,
	NotificationsList: NotificationsList,
	WarehousesList: WarehousesList,
	CashboxesList: CashboxesList,
	PriceTypesList: PriceTypesList,
	SalesList: SalesList,
	ProductPriceCorrection: ProductPriceCorrection,
	ProductPriceImport: ProductPriceImport,
	ProductImportExport: ProductImportExport,
	SaleReturnsList: SaleReturnsList,
	PurchasesList: PurchasesList,
	PurchaseReturnsList: PurchaseReturnsList,
	PurchaseRequisitionsList: PurchaseRequisitionsList,
	OutgoingInvoicesList: OutgoingInvoicesList,
	EdoInboxList: EdoInboxList,
	EdoOutboxList: EdoOutboxList,
	ClassifiersList: ClassifiersList,
	EsfIncomingList: EsfIncomingList,
	AwpOutboxList: AwpOutboxList,
	SntOutboxList: SntOutboxList,
	AwpIncomingList: AwpIncomingList,
	SntIncomingList: SntIncomingList,
	IncomingInvoicesList: IncomingInvoicesList,
	PaymentInvoicesList: PaymentInvoicesList,
	ScheduledTasksList: ScheduledTasksList,
	InventoryTransfersList: InventoryTransfersList,
	ImportDeclarationsList: ImportDeclarationsList,
	WriteOffsList: WriteOffsList,
	SerialNumbersList: SerialNumbersList,
	GoodsReceiptsList: GoodsReceiptsList,
	StockCountsList: StockCountsList,
	CommercialOffersList: CommercialOffersList,
	SalesOrdersList: SalesOrdersList,
	ReservationsList: ReservationsList,
	PurchaseOrdersList: PurchaseOrdersList,
	BankStatementsList: BankStatementsList,
	MonthClosesList: MonthClosesList,
	FiscalReceiptsList: FiscalReceiptsList,
	CashReceiptOrdersList: CashReceiptOrdersList,
	CashExpenseOrdersList: CashExpenseOrdersList,
	BrandsList: BrandsList,
	ProductsList: ProductsList,
	UnitOfMeasuresList: UnitOfMeasuresList,
	TaxesList: TaxesList,
	OrganizationAccountingSettingsList: OrganizationAccountingSettingsList,
	GeneralSettings: GeneralSettings,
	DocumentNumberSettings: DocumentNumberSettings,
	FilesList: FilesList,
	CurrenciesList: CurrenciesList,
	EmployeesList: EmployeesList,
	PositionsList: PositionsList,
	PayrollCalculationsList: PayrollCalculationsList,
	PayrollPaymentsList: PayrollPaymentsList,
	SalesReport: SalesReport,
	MaterialStatement: MaterialStatement,
	CashReport: CashReport,
	ProductRegisterReport: ProductRegisterReport,
	AccountingJournal: AccountingJournal,
	TurnoverBalanceSheet: TurnoverBalanceSheet,
	AccountCard: AccountCard,
	ManagerReport: ManagerReport,
	SettlementsReport: SettlementsReport,
	InventoryTurnoverReport: InventoryTurnoverReport,
	InventoryBatchesReport: InventoryBatchesReport,
	ABCReport: ABCReport,
	PriceListReport: PriceListReport,
	SalesTerminal: SalesTerminal,
	ChartOfAccountsList: ChartOfAccountsList,
	SubkontoTypesList: SubkontoTypesList,
	UnsavedFormsList: UnsavedFormsList,
	SyncDashboard: SyncDashboard,
	SearchReplaceRefsForm: SearchReplaceRefsForm,
	OpeningBalanceForm: OpeningBalanceForm,
	OrphanRefsForm: OrphanRefsForm,
};

export default VIEWS;
