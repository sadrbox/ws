import React, { CSSProperties, FC, PropsWithChildren, useContext, useEffect, useState, useCallback, forwardRef, useRef, useImperativeHandle, ReactNode, ReactElement, ComponentType, Component, isValidElement, JSX, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import { createPortal } from 'react-dom';
import { ContractsList } from 'src/models/Contracts';
import { Divider } from '../Field';
// import { getTranslation } from 'src/i18';
// import { CounterpartiesList } from 'src/models/Organizations';
import { ActivityHistoriesList } from 'src/models/ActivityHistories';
// import { TComponentNode, TPane } from 'src/app/types';
import { useAppContext } from 'src/app';
import Toolbar from 'src/components/Toolbar';
import type { TPane } from 'src/app/types';
import { usePaneToolbarSlot } from 'src/hooks/usePaneToolbar';
import { ToolbarSlot } from 'src/components/Toolbar';
import { OrganizationsList } from 'src/models/Organizations';
import { BankAccountsList } from 'src/models/BankAccounts';
import { usePaneDirty, usePaneNotifications, dismissPaneNotification } from 'src/hooks/useFormStore';
import { CounterpartiesList } from 'src/models/Counterparties';
import { ContactTypesList } from 'src/models/ContactTypes';
import { ContactsList } from 'src/models/Contacts';
import { ContactPersonsList } from 'src/models/ContactPersons';
import { UsersList } from 'src/models/Users';
import { TodosList } from 'src/models/Todos';
import { NotificationsList } from 'src/models/Notifications';
import { WarehousesList } from 'src/models/Warehouses';
import { SalesList } from 'src/models/Sales';
import { SalesBoardForm } from 'src/models/Sales/SalesBoardForm';
import { PurchasesList } from 'src/models/Purchases';
import { OutgoingInvoicesList } from 'src/models/OutgoingInvoices';
import { IncomingInvoicesList } from 'src/models/IncomingInvoices';
import { PaymentInvoicesList } from 'src/models/PaymentInvoices';
import { ScheduledTasksList } from 'src/models/ScheduledTasks';
import { InventoryTransfersList } from 'src/models/InventoryTransfers';
import { CashReceiptOrdersList } from 'src/models/CashReceiptOrders';
import { CashExpenseOrdersList } from 'src/models/CashExpenseOrders';
import { BrandsList } from 'src/models/Brands';
import { ProductsList } from 'src/models/Products';
import { CurrenciesList } from 'src/models/Currencies';
import { EmployeesList } from 'src/models/Employees';
import { PositionsList } from 'src/models/Positions';
import { PayrollCalculationsList } from 'src/models/PayrollCalculations';
import { PayrollPaymentsList } from 'src/models/PayrollPayments';
import { UnsavedFormsList } from 'src/models/UnsavedForms';
import { SyncDashboard } from 'src/models/SyncDashboard';
import NotificationToast from 'src/components/NotificationToast';
import OfflineIndicator from 'src/components/OfflineIndicator';
import { getAccessLevel } from 'src/hooks/useAccessRight';
import { usePersistenceMode } from 'src/services/persistenceMode';

type TypeGroupProps = {
  align?: 'row' | 'col';
  type?: 'easy' | 'medium' | 'hard';
  label?: string;
  gap?: string;
  className?: string;
  style?: CSSProperties;
} & PropsWithChildren;

export const Group: FC<TypeGroupProps> = ({ align, gap, type, className, style, children }) => {

  let visibleType: string;
  if (type === 'easy') {
    visibleType = styles.BG_EASY;
  } else if (type === 'medium') {
    visibleType = styles.BG_MEDIUM;
  } else if (type === 'hard') {
    visibleType = styles.BG_HARD;
  } else {
    visibleType = "";
  }

  const reStyle = {
    ...({ borderRadius: '2px', paddingTop: "6px" }), ...style
  }
  return (
    <div className={className || ""} style={{
      display: 'flex', flexDirection: 'column', position: 'relative'
    }}>
      <div className={[align === 'row'
        ?
        styles.RowGroup
        :
        styles.ColGroup,
        , (visibleType && visibleType)].filter(s => s && s).join(" ")}
        style={{ ...reStyle, ...({ gap: gap ? gap : undefined }) }}
      >
        {children}
      </div>
    </div >
  );
};



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

export const Content = () => {
  const context = useAppContext();
  const isPaneShow = context.windows.panes.length > 0;

  return (
    <>
      {isPaneShow && <><PaneGroup /><PaneTab /></>}
    </>
  );
}

/** Одна вкладка — отдельный компонент, чтобы можно было использовать хук usePaneDirty */
const PaneTabItem: FC<{
  pane: { uniqId: string; label: string; isSelector?: boolean; selectorPaneId?: string };
  isActive: boolean;
  isLocked: boolean;
  onActivate: () => void;
  onClose: () => void;
}> = ({ pane, isActive, isLocked, onActivate, onClose }) => {
  const isDirty = usePaneDirty(pane.uniqId);

  return (
    <div
      className={[
        styles.PaneTab,
        isActive && styles.PaneTabActive,
        pane.isSelector && styles.PaneTabSelector,
        isLocked && styles.PaneTabDisabled,
        isDirty && styles.PaneTabDirty,
      ].filter(Boolean).join(" ")}
      onClick={isLocked ? undefined : onActivate}
      title={pane.label}
      role="tab"
      tabIndex={isLocked ? -1 : 0}
      aria-disabled={isLocked}
    >
      {!isLocked && (
        isDirty
          ? <button
              className={styles.PaneTabClose}
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              title="Закрыть"
              type="button"
            ><span className={styles.PaneTabDirtyDot} /></button>
          : <Toolbar.CloseButton
              className={styles.PaneTabCloseBtn}
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              size={14}
            />
      )}
      <span className={styles.PaneTabLabel}>{pane.isSelector && "🔍 "}{pane.label}</span>
    </div>
  );
};

export const PaneTab: FC = () => {

  const context = useAppContext();
  const panes = context?.windows.panes;
  const { activePane, setActivePane, requestClose } = context?.windows;

  // Определяем, есть ли активная selector-панель → блокировка остальных вкладок
  const selectorPane = panes.find((p) => p.isSelector);

  return (
    <div className={styles.PaneTabWrapper}>
      {panes.map(p => {
        const isLocked = !!selectorPane && !p.isSelector && p.selectorPaneId !== selectorPane.uniqId;
        return (
          <PaneTabItem
            key={`PaneTab-${p.uniqId}`}
            pane={p}
            isActive={p.uniqId === activePane}
            isLocked={isLocked}
            onActivate={() => setActivePane(p.uniqId)}
            onClose={() => requestClose(p.uniqId)}
          />
        );
      })}
    </div>
  );
};

export const PaneGroup = () => {
  const context = useAppContext();
  const { panes, activePane, requestClose } = context?.windows;

  return (
    <div className={styles.PaneGroupWrapper}>
      {panes.map(p => (
        <PaneItem key={`PaneGroup-${p.uniqId}`} pane={p} isActive={p.uniqId === activePane} onClose={() => requestClose(p.uniqId)} />
      ))}
    </div>
  )
}

/** Отдельный компонент панели — позволяет вызывать хуки */
const PaneItem: FC<{ pane: TPane; isActive: boolean; onClose: () => void }> = ({ pane: p, isActive, onClose }) => {
  const slotRef = usePaneToolbarSlot(p.uniqId);
  const isDirty = usePaneDirty(p.uniqId);
  const Component = p.component as FC<any>;

  return (
    <div className={[styles.Pane, isActive && styles.ActivePane].filter(Boolean).join(" ")}>
      <div className={styles.PaneHeaderContainer}>
        <h2
          className={[styles.PaneHeaderLabel, isDirty && styles.PaneHeaderLabelDirty].filter(Boolean).join(" ")}
          title={isDirty ? "Форма содержит несохранённые изменения" : undefined}
        >
          {p.label}
          {isDirty && <span className={styles.PaneHeaderDirtyDot} />}
        </h2>
        <div className={styles.PaneHeaderToolbar}>
          <ToolbarSlot ref={slotRef} />
          <Toolbar.CloseButton onClick={onClose} />
        </div>
      </div>
      <Component {...p} />
    </div>
  );
}

type TypeOverFormProps = PropsWithChildren<{}>;
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

  return (
    <div ref={internalRef} className={styles.Screen}>
      {children}
    </div>
  );
});

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
      title={isOF ? "Режим: Offline-First (данные кэшируются локально)" : "Режим: Транзакционный (только сервер)"}
    >
      {isOF ? "⚡ Offline" : "🔗 Online"}
    </button>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// NavbarPaneBell — колокольчик уведомлений активной панели в Navbar
// ═══════════════════════════════════════════════════════════════════════════

const NavbarPaneBell: FC = () => {
  const { windows: { activePane, addPane } } = useAppContext();
  const isDirty = usePaneDirty(activePane ?? "");
  const notifications = usePaneNotifications(activePane ?? "");
  const [showNotes, setShowNotes] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(notifications.length);
  const autoOpenRef = useRef(false);
  const hoverRef = useRef(false);

  // Закрыть попover при смене панели
  useEffect(() => { setShowNotes(false); }, [activePane]);

  // Авто-открыть попover при появлении новых уведомлений
  useEffect(() => {
    if (notifications.length > prevCountRef.current) {
      setShowNotes(true);
      autoOpenRef.current = true;
    }
    prevCountRef.current = notifications.length;
  }, [notifications.length]);

  // Авто-скрыть через 6 сек если открыт автоматически (но не пока hover)
  useEffect(() => {
    if (!showNotes || !autoOpenRef.current) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!hoverRef.current) {
          setShowNotes(false);
          autoOpenRef.current = false;
        } else {
          // Мышь на поповере — пробуем снова через 2 сек
          schedule();
        }
      }, 6000);
    };
    schedule();
    return () => { if (timer) clearTimeout(timer); };
  }, [showNotes]);

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

  const showBell = isDirty || notifications.length > 0;

  const openJournal = useCallback(() => {
    setShowNotes(false);
    addPane({ component: NotificationsList, label: "Журнал уведомлений" });
  }, [addPane]);

  if (!activePane || !showBell) return null;

  return (
    <div className={styles.PaneNoteBellWrap}>
      <button
        ref={bellRef}
        className={[styles.NavbarBellBtn, styles.PaneNoteBell].join(" ")}
        onClick={() => { autoOpenRef.current = false; setShowNotes((v) => !v); }}
        title="Уведомления активной панели"
        type="button"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1.5a4 4 0 0 0-4 4v2.7L2.7 10.5a.75.75 0 0 0 .53 1.28h9.54a.75.75 0 0 0 .53-1.28L12 8.2V5.5a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        </svg>
        {notifications.length > 0 && (
          <span className={styles.PaneNoteBadge}>{notifications.length}</span>
        )}
      </button>
      {showNotes && (
        <div
          ref={popoverRef}
          className={styles.PaneNotePopover}
          onMouseEnter={() => { hoverRef.current = true; }}
          onMouseLeave={() => { hoverRef.current = false; }}
        >
          <div className={styles.PaneNotePopoverHeader}>
            <span>Состояние формы</span>
            <button className={styles.PaneNoteJournalLink} onClick={openJournal} type="button">
              Журнал ➜
            </button>
          </div>
          {notifications.map((n) => (
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
                {n.actions && n.actions.length > 0 && !n.resolved && (
                  <span className={styles.PaneNoteActions}>
                    {n.actions.map((a, i) => (
                      <button
                        key={i}
                        className={styles.PaneNoteActionBtn}
                        type="button"
                        onClick={() => {
                          a.onClick();
                          dismissPaneNotification(activePane, n.id);
                        }}
                      >{a.label}</button>
                    ))}
                  </span>
                )}
              </span>
              <button
                className={styles.PaneNoteDismiss}
                onClick={() => dismissPaneNotification(activePane, n.id)}
                title="Скрыть"
                type="button"
              >✕</button>
            </div>
          ))}
          {!isDirty && notifications.length === 0 && (
            <div className={[styles.PaneNoteItem, styles.PaneNoteInfo].join(" ")}>
              <span className={styles.PaneNoteIcon}>✅</span>
              <span className={styles.PaneNoteText}>Нет уведомлений.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const Navbar: React.FC = () => {
  const context = useAppContext();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const { props, setProps } = context?.navbar;
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
          aria-label="Меню"
          type="button"
        >
          <span />
        </button>

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
          <PersistenceModeToggle />
          <NavbarPaneBell />
          <OfflineIndicator />
          <NotificationToast />
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
              title="Выйти из системы"
            >
              Выход
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
  const rights = user?.accessRights ?? user?.employee?.accessRights ?? [];
  const isSuperAdmin = user?.isSuperAdmin;

  /** Проверяет, имеет ли пользователь хотя бы readonly доступ к модели */
  const can = (modelName: string) => getAccessLevel(rights, modelName, isSuperAdmin).canRead;

  if (label.toLocaleLowerCase() === "Trade".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>Торговля</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>Продажи</h3>
            <ul className={styles.NavList}>
              {can("Sale") && <li onClick={() => addPane({ component: SalesBoardForm, label: 'Рабочий стол продаж' })}>Рабочий стол продаж</li>}
              {can("Sale") && <li onClick={() => addPane({ component: SalesList })}>Реализация товара и услуг</li>}
              {can("OutgoingInvoice") && <li onClick={() => addPane({ component: OutgoingInvoicesList })}>Электронная счет-фактура (исходящие)</li>}
              {can("PaymentInvoice") && <li onClick={() => addPane({ component: PaymentInvoicesList })}>Счет на оплату</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Закупка</h3>
            <ul className={styles.NavList}>
              {can("Purchase") && <li onClick={() => addPane({ component: PurchasesList })}>Поступление товара и услуг</li>}
              {can("IncomingInvoice") && <li onClick={() => addPane({ component: IncomingInvoicesList })}>Электронная счет-фактура (входящие)</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Склад</h3>
            <ul className={styles.NavList}>
              {can("Warehouse") && <li onClick={() => addPane({ component: WarehousesList })}>Склады</li>}
              {can("InventoryTransfer") && <li onClick={() => addPane({ component: InventoryTransfersList })}>Перемещение ТМЗ</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Касса</h3>
            <ul className={styles.NavList}>
              {can("CashReceiptOrder") && <li onClick={() => addPane({ component: CashReceiptOrdersList })}>Приходный кассовый ордер</li>}
              {can("CashExpenseOrder") && <li onClick={() => addPane({ component: CashExpenseOrdersList })}>Расходный кассовый ордер</li>}
            </ul>
          </div>
        </div>
      </div>
    )
  } else if (label.toLocaleLowerCase() === "HR".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>Кадровый учёт</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>Документы</h3>
            <ul className={styles.NavList}>
              {can("PayrollCalculation") && <li onClick={() => addPane({ component: PayrollCalculationsList })}>Начисление заработной платы</li>}
              {can("PayrollPayment") && <li onClick={() => addPane({ component: PayrollPaymentsList })}>Выплата заработной платы</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Справочники</h3>
            <ul className={styles.NavList}>
              {can("Employee") && <li onClick={() => addPane({ component: EmployeesList })}>Сотрудники</li>}
              {can("Position") && <li onClick={() => addPane({ component: PositionsList })}>Должности</li>}
            </ul>
          </div>
        </div>
      </div>
    )
  } else if (label.toLocaleLowerCase() === "CRM".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>CRM</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>Управление задачами</h3>
            <ul className={styles.NavList}>
              {can("Todo") && <li onClick={() => addPane({ component: TodosList })}>Задачи</li>}
              {can("ScheduledTask") && <li onClick={() => addPane({ component: ScheduledTasksList })}>Регламентные задачи</li>}
            </ul>
          </div>
        </div>
      </div>
    )
  } else if (label.toLocaleLowerCase() === "Settings".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>Настройки</h1>
        <div className={styles.NavSection}>
          <div className={styles.NavGroup}>
            <h3>Справочники</h3>
            <ul className={styles.NavList}>
              {can("Organization") && <li onClick={() => addPane({ component: OrganizationsList })}>Организации</li>}
              {can("Counterparty") && <li onClick={() => addPane({ component: CounterpartiesList })}>Контрагенты</li>}
              {can("Contract") && <li onClick={() => addPane({ component: ContractsList })}>Договора</li>}
              {can("BankAccount") && <li onClick={() => addPane({ component: BankAccountsList })}>Банковские счета</li>}
              {can("ContactType") && <li onClick={() => addPane({ component: ContactTypesList })}>Типы контактов</li>}
              {can("Contact") && <li onClick={() => addPane({ component: ContactsList })}>Контакты</li>}
              {can("ContactPerson") && <li onClick={() => addPane({ component: ContactPersonsList })}>Контактные лица</li>}
              {can("Product") && <li onClick={() => addPane({ component: ProductsList })}>Номенклатура</li>}
              {can("Brand") && <li onClick={() => addPane({ component: BrandsList })}>Бренды</li>}
              {can("Currency") && <li onClick={() => addPane({ component: CurrenciesList })}>Валюты</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Администрирование</h3>
            <ul className={styles.NavList}>
              {can("User") && <li onClick={() => addPane({ component: UsersList })}>Пользователи</li>}
              {can("ActivityHistory") && <li onClick={() => addPane({ component: ActivityHistoriesList })}>История активности</li>}
              {can("Notification") && <li onClick={() => addPane({ component: NotificationsList, label: "Журнал уведомлений" })}>Журнал уведомлений</li>}
              <li onClick={() => addPane({ component: UnsavedFormsList })}>Несохранённые записи</li>
              <li onClick={() => addPane({ component: SyncDashboard, label: 'Синхронизация и оффлайн-данные' })}>Синхронизация и оффлайн-данные</li>
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
      <span className="ml-3 text-lg">Загрузка...</span>
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