import React, { CSSProperties, FC, PropsWithChildren, useContext, useEffect, useState, forwardRef, useRef, useImperativeHandle, ReactNode, ReactElement, ComponentType, Component, isValidElement, JSX, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import { createPortal } from 'react-dom';
import { ContractsList } from 'src/models/Contracts';
import { Divider } from '../Field';
// import { getTranslation } from 'src/i18';
// import { CounterpartiesList } from 'src/models/Organizations';
import { ActivityHistoriesList } from 'src/models/ActivityHistories';
// import { TComponentNode, TPane } from 'src/app/types';
import { useAppContext } from 'src/app';
import { OrganizationsList } from 'src/models/Organizations';
import { BankAccountsList } from 'src/models/BankAccounts';
import { usePaneDirty } from 'src/hooks/useFormStore';
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
import { UnsavedFormsList } from 'src/models/UnsavedForms';
import NotificationToast from 'src/components/NotificationToast';
import OfflineIndicator from 'src/components/OfflineIndicator';
import { getAccessLevel } from 'src/hooks/useAccessRight';

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
        <button
          className={styles.PaneTabClose}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Закрыть"
          type="button"
        >{isDirty ? <span className={styles.PaneTabDirtyDot} /> : "✕"}</button>
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
      {panes.map(p => {
        const Component = p.component as FC<any>;
        // console.log(p.uniqId)
        return (
          <div key={`PaneGroup-${p.uniqId}`}
            className={[styles.Pane, (p.uniqId === activePane) && styles.ActivePane].join(" ")}>
            <div className={styles.PaneHeaderContainer} >
              {/* <Divider /> */}
              <h2 className={styles.PaneHeaderLabel}>{p.label}</h2>
              <button
                className={styles.PaneHeaderClose}
                onClick={() => requestClose(p.uniqId)}
                title="Закрыть"
                type="button"
              >✕</button>
            </div>
            <Component {...p} />
          </div>
        )
      })}
    </div>
  )
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



export const Navbar: React.FC = () => {
  const context = useAppContext();

  const { props, setProps } = context?.navbar;
  const activeNav = props.find(nav => nav.isActive);
  // const [navs, setNavs] = useState(items);
  // const [activeNav, setActiveNav] = useState(items[0]);

  // const setActive = (id: string) => {
  //   setProps(prev => prev.map(nav => ({ ...nav, isActive: nav.id === id })))
  //   // setActiveNav(items.find(nav => nav.id === id) ?? items[0])
  // }

  const toggleNav = (id: string) => {
    setProps(prev => prev.map(n =>
      n.id === id
        ? { ...n, isActive: !n.isActive }
        : { ...n, isActive: false }
    ))
  }

  return (
    <>
      <div className={styles.NavbarWrapper}>
        {props.map(nav => (
          <a key={nav.id} href="#"
            onClick={() => toggleNav(nav.id)}
            className={[styles.NavbarItem, nav.isActive && styles.Active].join(" ")}>
            {nav.title}
          </a>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px", marginRight: "12px" }}>
          <OfflineIndicator />
          <NotificationToast />
          {context.auth?.user && (
            <span style={{ fontSize: "12px", color: "#666", whiteSpace: "nowrap" }}>
              {context.auth.user.employee?.fullName || context.auth.user.username}
            </span>
          )}
          {context.auth?.logout && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); context.auth.logout(); }}
              style={{ fontSize: "12px", color: "#888", whiteSpace: "nowrap", textDecoration: "none" }}
              title="Выйти из системы"
            >
              Выход
            </a>
          )}
        </div>
      </div>
      {activeNav && <div className={styles.NavbarOverlayWrapper}>{activeNav?.component}</div>}
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

  if (label.toLocaleLowerCase() === "Operations".toLocaleLowerCase()) {
    return (
      <div className={styles.NavListWrapper}>
        <h1>Операционная деятельность</h1>
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
            <h3>Справочники</h3>
            <ul className={styles.NavList}>
              {can("Warehouse") && <li onClick={() => addPane({ component: WarehousesList })}>Склады</li>}
              {can("Organization") && <li onClick={() => addPane({ component: OrganizationsList })}>Организации</li>}
              {can("Counterparty") && <li onClick={() => addPane({ component: CounterpartiesList })}>Контрагенты</li>}
              {can("Contract") && <li onClick={() => addPane({ component: ContractsList })}>Договора</li>}
              {can("BankAccount") && <li onClick={() => addPane({ component: BankAccountsList })}>Банковские счета</li>}
              {can("ContactPerson") && <li onClick={() => addPane({ component: ContactPersonsList })}>Контактные лица</li>}
              {can("Product") && <li onClick={() => addPane({ component: ProductsList })}>Номенклатура</li>}
              {can("Brand") && <li onClick={() => addPane({ component: BrandsList })}>Бренды</li>}
              {can("Currency") && <li onClick={() => addPane({ component: CurrenciesList })}>Валюты</li>}
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
          <div className={styles.NavGroup}>
            <h3>Справочники</h3>
            <ul className={styles.NavList}>
              {can("Sale") && <li onClick={() => addPane({ component: SalesList })}>Реализация товара и услуг</li>}
              {can("Purchase") && <li onClick={() => addPane({ component: PurchasesList })}>Поступление товара и услуг</li>}
              {can("InventoryTransfer") && <li onClick={() => addPane({ component: InventoryTransfersList })}>Перемещение ТМЗ</li>}
              {can("CashReceiptOrder") && <li onClick={() => addPane({ component: CashReceiptOrdersList })}>Приходный кассовый ордер</li>}
              {can("CashExpenseOrder") && <li onClick={() => addPane({ component: CashExpenseOrdersList })}>Расходный кассовый ордер</li>}
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
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Администрирование</h3>
            <ul className={styles.NavList}>
              {can("User") && <li onClick={() => addPane({ component: UsersList })}>Пользователи</li>}
              {can("ActivityHistory") && <li onClick={() => addPane({ component: ActivityHistoriesList })}>История активности</li>}
              {can("Notification") && <li onClick={() => addPane({ component: NotificationsList })}>Уведомления</li>}
              <li onClick={() => addPane({ component: UnsavedFormsList })}>Несохранённые записи</li>
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