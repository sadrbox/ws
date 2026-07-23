import React, { CSSProperties, FC, PropsWithChildren, useEffect, useLayoutEffect, useState, useCallback, useMemo, forwardRef, useRef, useImperativeHandle, ReactNode, Component, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import modalManager from 'src/components/Modal/modalManager';
import { createPortal } from 'react-dom';
// Divider is imported in components that use it; not used here
import { translate, getLanguage, setLanguage } from 'src/i18';
import { getEffectiveTheme, toggleTheme } from 'src/services/theme';
import { useAppContext } from 'src/app/context';
import { ReloadButton, ClearButton, IconButton } from 'src/components/Toolbar';
import { copyPaneLink } from "src/utils/paneLink";
import { useChatUnread } from "src/hooks/useChatUnread";
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
// AccessRightsModuleList/AccessPermissionsList загружаются динамически (разрыв цикла UI→models→app→UI)
import NotificationToast from 'src/components/NotificationToast';
import OfflineIndicator from 'src/components/OfflineIndicator';
import UIToast from 'src/components/UIToast';
import { getAccessLevel } from 'src/hooks/useAccessPermission';
import { usePersistenceMode } from 'src/services/persistenceMode';
import {
  ContractsList,
  ActivityHistoriesList,
  PipeActivitiesList,
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
      {hasToolbar && <div className={styles.PaneItemBottomToolbar}>
        <ToolbarSlot ref={slot} />
      </div>}
      <React.Suspense fallback={<LoadingSpinner />}>
        <Component {...p} />
      </React.Suspense>
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

// Переключатель светлой/тёмной темы (E5). Иконка отражает ДЕЙСТВИЕ по клику.
const ThemeSwitcher: FC = () => {
  const [dark, setDark] = useState(() => getEffectiveTheme() === "dark");
  return (
    <button
      type="button"
      className={styles.PersistenceToggle}
      onClick={() => setDark(toggleTheme() === "dark")}
      title={dark ? translate("switchToLight") : translate("switchToDark")}
      aria-label={dark ? translate("switchToLight") : translate("switchToDark")}
    >
      {dark ? "☾" : "☀"}
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
          {/* Тумблер тёмной темы СКРЫТ до готовности: инфраструктура (проекция
              SCSS→CSS-переменные, токены, dark-палитра, сам ThemeSwitcher) на
              месте, НО в module.scss ещё ~390 хардкод-цветов (244 текста + 148
              фонов в 46 файлах), которые не переключаются — отсюда невидимый текст
              и «светлые заплатки» в тёмной теме. Вернуть, когда цвета переведены на
              токены и dark-значения выверены визуально. См. E5 в ROADMAP. */}
          {/* <ThemeSwitcher /> */}
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

  const TradeGroups = () => (
    <>
      <div className={styles.NavGroup}>
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
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("purchase")}</h3>
        <ul className={styles.NavList}>
          {can("Purchase") && <NavItem onClick={() => addPane({ component: PurchasesList, label: translate("purchaseReceipt") })}>{translate("purchaseReceipt")}</NavItem>}
          {can("PurchaseReturn") && <NavItem onClick={() => addPane({ component: PurchaseReturnsList })}>{translate("PurchaseReturnsList")}</NavItem>}
          {can("IncomingInvoice") && <NavItem onClick={() => addPane({ component: IncomingInvoicesList, label: translate("incomingInvoice") })}>{translate("incomingInvoice")}</NavItem>}
          {can("PurchaseRequisition") && <NavItem onClick={() => addPane({ component: PurchaseRequisitionsList })}>{translate("PurchaseRequisitionsList")}</NavItem>}
          {can("PurchaseOrder") && <NavItem onClick={() => addPane({ component: PurchaseOrdersList, label: translate("docType_purchase_order") })}>{translate("docType_purchase_order")}</NavItem>}
          {can("ImportDeclaration") && <NavItem onClick={() => addPane({ component: ImportDeclarationsList })}>{translate("ImportDeclarationsList")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("warehouse")}</h3>
        <ul className={styles.NavList}>
          {can("InventoryTransfer") && <NavItem onClick={() => addPane({ component: InventoryTransfersList })}>{translate("InventoryTransfersList")}</NavItem>}
          {can("WriteOff") && <NavItem onClick={() => addPane({ component: WriteOffsList })}>{translate("WriteOffsList")}</NavItem>}
          {can("GoodsReceipt") && <NavItem onClick={() => addPane({ component: GoodsReceiptsList })}>{translate("GoodsReceiptsList")}</NavItem>}
          {can("StockCount") && <NavItem onClick={() => addPane({ component: StockCountsList })}>{translate("StockCountsList")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("cash")}</h3>
        <ul className={styles.NavList}>
          {can("CashReceiptOrder") && <NavItem onClick={() => addPane({ component: CashReceiptOrdersList })}>{translate("CashReceiptOrdersList")}</NavItem>}
          {can("CashExpenseOrder") && <NavItem onClick={() => addPane({ component: CashExpenseOrdersList })}>{translate("CashExpenseOrdersList")}</NavItem>}
          {can("BankStatement") && <NavItem onClick={() => addPane({ component: BankStatementsList, label: translate("docType_bank_statement") })}>{translate("docType_bank_statement")}</NavItem>}
          {can("FiscalReceipt") && <NavItem onClick={() => addPane({ component: FiscalReceiptsList })}>{translate("FiscalReceiptsList")}</NavItem>}
        </ul>
      </div>
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
          {(can("CashReceiptOrder") || can("CashExpenseOrder")) && <NavItem onClick={() => addPane({ component: CashReport, label: translate("CashReportList") })}>{translate("CashReportList")}</NavItem>}
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("directories")}</h3>
        <ul className={styles.NavList}>
          {can("Product") && <NavItem onClick={() => addPane({ component: ProductsList })}>{translate("ProductsList")}</NavItem>}
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
      <div className={styles.NavGroup}>
        <h3>{translate("govDocsSection")}</h3>
        <ul className={styles.NavList}>
          {can("OutgoingInvoice") && <NavItem onClick={() => addPane({ component: EsfIncomingList, label: translate("esfIncomingSection") })}>{translate("esfIncomingSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: AwpOutboxList, label: translate("awpOutboxSection") })}>{translate("awpOutboxSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: AwpIncomingList, label: translate("awpIncomingSection") })}>{translate("awpIncomingSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: SntOutboxList, label: translate("sntOutboxSection") })}>{translate("sntOutboxSection")}</NavItem>}
          {can("Sale") && <NavItem onClick={() => addPane({ component: SntIncomingList, label: translate("sntIncomingSection") })}>{translate("sntIncomingSection")}</NavItem>}
          <li className={styles.NavHint}>{translate("govDocsHint")}</li>
        </ul>
      </div>
      <div className={styles.NavGroup}>
        <h3>{translate("edoSection")}</h3>
        <ul className={styles.NavList}>
          {can("EdoDocument") && <NavItem onClick={() => addPane({ component: EdoInboxList, label: translate("edoInbox") })}>{translate("edoInbox")}</NavItem>}
          {can("EdoDocument") && <NavItem onClick={() => addPane({ component: EdoOutboxList, label: translate("edoOutbox") })}>{translate("edoOutbox")}</NavItem>}
        </ul>
      </div>
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
          {can("Notification") && <NavItem onClick={() => addPane({ component: NotificationsList, label: translate("notificationsCenter") })}>{translate("notificationsCenter")}</NavItem>}
          <NavItem onClick={() => addPane({ component: FilesList, label: translate("files") })}>{translate("files")}</NavItem>
          <NavItem onClick={() => addPane({ component: UnsavedFormsList, label: translate("unsavedRecords") })}>{translate("unsavedRecords")}</NavItem>
          {can("ScheduledTask") && <NavItem onClick={() => addPane({ component: ScheduledTasksList })}>{translate("ScheduledTasksList")}</NavItem>}
          <NavItem onClick={() => addPane({ component: SyncDashboard, label: translate("syncOfflineData") })}>{translate("syncOfflineData")}</NavItem>
          <NavItem onClick={() => addPane({ component: OrphanRefsForm, label: translate("deletedReferenceControl") })}>{translate("deletedReferenceControl")}</NavItem>
          <NavItem onClick={() => addPane({ component: SearchReplaceRefsForm, label: translate("searchReplaceReferences") })}>{translate("searchReplaceReferences")}</NavItem>
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
          <HRGroups />
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
          <HRGroups />
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
