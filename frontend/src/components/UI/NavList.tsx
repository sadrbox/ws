// NavList — навигационное меню (таксономия разделов). Вынесено из UI/index.tsx (Q9).
// Структурный тест: __tests__/navListStructure.test.ts читает ЭТОТ файл.
import { FC, PropsWithChildren } from "react";
import styles from "../../styles/main.module.scss";
import { translate } from "src/i18";
import { useAppContext } from "src/app/context";
import { useChatUnread } from "src/hooks/useChatUnread";

import { getAccessLevel } from 'src/hooks/useAccessPermission';
import { useDisabledModules } from "src/hooks/useDisabledModules";
import {
  ContractsList,
  ActivityHistoriesList,
  PipeActivitiesList,
  PipeActivitiesDashboard,
  OrganizationsList,
  BankAccountsList,
  CounterpartiesList,
  ContactsList,
  ContactPersonsList,
  UsersList,
  TodosList,
  TaskBoardList,
  UserPerformanceList,
  TodoStatusesList,
  ChatList,
  AiAssistantList,
  NotificationsList,
  WarehousesList,
  CashboxesList,
  PriceTypesList,
  SalesList,
  ProductPriceCorrection,
  ProductPriceImport,
  ProductImportExport,
  SaleReturnsList,
  PurchasesList,
  PurchaseReturnsList,
  PurchaseRequisitionsList,
  OutgoingInvoicesList,
  EdoInboxList,
  EdoOutboxList,
  ClassifiersList,
  EsfLicensesList,
  EsfIncomingList,
  AwpOutboxList,
  SntOutboxList,
  AwpIncomingList,
  SntIncomingList,
  IncomingInvoicesList,
  PaymentInvoicesList,
  ScheduledTasksList,
  InventoryTransfersList,
  ImportDeclarationsList,
  WriteOffsList,
  SerialNumbersList,
  GoodsReceiptsList,
  StockCountsList,
  CommercialOffersList,
  SalesOrdersList,
  ReservationsList,
  PurchaseOrdersList,
  BankStatementsList,
  MonthClosesList,
  FiscalReceiptsList,
  CashReceiptOrdersList,
  CashExpenseOrdersList,
  BrandsList,
  ProductsList,
  FixedAssetsList,
  FixedAssetAcceptancesList,
  UnitOfMeasuresList,
  TaxesList,
  OrganizationAccountingSettingsList,
  GeneralSettings,
  DocumentNumberSettings,
  FilesList,
  CurrenciesList,
  EmployeesList,
  PositionsList,
  PayrollCalculationsList,
  PayrollPaymentsList,
  SalesReport,
  MaterialStatement,
  CashReport,
  ProductRegisterReport,
  AccountingJournal,
  TurnoverBalanceSheet,
  AccountCard,
  ManagerReport,
  SettlementsReport,
  InventoryTurnoverReport,
  InventoryBatchesReport,
  ABCReport,
  XYZReport,
  ModuleSettings,
  DealsList,
  DealsKanban,
  PriceListReport,
  SalesTerminal,
  ChartOfAccountsList,
  SubkontoTypesList,
  UnsavedFormsList,
  SyncDashboard,
  SearchReplaceRefsForm,
  OpeningBalanceForm,
  OrphanRefsForm,
} from "src/registry/viewRegistry";

type TypeNavListProps = {
  label: string;
}

/**
 * Пункт меню, доступный с КЛАВИАТУРЫ.
 *
 * Раньше пункты были обычными li с onClick — кликабельны только мышью: ни Tab-навигации,
 * ни Enter/Space, ни объявления скринридером. Здесь li получает role="button",
 * tabIndex и обработку Enter/Space.
 *
 * Почему role на самом <li>, а не вложенная <button>: вся вёрстка меню (отступы,
 * ховер, акцент) завязана на селекторы `li` — вложенная кнопка потребовала бы
 * переписать стили всех 80+ пунктов. Роль на li даёт доступность без риска для вёрстки.
 */
const NavItem: FC<PropsWithChildren<{ onClick: () => void; className?: string; title?: string }>> = ({
  onClick, className, title, children,
}) => (
  <li
    className={className}
    title={title}
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); // Space иначе прокручивает страницу
        onClick();
      }
    }}
  >
    {children}
  </li>
);
NavItem.displayName = "NavItem";

// ─────────────────────────────────────────────────────────────────────────────
// NavList — меню раздела.
//
// Единый порядок групп во ВСЕХ разделах, по ТИПУ данных:
//   Документы → Отчёты → Справочники → Обработки → Регламентные операции
// (журналы обмена — гос-документы РК и ЭДО — отдельными группами: это не учётные
// объекты, а входящие/исходящие очереди интеграции).
//
// Раньше группы задавались бизнес-темой вперемешку с типом: «Справочники»
// повторялись в ЧЕТЫРЁХ разделах, «Отчёты» — в двух, а обработки («Корректировка
// цен», «Импорт/экспорт») лежали среди справочников. Найти пункт можно было перебором.
//
// Внутри «Документов» — порядок бизнес-цепочки: продажа → закупка → склад → деньги.
// ─────────────────────────────────────────────────────────────────────────────
export const NavList = ({ label }: TypeNavListProps) => {

  const context = useAppContext();
  const addPane = context.windows.addPane;
  const user = context.auth.user;
  const rights = user?.accessPermissions ?? user?.employee?.accessPermissions ?? [];
  const isSuperAdmin = user?.isSuperAdmin;

  /** Проверяет, имеет ли пользователь хотя бы readonly доступ к модели */
  const can = (modelName: string) => getAccessLevel(rights, modelName, isSuperAdmin).canRead;

  // Непрочитанные сообщения чата — бейдж в пункте меню (E4.1).
  const { total: chatUnread } = useChatUnread();

  // E11: модули, отключённые для организации пользователя, скрываются из меню.
  // По умолчанию (нет настроек) — набор пуст, всё видно как раньше.
  const disabledModules = useDisabledModules();
  const moduleOn = (key: string) => !disabledModules.has(key);

  const TradeGroups = () => (
    <>
      {moduleOn("sales") && <div className={styles.NavGroup}>
        <h3>{translate("sales")}</h3>
        <ul className={styles.NavList}>
          {can("Sale") && <NavItem onClick={() => addPane({ component: SalesList, label: translate("saleRealization") })}>{translate("saleRealization")}</NavItem>}
          {can("SaleReturn") && <NavItem onClick={() => addPane({ component: SaleReturnsList })}>{translate("SaleReturnsList")}</NavItem>}
          {can("OutgoingInvoice") && <NavItem onClick={() => addPane({ component: OutgoingInvoicesList, label: translate("outgoingInvoice") })}>{translate("outgoingInvoice")}</NavItem>}
          {can("PaymentInvoice") && <NavItem onClick={() => addPane({ component: PaymentInvoicesList, label: translate("paymentInvoice") })}>{translate("paymentInvoice")}</NavItem>}
          {can("CommercialOffer") && <NavItem onClick={() => addPane({ component: CommercialOffersList, label: translate("docType_commercial_offer") })}>{translate("docType_commercial_offer")}</NavItem>}
          {can("SalesOrder") && <NavItem onClick={() => addPane({ component: SalesOrdersList, label: translate("docType_sales_order") })}>{translate("docType_sales_order")}</NavItem>}
          {can("Reservation") && <NavItem onClick={() => addPane({ component: ReservationsList, label: translate("docType_reservation") })}>{translate("docType_reservation")}</NavItem>}
        </ul>
      </div>}
      {moduleOn("purchase") && <div className={styles.NavGroup}>
        <h3>{translate("purchase")}</h3>
        <ul className={styles.NavList}>
          {can("Purchase") && <NavItem onClick={() => addPane({ component: PurchasesList, label: translate("purchaseReceipt") })}>{translate("purchaseReceipt")}</NavItem>}
          {can("PurchaseReturn") && <NavItem onClick={() => addPane({ component: PurchaseReturnsList })}>{translate("PurchaseReturnsList")}</NavItem>}
          {can("IncomingInvoice") && <NavItem onClick={() => addPane({ component: IncomingInvoicesList, label: translate("incomingInvoice") })}>{translate("incomingInvoice")}</NavItem>}
          {can("PurchaseRequisition") && <NavItem onClick={() => addPane({ component: PurchaseRequisitionsList })}>{translate("PurchaseRequisitionsList")}</NavItem>}
          {can("PurchaseOrder") && <NavItem onClick={() => addPane({ component: PurchaseOrdersList, label: translate("docType_purchase_order") })}>{translate("docType_purchase_order")}</NavItem>}
          {can("ImportDeclaration") && <NavItem onClick={() => addPane({ component: ImportDeclarationsList })}>{translate("ImportDeclarationsList")}</NavItem>}
        </ul>
      </div>}
      {moduleOn("warehouse") && <div className={styles.NavGroup}>
        <h3>{translate("warehouse")}</h3>
        <ul className={styles.NavList}>
          {can("InventoryTransfer") && <NavItem onClick={() => addPane({ component: InventoryTransfersList })}>{translate("InventoryTransfersList")}</NavItem>}
          {can("WriteOff") && <NavItem onClick={() => addPane({ component: WriteOffsList })}>{translate("WriteOffsList")}</NavItem>}
          {can("GoodsReceipt") && <NavItem onClick={() => addPane({ component: GoodsReceiptsList })}>{translate("GoodsReceiptsList")}</NavItem>}
          {can("StockCount") && <NavItem onClick={() => addPane({ component: StockCountsList })}>{translate("StockCountsList")}</NavItem>}
        </ul>
      </div>}
      {moduleOn("cash") && <div className={styles.NavGroup}>
        <h3>{translate("cash")}</h3>
        <ul className={styles.NavList}>
          {can("CashReceiptOrder") && <NavItem onClick={() => addPane({ component: CashReceiptOrdersList })}>{translate("CashReceiptOrdersList")}</NavItem>}
          {can("CashExpenseOrder") && <NavItem onClick={() => addPane({ component: CashExpenseOrdersList })}>{translate("CashExpenseOrdersList")}</NavItem>}
          {can("BankStatement") && <NavItem onClick={() => addPane({ component: BankStatementsList, label: translate("docType_bank_statement") })}>{translate("docType_bank_statement")}</NavItem>}
          {can("FiscalReceipt") && <NavItem onClick={() => addPane({ component: FiscalReceiptsList })}>{translate("FiscalReceiptsList")}</NavItem>}
        </ul>
      </div>}
      <div className={styles.NavGroup}>
        <h3>{translate("reports")}</h3>
        <ul className={styles.NavList}>
          {can("Sale") && <NavItem onClick={() => addPane({ component: SalesReport, label: translate("SalesReportList") })}>{translate("SalesReportList")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: ManagerReport, label: translate("managerReport") })}>{translate("managerReport")}</NavItem>}
          {(can("Purchase") || can("Sale")) && <NavItem onClick={() => addPane({ component: MaterialStatement, label: translate("MaterialStatementList") })}>{translate("MaterialStatementList")}</NavItem>}
          {(can("Purchase") || can("Sale")) && <NavItem onClick={() => addPane({ component: ProductRegisterReport, label: translate("ProductRegisterList") })}>{translate("ProductRegisterList")}</NavItem>}
          {(can("ProductPrice") || can("Product")) && <NavItem onClick={() => addPane({ component: PriceListReport, label: translate("priceListReport") })}>{translate("priceListReport")}</NavItem>}
          {(can("Purchase") || can("Sale")) && <NavItem onClick={() => addPane({ component: InventoryTurnoverReport, label: translate("inventoryTurnover") })}>{translate("inventoryTurnover")}</NavItem>}
          {(can("Purchase") || can("Sale")) && <NavItem onClick={() => addPane({ component: InventoryBatchesReport, label: translate("inventoryBatches") })}>{translate("inventoryBatches")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: ABCReport, label: translate("abcAnalysis") })}>{translate("abcAnalysis")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: XYZReport, label: translate("xyzAnalysis") })}>{translate("xyzAnalysis")}</NavItem>}
          {(can("CashReceiptOrder") || can("CashExpenseOrder")) && <NavItem onClick={() => addPane({ component: CashReport, label: translate("CashReportList") })}>{translate("CashReportList")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("directories")}</h3>
        <ul className={styles.NavList}>
          {can("Product") && <NavItem onClick={() => addPane({ component: ProductsList })}>{translate("ProductsList")}</NavItem>}
          {can("Product") && <NavItem onClick={() => addPane({ component: FixedAssetsList, label: translate("FixedAssetsList") })}>{translate("FixedAssetsList")}</NavItem>}
          {can("Warehouse") && <NavItem onClick={() => addPane({ component: WarehousesList })}>{translate("WarehousesList")}</NavItem>}
          {(can("ProductPrice") || can("Product")) && <NavItem onClick={() => addPane({ component: PriceTypesList })}>{translate("PriceTypesList")}</NavItem>}
          {can("Brand") && <NavItem onClick={() => addPane({ component: BrandsList })}>{translate("BrandsList")}</NavItem>}
          {can("SerialNumber") && <NavItem onClick={() => addPane({ component: SerialNumbersList })}>{translate("SerialNumbersList")}</NavItem>}
          {can("Cashbox") && <NavItem onClick={() => addPane({ component: CashboxesList })}>{translate("CashboxesList")}</NavItem>}
          <NavItem onClick={() => addPane({ component: ClassifiersList, label: translate("clsSection") })}>{translate("clsSection")}</NavItem>
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("processings")}</h3>
        <ul className={styles.NavList}>
          {can("Sale") && <NavItem className={styles.NavListAccent} onClick={() => addPane({ component: SalesTerminal, label: translate("salesTerminal") })}>⚡ {translate("salesTerminal")}</NavItem>}
          {(can("ProductPrice") || can("Product")) && <NavItem onClick={() => addPane({ component: ProductPriceCorrection })}>{translate("ProductPriceCorrection")}</NavItem>}
          {(can("ProductPrice") || can("Product")) && <NavItem onClick={() => addPane({ component: ProductPriceImport })}>{translate("ProductPriceImport")}</NavItem>}
          {can("Product") && <NavItem onClick={() => addPane({ component: ProductImportExport })}>{translate("ProductImportExport")}</NavItem>}
          {can("Product") && <NavItem onClick={() => addPane({ component: OpeningBalanceForm, label: translate("openingBalanceEntry") })}>{translate("openingBalanceEntry")}</NavItem>}
        </ul>
      </div>
      {moduleOn("govdocs") && <div className={styles.NavGroup}>
        <h3>{translate("govDocsSection")}</h3>
        <ul className={styles.NavList}>
          {can("OutgoingInvoice") && <NavItem onClick={() => addPane({ component: EsfIncomingList, label: translate("esfIncomingSection") })}>{translate("esfIncomingSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: AwpOutboxList, label: translate("awpOutboxSection") })}>{translate("awpOutboxSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: AwpIncomingList, label: translate("awpIncomingSection") })}>{translate("awpIncomingSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: SntOutboxList, label: translate("sntOutboxSection") })}>{translate("sntOutboxSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: SntIncomingList, label: translate("sntIncomingSection") })}>{translate("sntIncomingSection")}</NavItem>}
          <li className={styles.NavHint}>{translate("govDocsHint")}</li>
        </ul>
      </div>}
      {moduleOn("edo") && <div className={styles.NavGroup}>
        <h3>{translate("edoSection")}</h3>
        <ul className={styles.NavList}>
          {can("EdoDocument") && <NavItem onClick={() => addPane({ component: EdoInboxList, label: translate("edoInbox") })}>{translate("edoInbox")}</NavItem>}
          {can("EdoDocument") && <NavItem onClick={() => addPane({ component: EdoOutboxList, label: translate("edoOutbox") })}>{translate("edoOutbox")}</NavItem>}
        </ul>
      </div>}
    </>
  );

  const AccountingGroups = () => (
    <>
      <div className={styles.NavGroup}>
        <h3>{translate("reports")}</h3>
        <ul className={styles.NavList}>
          {can("AccountingEntry") && <NavItem onClick={() => addPane({ component: AccountingJournal, label: translate("accountingJournalTitle") })}>{translate("accountingJournalTitle")}</NavItem>}
          {can("AccountingEntry") && <NavItem onClick={() => addPane({ component: TurnoverBalanceSheet, label: translate("osvTitle") })}>{translate("osvTitle")}</NavItem>}
          {can("AccountingEntry") && <NavItem onClick={() => addPane({ component: AccountCard, label: translate("accountCardTitle") })}>{translate("accountCardTitle")}</NavItem>}
          {can("AccountingEntry") && <NavItem onClick={() => addPane({ component: SettlementsReport, label: translate("settlementsReport") })}>{translate("settlementsReport")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("directories")}</h3>
        <ul className={styles.NavList}>
          {can("ChartOfAccount") && <NavItem onClick={() => addPane({ component: ChartOfAccountsList, label: translate("chartOfAccountsTitle") })}>{translate("chartOfAccountsTitle")}</NavItem>}
          {can("SubkontoType") && <NavItem onClick={() => addPane({ component: SubkontoTypesList, label: translate("subkontoTypesTitle") })}>{translate("subkontoTypesTitle")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("monthCloseRegulatory")}</h3>
        <ul className={styles.NavList}>
          {can("Product") && <NavItem onClick={() => addPane({ component: FixedAssetAcceptancesList })}>{translate("FixedAssetAcceptancesList")}</NavItem>}
          {can("MonthClose") && <NavItem onClick={() => addPane({ component: MonthClosesList })}>{translate("MonthClosesList")}</NavItem>}
        </ul>
      </div>
    </>
  );

  const HRGroups = () => (
    <>
      <div className={styles.NavGroup}>
        <h3>{translate("documents")}</h3>
        <ul className={styles.NavList}>
          {can("PayrollCalculation") && <NavItem onClick={() => addPane({ component: PayrollCalculationsList })}>{translate("PayrollCalculationsList")}</NavItem>}
          {can("PayrollPayment") && <NavItem onClick={() => addPane({ component: PayrollPaymentsList })}>{translate("PayrollPaymentsList")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("directories")}</h3>
        <ul className={styles.NavList}>
          {can("Employee") && <NavItem onClick={() => addPane({ component: EmployeesList })}>{translate("EmployeesList")}</NavItem>}
          {can("Position") && <NavItem onClick={() => addPane({ component: PositionsList })}>{translate("PositionsList")}</NavItem>}
        </ul>
      </div>
    </>
  );

  const CRMGroups = () => (
    <>
      {can("Deal") && <div className={styles.NavGroup}>
        <h3>{translate("dealsSection")}</h3>
        <ul className={styles.NavList}>
          <NavItem onClick={() => addPane({ component: DealsKanban, label: translate("dealsKanban") })}>{translate("dealsKanban")}</NavItem>
          <NavItem onClick={() => addPane({ component: DealsList, label: translate("dealsTitle") })}>{translate("dealsTitle")}</NavItem>
        </ul>
      </div>}
      <div className={styles.NavGroup}>
        <h3>{translate("directories")}</h3>
        <ul className={styles.NavList}>
          {can("Counterparty") && <NavItem onClick={() => addPane({ component: CounterpartiesList })}>{translate("CounterpartiesList")}</NavItem>}
          {can("Contract") && <NavItem onClick={() => addPane({ component: ContractsList })}>{translate("ContractsList")}</NavItem>}
          {can("Contact") && <NavItem onClick={() => addPane({ component: ContactsList })}>{translate("ContactsList")}</NavItem>}
          {can("ContactPerson") && <NavItem onClick={() => addPane({ component: ContactPersonsList })}>{translate("ContactPersonsList")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("taskManagement")}</h3>
        <ul className={styles.NavList}>
          {can("Todo") && <NavItem onClick={() => addPane({ component: TaskBoardList, label: translate("TaskBoard") })}>{translate("TaskBoard")}</NavItem>}
          {can("Todo") && <NavItem onClick={() => addPane({ component: TodosList })}>{translate("TodosList")}</NavItem>}
          {can("Todo") && <NavItem onClick={() => addPane({ component: UserPerformanceList, label: translate("UserPerformance") })}>{translate("UserPerformance")}</NavItem>}
          {can("Todo") && <NavItem onClick={() => addPane({ component: TodoStatusesList, label: translate("TodoStatusesList") })}>{translate("TodoStatusesList")}</NavItem>}
          <NavItem onClick={() => addPane({ component: ChatList, label: translate("Chat") })}>
            {translate("Chat")}
            {/* Бейдж непрочитанного (E4.1): чужие сообщения позже отметки прочтения. */}
            {chatUnread > 0 && <span className={styles.NavBadge}>{chatUnread > 99 ? "99+" : chatUnread}</span>}
          </NavItem>
          {/* AI-помощник: команды 1С на естественном языке (сервис ai/, см. models/AiAssistant). */}
          <NavItem onClick={() => addPane({ component: AiAssistantList, label: translate("AiAssistant") })}>{translate("AiAssistant")}</NavItem>
        </ul>
      </div>
    </>
  );

  const SettingsGroups = () => (
    <>
      <div className={styles.NavGroup}>
        <h3>{translate("directories")}</h3>
        <ul className={styles.NavList}>
          {can("Organization") && <NavItem onClick={() => addPane({ component: OrganizationsList })}>{translate("OrganizationsList")}</NavItem>}
          {can("BankAccount") && <NavItem onClick={() => addPane({ component: BankAccountsList })}>{translate("BankAccountsList")}</NavItem>}
          {can("Currency") && <NavItem onClick={() => addPane({ component: CurrenciesList })}>{translate("CurrenciesList")}</NavItem>}
          {can("UnitOfMeasure") && <NavItem onClick={() => addPane({ component: UnitOfMeasuresList })}>{translate("UnitOfMeasuresList")}</NavItem>}
          {can("Tax") && <NavItem onClick={() => addPane({ component: TaxesList })}>{translate("TaxesList")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("settingsGroup")}</h3>
        <ul className={styles.NavList}>
          {can("OrganizationAccountingSetting") && <NavItem onClick={() => addPane({ component: OrganizationAccountingSettingsList })}>{translate("OrganizationAccountingSettingsList")}</NavItem>}
          {can("AccessRights") && <NavItem onClick={async () => { const m = await import("src/models/AccessRights"); addPane({ component: m.AccessRightsModuleList, label: translate("AccessRights") }); }}>{translate("AccessRights")}</NavItem>}
          <NavItem onClick={() => addPane({ component: GeneralSettings, label: translate("generalSettings") })}>{translate("generalSettings")}</NavItem>
          <NavItem onClick={() => addPane({ component: DocumentNumberSettings, label: translate("documentNumberSettings") })}>{translate("documentNumberSettings")}</NavItem>
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("administration")}</h3>
        <ul className={styles.NavList}>
          {can("User") && <NavItem onClick={() => addPane({ component: UsersList })}>{translate("UsersList")}</NavItem>}
          {can("ActivityHistory") && <NavItem onClick={() => addPane({ component: ActivityHistoriesList })}>{translate("ActivityHistoriesList")}</NavItem>}
          {can("ActivityHistory") && <NavItem onClick={() => addPane({ component: PipeActivitiesList })}>{translate("PipeActivitiesList")}</NavItem>}
          {can("ActivityHistory") && <NavItem onClick={() => addPane({ component: PipeActivitiesDashboard, label: translate("PipeActivitiesDashboard") })}>{translate("PipeActivitiesDashboard")}</NavItem>}
          {can("Notification") && <NavItem onClick={() => addPane({ component: NotificationsList, label: translate("notificationsCenter") })}>{translate("notificationsCenter")}</NavItem>}
          <NavItem onClick={() => addPane({ component: FilesList, label: translate("files") })}>{translate("files")}</NavItem>
          <NavItem onClick={() => addPane({ component: UnsavedFormsList, label: translate("unsavedRecords") })}>{translate("unsavedRecords")}</NavItem>
          {can("ScheduledTask") && <NavItem onClick={() => addPane({ component: ScheduledTasksList })}>{translate("ScheduledTasksList")}</NavItem>}
          <NavItem onClick={() => addPane({ component: SyncDashboard, label: translate("syncOfflineData") })}>{translate("syncOfflineData")}</NavItem>
          <NavItem onClick={() => addPane({ component: OrphanRefsForm, label: translate("deletedReferenceControl") })}>{translate("deletedReferenceControl")}</NavItem>
          <NavItem onClick={() => addPane({ component: SearchReplaceRefsForm, label: translate("searchReplaceReferences") })}>{translate("searchReplaceReferences")}</NavItem>
          {isSuperAdmin && <NavItem onClick={() => addPane({ component: EsfLicensesList, label: translate("EsfLicensesList") })}>{translate("EsfLicensesList")}</NavItem>}
          {isSuperAdmin && <NavItem onClick={() => addPane({ component: ModuleSettings, label: translate("moduleSettingsTitle") })}>{translate("moduleSettingsTitle")}</NavItem>}
        </ul>
      </div>
    </>
  );

  // «Все разделы» — полное меню одним списком: если пользователь не помнит, в каком
  // разделе учёта лежит пункт, ему не нужно обходить остальные вкладки. Группы здесь
  // ПЕРЕИСПОЛЬЗУЮТСЯ, поэтому это меню не может разойтись с разделами: новый пункт
  // добавляется в одном месте и появляется в обоих.
  if (label.toLocaleLowerCase() === "All".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("allSections")}</h1>
        <div className={styles.NavSection}>
          <TradeGroups />
          <AccountingGroups />
          {moduleOn("hr") && <HRGroups />}
          <CRMGroups />
          <SettingsGroups />
        </div>
      </div>
    );
  }

  if (label.toLocaleLowerCase() === "Trade".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("trade")}</h1>
        <div className={styles.NavSection}>
          <TradeGroups />
        </div>
      </div>
    );
  }

  if (label.toLocaleLowerCase() === "Accounting".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("accounting2")}</h1>
        <div className={styles.NavSection}>
          <AccountingGroups />
        </div>
      </div>
    );
  }

  if (label.toLocaleLowerCase() === "HR".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("hr")}</h1>
        <div className={styles.NavSection}>
          {moduleOn("hr") && <HRGroups />}
        </div>
      </div>
    );
  }

  if (label.toLocaleLowerCase() === "CRM".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("crm")}</h1>
        <div className={styles.NavSection}>
          <CRMGroups />
        </div>
      </div>
    );
  }

  if (label.toLocaleLowerCase() === "Settings".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("settings")}</h1>
        <div className={styles.NavSection}>
          <SettingsGroups />
        </div>
      </div>
    );
  }
  return null;
};
