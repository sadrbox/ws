import React, { CSSProperties, FC, PropsWithChildren, useEffect, useLayoutEffect, useState, useCallback, useMemo, forwardRef, useRef, useImperativeHandle, ReactNode, Component, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import modalManager from 'src/components/Modal/modalManager';
import { createPortal } from 'react-dom';
// Divider is imported in components that use it; not used here
import { translate, getLanguage, setLanguage } from 'src/i18';
import { useAppContext } from 'src/app/context';
import { ReloadButton, ClearButton, IconButton } from 'src/components/Toolbar';
import { copyPaneLink } from 'src/utils/paneLink';
import type { TPane } from 'src/app/types';
import { usePaneToolbarSlot, useHasToolbar, usePaneHeaderActionsSlot } from 'src/hooks/usePaneToolbar';
import { ToolbarSlot } from 'src/components/Toolbar';
import { useAllPaneNotifications, dismissPaneNotification, usePaneIsDirty, usePaneIsEditMode } from 'src/hooks/useFormStore';
import { openFormByRef, canOpenByRef } from 'src/utils/openFormByRef';
import OrgSwitcher from 'src/components/OrgSwitcher';

// ── Ленивая загрузка моделей (code-split) ─────────────────────────────────────
// Статические импорты моделей убраны: иначе они все попадали в основной бандл и
// динамические import() в registry/openFormByRef/openReport не давали code-split
// (Vite: "dynamic import will not move module into another chunk"). displayName
// ОБЯЗАТЕЛЕН — по нему дедуплицируются панели (getComponentName в app/index.tsx).
// Рендерятся внутри <React.Suspense> (см. app/index.tsx).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyView(name: string, loader: () => Promise<{ default: React.ComponentType<any> }>): React.FC<any> {
  const C = React.lazy(loader) as unknown as React.FC<any> & { displayName?: string };
  C.displayName = name;
  return C;
}
const ContractsList = lazyView("ContractsList", () => import('src/models/Contracts').then(m => ({ default: m.ContractsList })));
const ActivityHistoriesList = lazyView("ActivityHistoriesList", () => import('src/models/ActivityHistories').then(m => ({ default: m.ActivityHistoriesList })));
const OrganizationsList = lazyView("OrganizationsList", () => import('src/models/Organizations').then(m => ({ default: m.OrganizationsList })));
const BankAccountsList = lazyView("BankAccountsList", () => import('src/models/BankAccounts').then(m => ({ default: m.BankAccountsList })));
const CounterpartiesList = lazyView("CounterpartiesList", () => import('src/models/Counterparties').then(m => ({ default: m.CounterpartiesList })));
const ContactsList = lazyView("ContactsList", () => import('src/models/Contacts').then(m => ({ default: m.ContactsList })));
const ContactPersonsList = lazyView("ContactPersonsList", () => import('src/models/ContactPersons').then(m => ({ default: m.ContactPersonsList })));
const UsersList = lazyView("UsersList", () => import('src/models/Users').then(m => ({ default: m.UsersList })));
const TodosList = lazyView("TodosList", () => import('src/models/Todos').then(m => ({ default: m.TodosList })));
const NotificationsList = lazyView("NotificationsList", () => import('src/models/Notifications').then(m => ({ default: m.NotificationsList })));
const WarehousesList = lazyView("WarehousesList", () => import('src/models/Warehouses').then(m => ({ default: m.WarehousesList })));
const CashboxesList = lazyView("CashboxesList", () => import('src/models/Cashboxes').then(m => ({ default: m.CashboxesList })));
const PriceTypesList = lazyView("PriceTypesList", () => import('src/models/PriceTypes').then(m => ({ default: m.PriceTypesList })));
const SalesList = lazyView("SalesList", () => import('src/models/Sales').then(m => ({ default: m.SalesList })));
const ProductPriceCorrection = lazyView("ProductPriceCorrection", () => import('src/models/ProductPriceProcessing').then(m => ({ default: m.ProductPriceCorrection })));
const ProductPriceImport = lazyView("ProductPriceImport", () => import('src/models/ProductPriceProcessing').then(m => ({ default: m.ProductPriceImport })));
const ProductImportExport = lazyView("ProductImportExport", () => import('src/models/ProductImportExport').then(m => ({ default: m.ProductImportExport })));
const SaleReturnsList = lazyView("SaleReturnsList", () => import('src/models/SaleReturns').then(m => ({ default: m.SaleReturnsList })));
const PurchasesList = lazyView("PurchasesList", () => import('src/models/Purchases').then(m => ({ default: m.PurchasesList })));
const PurchaseReturnsList = lazyView("PurchaseReturnsList", () => import('src/models/PurchaseReturns').then(m => ({ default: m.PurchaseReturnsList })));
const PurchaseRequisitionsList = lazyView("PurchaseRequisitionsList", () => import('src/models/PurchaseRequisitions').then(m => ({ default: m.PurchaseRequisitionsList })));
const OutgoingInvoicesList = lazyView("OutgoingInvoicesList", () => import('src/models/OutgoingInvoices').then(m => ({ default: m.OutgoingInvoicesList })));
const EdoInboxList = lazyView("EdoInboxList", () => import('src/models/Edo').then(m => ({ default: m.EdoInboxList })));
const EdoOutboxList = lazyView("EdoOutboxList", () => import('src/models/Edo').then(m => ({ default: m.EdoOutboxList })));
const ClassifiersList = lazyView("ClassifiersList", () => import('src/models/Classifiers').then(m => ({ default: m.ClassifiersList })));
const EsfIncomingList = lazyView("EsfIncomingList", () => import('src/models/EsfIncoming').then(m => ({ default: m.EsfIncomingList })));
const IncomingInvoicesList = lazyView("IncomingInvoicesList", () => import('src/models/IncomingInvoices').then(m => ({ default: m.IncomingInvoicesList })));
const PaymentInvoicesList = lazyView("PaymentInvoicesList", () => import('src/models/PaymentInvoices').then(m => ({ default: m.PaymentInvoicesList })));
const ScheduledTasksList = lazyView("ScheduledTasksList", () => import('src/models/ScheduledTasks').then(m => ({ default: m.ScheduledTasksList })));
const InventoryTransfersList = lazyView("InventoryTransfersList", () => import('src/models/InventoryTransfers').then(m => ({ default: m.InventoryTransfersList })));
const CommercialOffersList = lazyView("CommercialOffersList", () => import('src/models/CommercialOffers').then(m => ({ default: m.CommercialOffersList })));
const SalesOrdersList = lazyView("SalesOrdersList", () => import('src/models/SalesOrders').then(m => ({ default: m.SalesOrdersList })));
const ReservationsList = lazyView("ReservationsList", () => import('src/models/Reservations').then(m => ({ default: m.ReservationsList })));
const PurchaseOrdersList = lazyView("PurchaseOrdersList", () => import('src/models/PurchaseOrders').then(m => ({ default: m.PurchaseOrdersList })));
const BankStatementsList = lazyView("BankStatementsList", () => import('src/models/BankStatements').then(m => ({ default: m.BankStatementsList })));
const MonthClosesList = lazyView("MonthClosesList", () => import('src/models/MonthCloses').then(m => ({ default: m.MonthClosesList })));
const FiscalReceiptsList = lazyView("FiscalReceiptsList", () => import('src/models/FiscalReceipts').then(m => ({ default: m.FiscalReceiptsList })));
const CashReceiptOrdersList = lazyView("CashReceiptOrdersList", () => import('src/models/CashReceiptOrders').then(m => ({ default: m.CashReceiptOrdersList })));
const CashExpenseOrdersList = lazyView("CashExpenseOrdersList", () => import('src/models/CashExpenseOrders').then(m => ({ default: m.CashExpenseOrdersList })));
const BrandsList = lazyView("BrandsList", () => import('src/models/Brands').then(m => ({ default: m.BrandsList })));
const ProductsList = lazyView("ProductsList", () => import('src/models/Products').then(m => ({ default: m.ProductsList })));
const UnitOfMeasuresList = lazyView("UnitOfMeasuresList", () => import('src/models/UnitOfMeasures').then(m => ({ default: m.UnitOfMeasuresList })));
const TaxesList = lazyView("TaxesList", () => import('src/models/Taxes').then(m => ({ default: m.TaxesList })));
const OrganizationAccountingSettingsList = lazyView("OrganizationAccountingSettingsList", () => import('src/models/OrganizationAccountingSettings').then(m => ({ default: m.OrganizationAccountingSettingsList })));
const GeneralSettings = lazyView("GeneralSettings", () => import('src/models/GeneralSettings').then(m => ({ default: m.default })));
const DocumentNumberSettings = lazyView("DocumentNumberSettings", () => import('src/models/DocumentNumberSettings').then(m => ({ default: m.default })));
const FilesList = lazyView("FilesList", () => import('src/models/Files').then(m => ({ default: m.FilesList })));
const CurrenciesList = lazyView("CurrenciesList", () => import('src/models/Currencies').then(m => ({ default: m.CurrenciesList })));
const EmployeesList = lazyView("EmployeesList", () => import('src/models/Employees').then(m => ({ default: m.EmployeesList })));
const PositionsList = lazyView("PositionsList", () => import('src/models/Positions').then(m => ({ default: m.PositionsList })));
const PayrollCalculationsList = lazyView("PayrollCalculationsList", () => import('src/models/PayrollCalculations').then(m => ({ default: m.PayrollCalculationsList })));
const PayrollPaymentsList = lazyView("PayrollPaymentsList", () => import('src/models/PayrollPayments').then(m => ({ default: m.PayrollPaymentsList })));
const SalesReport = lazyView("SalesReport", () => import('src/models/Reports/SalesReport').then(m => ({ default: m.SalesReport })));
const MaterialStatement = lazyView("MaterialStatement", () => import('src/models/Reports/MaterialStatement').then(m => ({ default: m.MaterialStatement })));
const CashReport = lazyView("CashReport", () => import('src/models/Reports/CashReport').then(m => ({ default: m.CashReport })));
const ProductRegisterReport = lazyView("ProductRegisterReport", () => import('src/models/Reports/ProductRegisterReport').then(m => ({ default: m.ProductRegisterReport })));
const AccountingJournal = lazyView("AccountingJournal", () => import('src/models/Reports/AccountingJournal').then(m => ({ default: m.AccountingJournal })));
const TurnoverBalanceSheet = lazyView("TurnoverBalanceSheet", () => import('src/models/Reports/TurnoverBalanceSheet').then(m => ({ default: m.TurnoverBalanceSheet })));
const AccountCard = lazyView("AccountCard", () => import('src/models/Reports/AccountCard').then(m => ({ default: m.AccountCard })));
const ManagerReport = lazyView("ManagerReport", () => import('src/models/Reports/ManagerReport').then(m => ({ default: m.ManagerReport })));
const SettlementsReport = lazyView("SettlementsReport", () => import('src/models/Reports/SettlementsReport').then(m => ({ default: m.SettlementsReport })));
const InventoryTurnoverReport = lazyView("InventoryTurnoverReport", () => import('src/models/Reports/InventoryTurnoverReport').then(m => ({ default: m.InventoryTurnoverReport })));
const InventoryBatchesReport = lazyView("InventoryBatchesReport", () => import('src/models/Reports/InventoryBatchesReport').then(m => ({ default: m.InventoryBatchesReport })));
const ABCReport = lazyView("ABCReport", () => import('src/models/Reports/ABCReport').then(m => ({ default: m.ABCReport })));
const PriceListReport = lazyView("PriceListReport", () => import('src/models/Reports/PriceListReport').then(m => ({ default: m.PriceListReport })));
const SalesTerminal = lazyView("SalesTerminal", () => import('src/models/SalesTerminal').then(m => ({ default: m.SalesTerminal })));
const ChartOfAccountsList = lazyView("ChartOfAccountsList", () => import('src/models/ChartOfAccounts').then(m => ({ default: m.ChartOfAccountsList })));
const SubkontoTypesList = lazyView("SubkontoTypesList", () => import('src/models/SubkontoTypes').then(m => ({ default: m.SubkontoTypesList })));
const UnsavedFormsList = lazyView("UnsavedFormsList", () => import('src/models/UnsavedForms').then(m => ({ default: m.UnsavedFormsList })));
const SyncDashboard = lazyView("SyncDashboard", () => import('src/models/SyncDashboard').then(m => ({ default: m.SyncDashboard })));
const SearchReplaceRefsForm = lazyView("SearchReplaceRefsForm", () => import('src/models/SearchReplaceRefs').then(m => ({ default: m.SearchReplaceRefsForm })));
const OrphanRefsForm = lazyView("OrphanRefsForm", () => import('src/models/OrphanRefs').then(m => ({ default: m.OrphanRefsForm })));
// UserSettingsModuleList/UserAccessRightsList загружаются динамически (разрыв цикла UI→models→app→UI)
import NotificationToast from 'src/components/NotificationToast';
import OfflineIndicator from 'src/components/OfflineIndicator';
import UIToast from 'src/components/UIToast';
import { getAccessLevel } from 'src/hooks/useUserAccessRight';
import { usePersistenceMode } from 'src/services/persistenceMode';

type TypeGroupProps = {
  align?: 'row' | 'col';
  type?: 'easy' | 'medium' | 'hard';
  label?: string;
  gap?: string;
  /** Доп. CSS-класс (для семантических утилит вместо inline-стилей). */
  className?: string;
  style?: CSSProperties;
} & PropsWithChildren;

export const Group: FC<TypeGroupProps> = ({ style, className, children }) =>
  <div style={style} className={[styles.Group, styles.gap6, className].filter(Boolean).join(" ")}>{children}</div>;

export const GroupRow: FC<TypeGroupProps> = ({ style, className, children }) =>
  <div style={style} className={[styles.GroupRow, styles.gap6, className].filter(Boolean).join(" ")}>{children}</div>;

export const GroupCol: FC<TypeGroupProps> = ({ style, className, children }) =>
  <div style={style} className={[styles.GroupCol, styles.gap6, className].filter(Boolean).join(" ")}>{children}</div>;




export const HorizontalLine = () => {
  return (
    <div style={{
      display: 'flex'
      ,
      alignItems: 'center'
      ,
      justifyContent: 'center'
      ,
      margin: '6px 0'
    }}>
      <span className={styles.HorizontalLine}></span>
    </div>
  )
}

export const Container: FC = () => {
  const context = useAppContext();
  const isPaneShow = context.windows.panes.length > 0;

  return (
    <>
      {isPaneShow && <><Panes /><PanesTabs /></>}
    </>
  );
}

/** Одна вкладка — отдельный компонент */
const PaneTabItem: FC<{
  pane: { uniqId: string; label: string; isSelector?: boolean; selectorPaneId?: string };
  isActive: boolean;
  isLocked: boolean;
  onActivate: () => void;
  onClose: () => void;
}> = ({ pane, isActive, isLocked, onActivate, onClose }) => {
  return (
    <div
      className={[
        styles.PaneTabItem,
        isActive && styles.PaneTabItemActive,
        pane.isSelector && styles.PaneTabItemSelector,
        isLocked && styles.PaneTabItemDisabled,
      ].filter(Boolean).join(" ")}
      onClick={isLocked ? undefined : onActivate}
      title={pane.label}
      role="tab"
      tabIndex={isLocked ? -1 : 0}
      aria-disabled={isLocked}
    >
      {!isLocked && (
        <IconButton
          icon="close"
          size="sm"
          className={styles.PaneTabItemClose}
          aria-label={translate("close")}
          title={translate("close")}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        />
      )}
      <span className={styles.PaneTabItemLabel}>{pane.isSelector && "🔍 "}{pane.label}</span>


    </div>
  );
};

const NOOP = () => { /* no-op (для скрытого зеркала замера) */ };

/** Выпадающее меню «ещё» для не вмещающихся вкладок. */
const PaneTabsMore: FC<{
  panes: TPane[];
  activePane?: string | null;
  active: boolean;
  selectorPane?: TPane;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}> = ({ panes, activePane, active, selectorPane, onActivate, onClose }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        popRef.current && !popRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className={styles.PaneTabsMoreWrap}>
      <button
        ref={btnRef}
        type="button"
        className={[
          styles.PaneTabsMoreBtn,
          active && styles.PaneTabsMoreActive,
          open && styles.PaneTabsMoreBtnOpen,
        ].filter(Boolean).join(" ")}
        onClick={() => setOpen(v => !v)}
        title={translate("morePanes")}
        aria-label={translate("morePanes")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.PaneTabsMoreCount}>{panes.length}</span>
        <svg
          className={styles.PaneTabsMoreCaret}
          width="10" height="10" viewBox="0 0 16 16"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div ref={popRef} className={styles.PaneTabsMoreMenu} role="menu">
          {panes.map(p => {
            const isLocked = !!selectorPane && !p.isSelector && p.selectorPaneId !== selectorPane.uniqId;
            return (
              <div
                key={`more-${p.uniqId}`}
                className={[
                  styles.PaneTabsMoreItem,
                  p.uniqId === activePane && styles.PaneTabsMoreItemActive,
                  isLocked && styles.PaneTabItemDisabled,
                ].filter(Boolean).join(" ")}
                onClick={isLocked ? undefined : () => { onActivate(p.uniqId); setOpen(false); }}
                title={p.label}
                role="menuitem"
                tabIndex={isLocked ? -1 : 0}
              >
                <span className={styles.PaneTabsMoreItemLabel}>{p.isSelector && "🔍 "}{p.label}</span>
                {!isLocked && (
                  <IconButton
                    icon="close"
                    size="sm"
                    className={styles.PaneTabsMoreItemClose}
                    aria-label={translate("close")}
                    title={translate("close")}
                    onClick={(e) => { e.stopPropagation(); onClose(p.uniqId); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const PanesTabs: FC = () => {

  const context = useAppContext();
  const panes = context?.windows.panes;
  const { activePane, setActivePane, requestClose } = context.windows;

  // Определяем, есть ли активная selector-панель → блокировка остальных вкладок
  const selectorPane = panes.find((p) => p.isSelector);

  const containerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(panes.length);

  // Ключ для пересчёта при изменении состава/подписей вкладок.
  const panesKey = useMemo(
    () => panes.map(p => `${p.uniqId}:${p.label}:${p.isSelector ? 1 : 0}`).join("|"),
    [panes],
  );

  // Сколько вкладок влезает: меряем по скрытому зеркалу (все вкладки в натуральную
  // ширину), отнимая место под кнопку «ещё».
  const recompute = useCallback(() => {
    const c = containerRef.current;
    const m = mirrorRef.current;
    if (!c || !m) return;
    const tabEls = Array.from(m.children) as HTMLElement[];
    const cs = getComputedStyle(c);
    const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
    const avail = c.clientWidth - padX;
    // -1px на отрицательный margin (наложение вкладок).
    const widths = tabEls.map(el => el.offsetWidth - 1);
    const total = widths.reduce((s, w) => s + w, 0);
    if (total <= avail) { setVisibleCount(tabEls.length); return; }
    const RESERVE = 52; // место под кнопку «⋯ N»
    let used = 0, count = 0;
    for (const w of widths) {
      if (used + w <= avail - RESERVE) { used += w; count++; } else break;
    }
    setVisibleCount(Math.max(count, 1)); // хотя бы одна вкладка видима
  }, []);

  useLayoutEffect(() => { recompute(); }, [recompute, panesKey]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(c);
    return () => ro.disconnect();
  }, [recompute]);

  const vis = Math.min(visibleCount, panes.length);
  const visiblePanes = panes.slice(0, vis);
  const overflowPanes = panes.slice(vis);
  const activeInOverflow = overflowPanes.some(p => p.uniqId === activePane);

  return (
    <div className={styles.PanesTabs} ref={containerRef}>
      {/* Видимые вкладки в отдельном flex-контейнере: он растёт (flex:1) и
          КЛИППИТ собственное переполнение, поэтому при ресайзе лишние вкладки
          не «выпирают», а кнопка «ещё» прибита к правому краю и не прыгает. */}
      <div className={styles.PaneTabsList}>
        {visiblePanes.map(p => {
          const isLocked = !!selectorPane && !p.isSelector && p.selectorPaneId !== selectorPane.uniqId;
          return (
            <PaneTabItem
              key={`PaneTabItem-${p.uniqId}`}
              pane={p}
              isActive={p.uniqId === activePane}
              isLocked={isLocked}
              onActivate={() => setActivePane(p.uniqId)}
              onClose={() => requestClose(p.uniqId)}
            />
          );
        })}
      </div>

      {overflowPanes.length > 0 && (
        <PaneTabsMore
          panes={overflowPanes}
          activePane={activePane}
          active={activeInOverflow}
          selectorPane={selectorPane}
          onActivate={setActivePane}
          onClose={requestClose}
        />
      )}

      {/* Скрытое зеркало: все вкладки в натуральную ширину — только для замера.
          Обёрнуто в 0×0 overflow:hidden, чтобы не порождать скролл и позволить
          самому .PanesTabs быть overflow:visible (иначе обрезается дропдаун). */}
      <div className={styles.PaneTabsMeasureClip} aria-hidden>
        <div ref={mirrorRef} className={styles.PaneTabsMeasure}>
          {panes.map(p => {
            const isLocked = !!selectorPane && !p.isSelector && p.selectorPaneId !== selectorPane.uniqId;
            return (
              <PaneTabItem
                key={`measure-${p.uniqId}`}
                pane={p}
                isActive={false}
                isLocked={isLocked}
                onActivate={NOOP}
                onClose={NOOP}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const Panes: FC = () => {
  const context = useAppContext();
  const { panes, activePane, requestClose } = context.windows;

  return (
    <div className={styles.Panes}>
      {panes.map(p => <PaneItem key={`Panes-${p.uniqId}`} pane={p} isActive={p.uniqId === activePane} onClose={() => requestClose(p.uniqId)} />
      )}
    </div>
  )
}

/** Отдельный компонент панели — позволяет вызывать хуки */
const PaneItem: FC<{ pane: TPane; isActive: boolean; onClose: () => void }> = ({ pane: p, isActive, onClose }) => {
  const { refCallback: slot } = usePaneToolbarSlot(p.uniqId);
  const { refCallback: headerSlot } = usePaneHeaderActionsSlot(p.uniqId);
  const hasToolbar = useHasToolbar(p.uniqId);
  const isDirty = usePaneIsDirty(p.uniqId);
  const isEditMode = usePaneIsEditMode(p.uniqId);
  const onReload = usePaneReload(p.uniqId);
  const Component = p.component as FC<any>;

  // Ref на корневой DOM-узел Pane — нужен чтобы при открытии нового пейна
  // или переключении на существующий автоматически передать фокус
  // первому табличному scroll-контейнеру (TableScrollWrapper, tabIndex=0).
  // Это даёт мгновенную клавиатурную навигацию (Up/Down/Left/Right/Insert/
  // Delete/Home/End/PgUp/PgDn) по таблице внутри Pane без доп. клика мыши.
  const paneRootRef = useRef<HTMLDivElement | null>(null);
  // Отслеживаем смену isActive: при переходе false → true (или при первой
  // активации) принудительно переводим фокус на таблицу, даже если форма
  // уже автофокусила какой-то свой input. При обычном ре-рендере (isActive
  // не менялся) — фокус НЕ перехватываем, чтобы не мешать пользователю.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!isActive) {
      wasActiveRef.current = false;
      return;
    }
    const justActivated = !wasActiveRef.current;
    wasActiveRef.current = true;
    const root = paneRootRef.current;
    if (!root) return;
    // Если это просто ре-рендер активного пейна, и фокус уже внутри него
    // (например, пользователь печатает в поле формы) — НЕ перехватываем.
    if (!justActivated && root.contains(document.activeElement)) return;
    // Двойной rAF: 1) React commit + ребёнок (форма/список) смонтирован,
    // 2) браузер применил layout/CSS — теперь scroll-контейнер существует.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        if (!paneRootRef.current) return;
        // Ищем ПЕРВЫЙ ВИДИМЫЙ табличный scroll-контейнер. Внутри Pane может
        // быть форма с Tabs (см. ModelForm) — неактивные вкладки скрыты через
        // display:none (см. Tabs.module.scss .TabsBodyWrapper), их таблицы не
        // фокусируемы. Фильтруем по offsetParent !== null (стандартный
        // признак «не display:none и не вне layout-потока»).
        const candidates = Array.from(
          paneRootRef.current.querySelectorAll<HTMLElement>('[class*="TableScrollWrapper"][tabindex="0"]')
        );
        const visible = candidates.find(el => el.offsetParent !== null);
        const target =
          visible
          ?? paneRootRef.current.querySelector<HTMLElement>('[tabindex="0"]');
        // На активации перехватываем фокус принудительно (даже если форма
        // успела автофокусить input — таблица приоритетнее для клавиатурной
        // навигации). На последующих ре-рендерах сюда не попадаем (см. выше).
        target?.focus({ preventScroll: true });
      });
      cleanup.raf2 = raf2;
    });
    const cleanup: { raf2: number | null } = { raf2: null };
    return () => {
      cancelAnimationFrame(raf1);
      if (cleanup.raf2 !== null) cancelAnimationFrame(cleanup.raf2);
    };
  }, [isActive, p.uniqId]);

  return (
    <div
      ref={paneRootRef}
      className={[styles.PaneItem, isActive && styles.PaneItemActive].filter(Boolean).join(" ")}
    >
      <div className={styles.PaneItemHeader}>
        <h2 className={styles.PaneItemHeaderLabel}>
          {p.label}
          {isDirty && (
            <span
              className={styles.PaneItemDirtyDot}
              aria-label={translate("unsavedChanges")}
              title={translate("hasUnsavedChanges")}
            />
          )}
        </h2>
        <div className={styles.PaneItemHeaderToolbar}>
          {/* Слот для дополнительных кнопок от конкретной формы (напр. «Печать»).
              Регистрируются через usePaneHeaderActions(paneId, <…/>). */}
          <div ref={headerSlot} className={styles.PaneItemHeaderActionsSlot} />
          {p.restore && (
            <IconButton
              icon="link"
              title="Копировать ссылку на эту форму"
              aria-label="Копировать ссылку"
              onClick={() => void copyPaneLink(p.restore!)}
            />
          )}
          {hasToolbar && <ReloadButton onClick={onReload} disabled={!isEditMode} />}
          <ClearButton onClick={onClose} />
        </div>
      </div>
      <React.Suspense fallback={<LoadingSpinner />}>
        <Component {...p} />
      </React.Suspense>
      {hasToolbar && <div className={styles.PaneItemBottomToolbar}>
        <ToolbarSlot ref={slot} />
      </div>}
    </div>
  );
}

type TypeOverFormProps = PropsWithChildren;
export const OverForm: FC<TypeOverFormProps> = ({ children }) => {
  return (
    <div className={styles.OverFormNest}>
      <div className={styles.OverFormTringleIcon}>
        <svg width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
          strokeWidth='2'
          stroke-linejoin="round"
          stroke-linecap="round">
          <polygon points="4,10 12,10 8,4"
            fill="#eee" />

          <line x1="4"
            y1="10"
            x2="8"
            y2="4"
            stroke="#aaa"
            stroke-width="1"
            stroke-linejoin="round"
            stroke-linecap="round" />

          <line x1="8"
            y1="4"
            x2="12"
            y2="10"
            stroke="#aaa"
            stroke-width="1"
            stroke-linejoin="round"
            stroke-linecap="round" />
        </svg>
      </div>
      <div className={styles.OverFormWrapper}>
        {children}
      </div>
    </div>
  )
}

export const Portal = ({ content }: { content: React.ReactNode }) => {
  if (!content) return null;
  const RootPortal = document.getElementById("RootPortal")!;
  RootPortal.className = styles.RootPortal;

  return createPortal(
    <div className={styles.PortalWrapper}>{content}</div>,
    RootPortal
  );
};


interface ScreenProps {
  children: React.ReactNode;
}

// Основные компоненты интерфейса
export const Screen = forwardRef<HTMLDivElement, ScreenProps>(({ children }, ref) => {
  const internalRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => internalRef.current!, []);

  // Register screen ref with modalManager so blur toggling is centralized
  useEffect(() => {
    modalManager.setScreenRef(internalRef);
    return () => { modalManager.setScreenRef(null); };
  }, []);
  return (
    <div ref={internalRef} className={styles.Screen}>
      {children}
      <UIToast />
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// LanguageSwitcher — переключатель RU / ҚАЗ в Navbar
// ═══════════════════════════════════════════════════════════════════════════

const LanguageSwitcher: FC = () => {
  const lang = getLanguage();
  return (
    <button
      type="button"
      className={styles.PersistenceToggle}
      onClick={() => setLanguage(lang === "ru" ? "kk" : "ru")}
      title={lang === "ru" ? translate("switchToKazakh") : translate("switchToRussian")}
    >
      {lang === "ru" ? "RU" : "ҚАЗ"}
    </button>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// PersistenceModeToggle — переключатель offline-first / transactional в Navbar
// ═══════════════════════════════════════════════════════════════════════════

const PersistenceModeToggle: FC = () => {
  const [mode, setMode] = usePersistenceMode();
  const isOF = mode === "offline-first";
  return (
    <button
      type="button"
      className={styles.PersistenceToggle}
      onClick={() => setMode(isOF ? "transactional" : "offline-first")}
      title={isOF ? translate("offlineFirstMode") : translate("transactionalMode")}
    >
      {isOF ? "⚡ " + translate("offline") : "🔗 " + translate("online")}
    </button>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// NavbarPaneBell — колокольчик уведомлений активной панели в Navbar
// ═══════════════════════════════════════════════════════════════════════════

// endpoint источника → i18n-ключ типа элемента (для информативной ссылки).
const NOTE_ENTITY_KEY: Record<string, string> = {
  sales: "sale",
  purchases: "purchase",
  salereturns: "saleReturn",
  purchasereturns: "purchaseReturn",
  inventorytransfers: "inventoryTransfer",
  cashreceiptorders: "cashReceiptOrder",
  counterparties: "counterparty",
  contracts: "contract",
  organizations: "organization",
  employees: "employee",
  contacts: "contact",
  contactpersons: "contactPerson",
  bankaccounts: "bankAccount",
};

/** Текст ссылки-перехода: «{Тип элемента} {№/дата или наименование}» либо короткий uuid. */
function noteRefLinkText(ref: { endpoint: string; uuid: string; label?: string }): string {
  const key = NOTE_ENTITY_KEY[ref.endpoint];
  const entity = key ? translate(key) : "";
  const ident = ref.label || `#${ref.uuid.slice(0, 8)}`;
  return [entity, ident].filter(Boolean).join(" ");
}

const NavbarPaneBell: FC = () => {
  const { windows: { addPane } } = useAppContext();
  const groups = useAllPaneNotifications();
  const [showNotes, setShowNotes] = useState(false);
  // Позиция попапа (position:fixed) — попап портируется в body, т.к. навбар имеет
  // overflow: clip и иначе обрезал бы absolute-потомка (как .NavbarMobileMenu).
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const totalCount = groups.reduce((sum, g) => sum + g.notifications.length, 0);

  // Закрыть попover при клике вне
  useEffect(() => {
    if (!showNotes) return;
    const handler = (e: MouseEvent) => {
      if (
        bellRef.current && !bellRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setShowNotes(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNotes]);

  const openJournal = useCallback(() => {
    setShowNotes(false);
    addPane({ component: NotificationsList, label: translate("notificationsCenter") });
  }, [addPane]);

  if (totalCount === 0) return null;

  return (
    <div className={styles.PaneNoteBellWrap}>
      <button
        ref={bellRef}
        className={[styles.NavbarBellBtn, styles.PaneNoteBell].join(" ")}
        onClick={() => {
          if (!showNotes && bellRef.current) {
            const r = bellRef.current.getBoundingClientRect();
            setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          }
          setShowNotes((v) => !v);
        }}
        title={translate("panelNotifications")}
        type="button"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1.5a4 4 0 0 0-4 4v2.7L2.7 10.5a.75.75 0 0 0 .53 1.28h9.54a.75.75 0 0 0 .53-1.28L12 8.2V5.5a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        </svg>
        <span className={styles.PaneNoteBadge}>{totalCount}</span>
      </button>
      {showNotes && pos && createPortal(
        <div ref={popoverRef} className={styles.PaneNotePopover} style={{ position: "fixed", top: pos.top, right: pos.right }}>
          <div className={styles.PaneNotePopoverHeader}>
            <span>{translate("notifications")}</span>
            <button className={styles.PaneNoteJournalLink} onClick={openJournal} type="button">
              {translate("journal")} ➜
            </button>
          </div>
          {groups.flatMap((g) =>
            g.notifications.map((n) => (
              <div
                key={n.id}
                className={[
                  styles.PaneNoteItem,
                  n.type === "error" ? styles.PaneNoteError
                    : n.type === "warning" ? styles.PaneNoteWarning
                      : styles.PaneNoteInfo,
                  n.resolved ? styles.PaneNoteResolved : "",
                ].filter(Boolean).join(" ")}
              >
                <span className={styles.PaneNoteIcon}>{n.type === "error" ? "❌" : n.type === "warning" ? "⚠️" : "ℹ️"}</span>
                <span className={styles.PaneNoteText}>
                  {n.text}
                  {n.ref && canOpenByRef(n.ref.endpoint) && (
                    <button
                      className={styles.PaneNoteOpenBtn}
                      type="button"
                      title={`${translate("open")}: ${noteRefLinkText(n.ref)}`}
                      onClick={() => {
                        void openFormByRef(n.ref!, addPane);
                        setShowNotes(false);
                      }}
                    >{translate("open")}: {noteRefLinkText(n.ref)} ➜</button>
                  )}
                  {n.actions && n.actions.length > 0 && !n.resolved && (
                    <span className={styles.PaneNoteActions}>
                      {n.actions.map((a, i) => (
                        <button
                          key={i}
                          className={styles.PaneNoteActionBtn}
                          type="button"
                          onClick={() => {
                            void a.onClick();
                            dismissPaneNotification(g.paneId, n.id);
                          }}
                        >{a.label}</button>
                      ))}
                    </span>
                  )}
                </span>
                <button
                  className={styles.PaneNoteDismiss}
                  onClick={() => dismissPaneNotification(g.paneId, n.id)}
                  title={translate("hide")}
                  type="button"
                >✕</button>
              </div>
            ))
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

export const Navbar: React.FC = () => {
  const context = useAppContext();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const { props, setProps } = context.navbar;
  const activeNav = props.find(nav => nav.isActive);

  // Измеряем высоту навбара → CSS custom property для overlay
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      el.closest(`.${styles.Screen}`)?.setAttribute("style", `--navbar-h:${h}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleNav = useCallback((id: string) => {
    setProps(prev => prev.map(n =>
      n.id === id
        ? { ...n, isActive: !n.isActive }
        : { ...n, isActive: false }
    ));
    setMobileMenuOpen(false);
  }, [setProps]);

  /** Закрыть все меню (overlay + mobile) */
  const closeAll = useCallback(() => {
    setProps(prev => prev.map(n => ({ ...n, isActive: false })));
    setMobileMenuOpen(false);
  }, [setProps]);

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen(prev => !prev);
  }, []);

  return (
    <>
      <nav ref={navRef} className={styles.NavbarWrapper}>
        {/* Hamburger — видна только на ≤768px */}
        <button
          className={styles.NavbarBurger}
          onClick={toggleMobileMenu}
          aria-label={translate("menu")}
          type="button"
        >
          <span />
        </button>

        {/* Логотип приложения */}
        <div className={styles.NavbarLogo}>
          <div className={styles.NavbarLogoIcon}>A</div>
          {/* <span className={styles.NavbarLogoText}>Aleppo</span> */}
        </div>

        {/* Десктопные навигационные ссылки (скрыты на мобильных через CSS) */}
        {props.map(nav => (
          <a key={nav.id} href="#"
            onClick={(e) => { e.preventDefault(); toggleNav(nav.id); }}
            className={[styles.NavbarItem, nav.isActive && styles.Active].filter(Boolean).join(" ")}>
            {nav.title}
          </a>
        ))}

        {/* Правая часть: индикаторы, имя, выход */}
        <div className={styles.NavbarRight}>
          <LanguageSwitcher />
          <PersistenceModeToggle />
          <NavbarPaneBell />
          <OfflineIndicator />
          <NotificationToast />
          <OrgSwitcher />
          {context.auth?.user && (
            <span className={styles.NavbarUserName}>
              {context.auth.user.employee?.fullName || context.auth.user.username}
            </span>
          )}
          {context.auth?.logout && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); context.auth.logout(); }}
              className={styles.NavbarLogout}
              title={translate("logoutTooltip")}
            >
              {translate("logout")}
            </a>
          )}
        </div>

        {/* Мобильное раскрывающееся меню */}
        {mobileMenuOpen && (
          <>
            <div className={styles.NavbarMobileMenu}>
              {props.map(nav => (
                <a key={nav.id} href="#"
                  onClick={(e) => { e.preventDefault(); toggleNav(nav.id); }}
                  className={nav.isActive ? styles.Active : undefined}>
                  {nav.title}
                </a>
              ))}
            </div>
            {/* Backdrop для мобильного меню */}
            <div className={styles.NavbarMobileBackdrop} onClick={() => setMobileMenuOpen(false)} />
          </>
        )}
      </nav>

      {/* Overlay — абсолютно поверх Content, ниже навбара */}
      {activeNav && (
        <>
          <div className={styles.NavbarOverlayWrapper}>
            {activeNav.component}
          </div>
          <div className={styles.NavbarBackdrop} onClick={closeAll} />
        </>
      )}
    </>
  )
}

type TypeNavListProps = {
  label: string;
}

export const NavList = ({ label }: TypeNavListProps) => {

  const context = useAppContext();
  const addPane = context.windows.addPane;
  const user = context.auth.user;
  const rights = user?.userAccessRights ?? user?.employee?.userAccessRights ?? [];
  const isSuperAdmin = user?.isSuperAdmin;

  /** Проверяет, имеет ли пользователь хотя бы readonly доступ к модели */
  const can = (modelName: string) => getAccessLevel(rights, modelName, isSuperAdmin).canRead;

  if (label.toLocaleLowerCase() === "Trade".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("trade")}</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>{translate("sales")}</h3>
            <ul className={styles.NavList}>
              {can("Sale") && <li className={styles.NavListAccent} onClick={() => addPane({ component: SalesTerminal, label: translate("salesTerminal") })}>⚡ {translate("salesTerminal")}</li>}
              {can("Sale") && <li onClick={() => addPane({ component: SalesList, label: translate("saleRealization") })}>{translate("saleRealization")}</li>}
              {can("SaleReturn") && <li onClick={() => addPane({ component: SaleReturnsList, label: translate("SaleReturnsList") })}>{translate("SaleReturnsList")}</li>}
              {can("OutgoingInvoice") && <li onClick={() => addPane({ component: OutgoingInvoicesList, label: translate("outgoingInvoice") })}>{translate("outgoingInvoice")}</li>}
              {can("PaymentInvoice") && <li onClick={() => addPane({ component: PaymentInvoicesList, label: translate("paymentInvoice") })}>{translate("paymentInvoice")}</li>}
              {can("CommercialOffer") && <li onClick={() => addPane({ component: CommercialOffersList, label: translate("docType_commercial_offer") })}>{translate("docType_commercial_offer")}</li>}
              {can("SalesOrder") && <li onClick={() => addPane({ component: SalesOrdersList, label: translate("docType_sales_order") })}>{translate("docType_sales_order")}</li>}
              {can("Reservation") && <li onClick={() => addPane({ component: ReservationsList, label: translate("docType_reservation") })}>{translate("docType_reservation")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("purchase")}</h3>
            <ul className={styles.NavList}>
              {can("Purchase") && <li onClick={() => addPane({ component: PurchasesList, label: translate("purchaseReceipt") })}>{translate("purchaseReceipt")}</li>}
              {can("PurchaseReturn") && <li onClick={() => addPane({ component: PurchaseReturnsList, label: translate("PurchaseReturnsList") })}>{translate("PurchaseReturnsList")}</li>}
              {can("IncomingInvoice") && <li onClick={() => addPane({ component: IncomingInvoicesList, label: translate("incomingInvoice") })}>{translate("incomingInvoice")}</li>}
              {can("PurchaseRequisition") && <li onClick={() => addPane({ component: PurchaseRequisitionsList, label: translate("PurchaseRequisitionsList") })}>{translate("PurchaseRequisitionsList")}</li>}
              {can("PurchaseOrder") && <li onClick={() => addPane({ component: PurchaseOrdersList, label: translate("docType_purchase_order") })}>{translate("docType_purchase_order")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("warehouse")}</h3>
            <ul className={styles.NavList}>
              {can("Warehouse") && <li onClick={() => addPane({ component: WarehousesList, label: translate("WarehousesList") })}>{translate("WarehousesList")}</li>}
              {can("InventoryTransfer") && <li onClick={() => addPane({ component: InventoryTransfersList, label: translate("InventoryTransfersList") })}>{translate("InventoryTransfersList")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("cash")}</h3>
            <ul className={styles.NavList}>
              {can("CashReceiptOrder") && <li onClick={() => addPane({ component: CashReceiptOrdersList, label: translate("CashReceiptOrdersList") })}>{translate("CashReceiptOrdersList")}</li>}
              {can("CashExpenseOrder") && <li onClick={() => addPane({ component: CashExpenseOrdersList, label: translate("CashExpenseOrdersList") })}>{translate("CashExpenseOrdersList")}</li>}
              {can("BankStatement") && <li onClick={() => addPane({ component: BankStatementsList, label: translate("docType_bank_statement") })}>{translate("docType_bank_statement")}</li>}
              {can("FiscalReceipt") && <li onClick={() => addPane({ component: FiscalReceiptsList, label: translate("FiscalReceiptsList") })}>{translate("FiscalReceiptsList")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("reports")}</h3>
            <ul className={styles.NavList}>
              {can("Sale") && <li onClick={() => addPane({ component: SalesReport, label: translate("SalesReportList") })}>{translate("SalesReportList")}</li>}
              {can("Sale") && <li onClick={() => addPane({ component: ManagerReport, label: translate("managerReport") })}>{translate("managerReport")}</li>}
              {(can("Purchase") || can("Sale")) && <li onClick={() => addPane({ component: MaterialStatement, label: translate("MaterialStatementList") })}>{translate("MaterialStatementList")}</li>}
              {(can("Purchase") || can("Sale")) && <li onClick={() => addPane({ component: ProductRegisterReport, label: translate("ProductRegisterList") })}>{translate("ProductRegisterList")}</li>}
              {(can("ProductPrice") || can("Product")) && <li onClick={() => addPane({ component: PriceListReport, label: translate("priceListReport") })}>{translate("priceListReport")}</li>}
              {(can("Purchase") || can("Sale")) && <li onClick={() => addPane({ component: InventoryTurnoverReport, label: translate("inventoryTurnover") })}>{translate("inventoryTurnover")}</li>}
              {(can("Purchase") || can("Sale")) && <li onClick={() => addPane({ component: InventoryBatchesReport, label: translate("inventoryBatches") })}>{translate("inventoryBatches")}</li>}
              {can("Sale") && <li onClick={() => addPane({ component: ABCReport, label: translate("abcAnalysis") })}>{translate("abcAnalysis")}</li>}
              {(can("CashReceiptOrder") || can("CashExpenseOrder")) && <li onClick={() => addPane({ component: CashReport, label: translate("CashReportList") })}>{translate("CashReportList")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("directories")}</h3>
            <ul className={styles.NavList}>
              {can("Product") && <li onClick={() => addPane({ component: ProductsList, label: translate("ProductsList") })}>{translate("ProductsList")}</li>}
              {(can("ProductPrice") || can("Product")) && <li onClick={() => addPane({ component: ProductPriceCorrection, label: translate("ProductPriceProcessing") })}>{translate("ProductPriceProcessing")}</li>}
              {(can("ProductPrice") || can("Product")) && <li onClick={() => addPane({ component: ProductPriceImport, label: translate("priceImportForm") })}>{translate("priceImportForm")}</li>}
              {(can("ProductPrice") || can("Product")) && <li onClick={() => addPane({ component: PriceTypesList, label: translate("PriceTypesList") })}>{translate("PriceTypesList")}</li>}
              {can("Product") && <li onClick={() => addPane({ component: ProductImportExport, label: translate("ProductImportExport") })}>{translate("ProductImportExport")}</li>}
              {can("Brand") && <li onClick={() => addPane({ component: BrandsList, label: translate("BrandsList") })}>{translate("BrandsList")}</li>}
              <li onClick={() => addPane({ component: ClassifiersList, label: translate("clsSection") })}>{translate("clsSection")}</li>
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("govDocsSection")}</h3>
            <ul className={styles.NavList}>
              {can("OutgoingInvoice") && <li onClick={() => addPane({ component: OutgoingInvoicesList, label: translate("esfOutgoingSection") })}>{translate("esfOutgoingSection")}</li>}
              {can("OutgoingInvoice") && <li onClick={() => addPane({ component: EsfIncomingList, label: translate("esfIncomingSection") })}>{translate("esfIncomingSection")}</li>}
              <li className={styles.NavHint}>{translate("govDocsHint")}</li>
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("edoSection")}</h3>
            <ul className={styles.NavList}>
              {can("EdoDocument") && <li onClick={() => addPane({ component: EdoInboxList, label: translate("edoInbox") })}>{translate("edoInbox")}</li>}
              {can("EdoDocument") && <li onClick={() => addPane({ component: EdoOutboxList, label: translate("edoOutbox") })}>{translate("edoOutbox")}</li>}
            </ul>
          </div>
        </div>
      </div>
    )
  } else if (label.toLocaleLowerCase() === "Accounting".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("accounting")}</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>{translate("reports")}</h3>
            <ul className={styles.NavList}>
              {can("AccountingEntry") && <li onClick={() => addPane({ component: AccountingJournal, label: translate("accountingJournalTitle") })}>{translate("accountingJournalTitle")}</li>}
              {can("AccountingEntry") && <li onClick={() => addPane({ component: TurnoverBalanceSheet, label: translate("osvTitle") })}>{translate("osvTitle")}</li>}
              {can("AccountingEntry") && <li onClick={() => addPane({ component: AccountCard, label: translate("accountCardTitle") })}>{translate("accountCardTitle")}</li>}
              {can("AccountingEntry") && <li onClick={() => addPane({ component: SettlementsReport, label: translate("settlementsReport") })}>{translate("settlementsReport")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("monthCloseRegulatory")}</h3>
            <ul className={styles.NavList}>
              {can("MonthClose") && <li onClick={() => addPane({ component: MonthClosesList, label: translate("MonthClosesList") })}>{translate("MonthClosesList")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("directories")}</h3>
            <ul className={styles.NavList}>
              {can("ChartOfAccount") && <li onClick={() => addPane({ component: ChartOfAccountsList, label: translate("chartOfAccountsTitle") })}>{translate("chartOfAccountsTitle")}</li>}
              {can("SubkontoType") && <li onClick={() => addPane({ component: SubkontoTypesList, label: translate("subkontoTypesTitle") })}>{translate("subkontoTypesTitle")}</li>}
            </ul>
          </div>
        </div>
      </div>
    )
  } else if (label.toLocaleLowerCase() === "HR".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("hr")}</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>{translate("documents")}</h3>
            <ul className={styles.NavList}>
              {can("PayrollCalculation") && <li onClick={() => addPane({ component: PayrollCalculationsList, label: translate("PayrollCalculationsList") })}>{translate("PayrollCalculationsList")}</li>}
              {can("PayrollPayment") && <li onClick={() => addPane({ component: PayrollPaymentsList, label: translate("PayrollPaymentsList") })}>{translate("PayrollPaymentsList")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("directories")}</h3>
            <ul className={styles.NavList}>
              {can("Employee") && <li onClick={() => addPane({ component: EmployeesList, label: translate("EmployeesList") })}>{translate("EmployeesList")}</li>}
              {can("Position") && <li onClick={() => addPane({ component: PositionsList, label: translate("PositionsList") })}>{translate("PositionsList")}</li>}
            </ul>
          </div>
        </div>
      </div>
    )
  } else if (label.toLocaleLowerCase() === "CRM".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("crm")}</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>{translate("taskManagement")}</h3>
            <ul className={styles.NavList}>
              {can("Todo") && <li onClick={() => addPane({ component: TodosList, label: translate("TodosList") })}>{translate("TodosList")}</li>}
              {can("ScheduledTask") && <li onClick={() => addPane({ component: ScheduledTasksList, label: translate("ScheduledTasksList") })}>{translate("ScheduledTasksList")}</li>}
            </ul>
          </div>
        </div>
      </div>
    )
  } else if (label.toLocaleLowerCase() === "Settings".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>{translate("settings")}</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>{translate("directories")}</h3>
            <ul className={styles.NavList}>
              {can("Organization") && <li onClick={() => addPane({ component: OrganizationsList, label: translate("OrganizationsList") })}>{translate("OrganizationsList")}</li>}
              {can("Counterparty") && <li onClick={() => addPane({ component: CounterpartiesList, label: translate("CounterpartiesList") })}>{translate("CounterpartiesList")}</li>}
              {can("Contract") && <li onClick={() => addPane({ component: ContractsList, label: translate("ContractsList") })}>{translate("ContractsList")}</li>}
              {can("BankAccount") && <li onClick={() => addPane({ component: BankAccountsList, label: translate("BankAccountsList") })}>{translate("BankAccountsList")}</li>}
              {can("Cashbox") && <li onClick={() => addPane({ component: CashboxesList, label: translate("CashboxesList") })}>{translate("CashboxesList")}</li>}
              {can("Contact") && <li onClick={() => addPane({ component: ContactsList, label: translate("ContactsList") })}>{translate("ContactsList")}</li>}
              {can("ContactPerson") && <li onClick={() => addPane({ component: ContactPersonsList, label: translate("ContactPersonsList") })}>{translate("ContactPersonsList")}</li>}
              {can("Currency") && <li onClick={() => addPane({ component: CurrenciesList, label: translate("CurrenciesList") })}>{translate("CurrenciesList")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("accounting")}</h3>
            <ul className={styles.NavList}>
              {can("OrganizationAccountingSetting") && <li onClick={() => addPane({ component: OrganizationAccountingSettingsList, label: translate("OrganizationAccountingSettingsList") })}>{translate("OrganizationAccountingSettingsList")}</li>}
              {can("UnitOfMeasure") && <li onClick={() => addPane({ component: UnitOfMeasuresList, label: translate("UnitOfMeasuresList") })}>{translate("UnitOfMeasuresList")}</li>}
              {can("Tax") && <li onClick={() => addPane({ component: TaxesList, label: translate("TaxesList") })}>{translate("TaxesList")}</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("generalSettings")}</h3>
            <ul className={styles.NavList}>
              <li onClick={() => addPane({ component: GeneralSettings, label: translate("generalSettings") })}>{translate("generalSettings")}</li>
              <li onClick={() => addPane({ component: DocumentNumberSettings, label: translate("documentNumberSettings") })}>{translate("documentNumberSettings")}</li>
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>{translate("administration")}</h3>
            <ul className={styles.NavList}>
              {can("User") && <li onClick={() => addPane({ component: UsersList, label: translate("UsersList") })}>{translate("UsersList")}</li>}
              {can("UserSettings") && <li onClick={async () => { const m = await import("src/models/UserSettings"); addPane({ component: m.UserSettingsModuleList, label: translate("UserSettings") }); }}>{translate("UserSettings")}</li>}
              {can("ActivityHistory") && <li onClick={() => addPane({ component: ActivityHistoriesList, label: translate("ActivityHistoriesList") })}>{translate("ActivityHistoriesList")}</li>}
              {can("Notification") && <li onClick={() => addPane({ component: NotificationsList, label: translate("notificationsCenter") })}>{translate("notificationsCenter")}</li>}
              <li onClick={() => addPane({ component: FilesList, label: translate("files") })}>{translate("files")}</li>
              <li onClick={() => addPane({ component: UnsavedFormsList, label: translate("unsavedRecords") })}>{translate("unsavedRecords")}</li>
              <li onClick={() => addPane({ component: OrphanRefsForm, label: translate("deletedReferenceControl") })}>{translate("deletedReferenceControl")}</li>
              <li onClick={() => addPane({ component: SearchReplaceRefsForm, label: translate("searchReplaceReferences") })}>{translate("searchReplaceReferences")}</li>
              <li onClick={() => addPane({ component: SyncDashboard, label: translate("syncOfflineData") })}>{translate("syncOfflineData")}</li>
            </ul>
          </div>
        </div>
      </div>
    )
  }
}

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export const LoadingFallback: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      <span className="ml-3 text-lg">{translate("loading")}</span>
    </div>
  );
};

export const LoadingSpinner: React.FC<{ variant?: 'default' | 'overlay' }> = ({ variant = 'default' }) => {
  return (
    <div className={variant === 'overlay' ? styles.LoadingSpinnerOverlay : styles.LoadingSpinnerContainer}>
      <div className={styles.LoadingSpinner}></div>
    </div>
  );
};

/**
 * Возвращает callback для перезагрузки данных в панели.
 * В настоящее время это просто заглушка, которая выводит сообщение в консоль.
 * Реальная реализация будет зависеть от того, как управляется состояние данных (например, SWR, React Query, или кастомный стор).
 * @param uniqId - Уникальный идентификатор сущности в панели.
 */
function usePaneReload(uniqId?: string): () => void {
  const ctx = useAppContext();
  const reloadPane = (ctx?.windows as any)?.reloadPane;

  const handleReload = useCallback(() => {
    if (!uniqId) return;

    if (typeof reloadPane === "function") {
      try {
        reloadPane(uniqId);
      } catch (err) {
        console.error("Error while reloading pane:", err);
      }
    } else {
      // Fallback behavior — dispatch an event that consumers can listen to,
      // or at least log so developers can add a reload handler if needed.
      console.warn("reloadPane not available in context — dispatching 'pane:reload' event as fallback");
      window.dispatchEvent(new CustomEvent("pane:reload", { detail: { uniqId } }));
    }
  }, [uniqId, reloadPane]);

  return handleReload;
}
