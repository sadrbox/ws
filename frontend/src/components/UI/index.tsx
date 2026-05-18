import React, { CSSProperties, FC, PropsWithChildren, useEffect, useState, useCallback, useMemo, forwardRef, useRef, useImperativeHandle, ReactNode, Component, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import modalManager from 'src/components/Modal/modalManager';
import { createPortal } from 'react-dom';
import { ContractsList } from 'src/models/Contracts';
// Divider is imported in components that use it; not used here
import { translate } from 'src/i18';
// import { CounterpartiesList } from 'src/models/Organizations';
import { ActivityHistoriesList } from 'src/models/ActivityHistories';
// import { TComponentNode, TPane } from 'src/app/types';
import { useAppContext } from 'src/app/context';
import { ReloadButton, CloseButton, DirtyButton, IconButton } from 'src/components/Toolbar';
import type { TPane } from 'src/app/types';
import { usePaneToolbarSlot, useHasToolbar, usePaneHeaderActionsSlot } from 'src/hooks/usePaneToolbar';
import { ToolbarSlot } from 'src/components/Toolbar';
import { OrganizationsList } from 'src/models/Organizations';
import { BankAccountsList } from 'src/models/BankAccounts';
import { usePaneDirty, usePaneDirtyDiff, usePaneNotifications, dismissPaneNotification, usePaneHasPendingStash, applyPaneStash, setPaneShowDiff, usePaneShowDiff } from 'src/hooks/useFormStore';
import { PaneScopeProvider } from 'src/hooks/useDirtyHighlight';
import { CounterpartiesList } from 'src/models/Counterparties';
import { ContactTypesList } from 'src/models/ContactTypes';
import { ContactsList } from 'src/models/Contacts';
import { ContactPersonsList } from 'src/models/ContactPersons';
import { UsersList } from 'src/models/Users';
import { TodosList } from 'src/models/Todos';
import { NotificationsList } from 'src/models/Notifications';
import { WarehousesList } from 'src/models/Warehouses';
import { SalesList } from 'src/models/Sales';
// import { SalesBoardForm } from 'src/models/Sales/SalesBoardForm';
import { PurchasesList } from 'src/models/Purchases';
import { OutgoingInvoicesList } from 'src/models/OutgoingInvoices';
import { IncomingInvoicesList } from 'src/models/IncomingInvoices';
import { PaymentInvoicesList } from 'src/models/PaymentInvoices';
import { ScheduledTasksList } from 'src/models/ScheduledTasks';
import OrgSwitcher from 'src/components/OrgSwitcher';
import { InventoryTransfersList } from 'src/models/InventoryTransfers';
import { CashReceiptOrdersList } from 'src/models/CashReceiptOrders';
import { CashExpenseOrdersList } from 'src/models/CashExpenseOrders';
import { BrandsList } from 'src/models/Brands';
import { ProductsList } from 'src/models/Products';
import { UnitOfMeasuresList } from 'src/models/UnitOfMeasures';
import { TaxesList } from 'src/models/Taxes';
import { OrganizationAccountingSettingsList } from 'src/models/OrganizationAccountingSettings';
import { CurrenciesList } from 'src/models/Currencies';
import { EmployeesList } from 'src/models/Employees';
import { PositionsList } from 'src/models/Positions';
import { PayrollCalculationsList } from 'src/models/PayrollCalculations';
import { PayrollPaymentsList } from 'src/models/PayrollPayments';
import { UnsavedFormsList } from 'src/models/UnsavedForms';
import { SyncDashboard } from 'src/models/SyncDashboard';
// AccessRightsModuleList загружается динамически (разрыв цикла UI→AccessRights→app→UI)
import NotificationToast from 'src/components/NotificationToast';
import OfflineIndicator from 'src/components/OfflineIndicator';
import UIToast from 'src/components/UIToast';
import { getAccessLevel } from 'src/hooks/useAccessRight';
import { usePersistenceMode } from 'src/services/persistenceMode';
// import { usePaneDirty, usePaneNotifications, dismissPaneNotification, usePaneReload } from 'src/hooks/useFormStore';

type TypeGroupProps = {
  align?: 'row' | 'col';
  type?: 'easy' | 'medium' | 'hard';
  label?: string;
  gap?: string;
  className?: string;
  style?: CSSProperties;
} & PropsWithChildren;

export const Group: FC<TypeGroupProps> = ({ style, children }) => <div style={style} className={[styles.Group, styles.gap12].filter(Boolean).join(" ")}>{children}</div>

export const GroupRow: FC<TypeGroupProps> = ({ style, children }) => <div style={style} className={[styles.GroupRow, styles.gap12].filter(Boolean).join(" ")}>{children}</div>
export const GroupCol: FC<TypeGroupProps> = ({ style, children }) => <div style={style} className={[styles.GroupCol, styles.gap12].filter(Boolean).join(" ")}>{children}</div>


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

/** Одна вкладка — отдельный компонент, чтобы можно было использовать хук usePaneDirty */
const PaneTabItem: FC<{
  pane: { uniqId: string; label: string; isSelector?: boolean; selectorPaneId?: string };
  isActive: boolean;
  isLocked: boolean;
  onActivate: () => void;
  onClose: () => void;
}> = ({ pane, isActive, isLocked, onActivate, onClose }) => {
  const isDirty = usePaneDirty(pane.uniqId);
  const hasStash = usePaneHasPendingStash(pane.uniqId);
  const showDirtyDot = isDirty || hasStash;

  return (
    <div
      className={[
        styles.PaneTabItem,
        isActive && styles.PaneTabItemActive,
        pane.isSelector && styles.PaneTabItemSelector,
        isLocked && styles.PaneTabItemDisabled,
        showDirtyDot && styles.PaneTabItemDirty,
      ].filter(Boolean).join(" ")}
      onClick={isLocked ? undefined : onActivate}
      title={pane.label + (isDirty ? " · есть несохранённые изменения" : hasStash ? " · есть данные прошлой сессии" : "")}
      role="tab"
      tabIndex={isLocked ? -1 : 0}
      aria-disabled={isLocked}
    >
      {showDirtyDot && (
        <span
          className={hasStash ? styles.PaneTabItemDirtyDotStash : styles.PaneTabItemDirtyDot}
          aria-label={isDirty ? "Несохранённые изменения" : "Данные прошлой сессии"}
        />
      )}
      <span className={styles.PaneTabItemLabel}>{pane.isSelector && "🔍 "}{pane.label}</span>
      {!isLocked && (
        <IconButton
          icon="close"
          size="sm"
          className={styles.PaneTabItemClose}
          aria-label="Закрыть"
          title="Закрыть"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        />
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

  return (
    <div className={styles.PanesTabs}>
      {panes.map(p => {
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
  const isDirty = usePaneDirty(p.uniqId);
  const dirtyDiff = usePaneDirtyDiff(p.uniqId);
  const hasStash = usePaneHasPendingStash(p.uniqId);
  const hasToolbar = useHasToolbar(p.uniqId);
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

  // Кнопка Dirty: показывается ТОЛЬКО когда есть смысл — есть несохранённые
  // изменения в текущей сессии (isDirty) или stash из прошлой сессии.
  // В «чистом» состоянии кнопка не нужна: освежить данные с сервера можно
  // через отдельную кнопку «Обновить», а тоггл подсветки расхождений
  // подсвечивать тоже нечего.
  // При наличии stash — пульсирует, по клику восстанавливает данные.
  // При isDirty — работает как ТОГГЛ подсветки расхождений
  // (аналогично кнопке «Редактирование в таблице»).
  const showDirtyButton = hasToolbar && (isDirty || hasStash);
  const dirtyButtonClass = hasStash
    ? styles.PaneItemHeaderDirtyButtonStash
    : styles.PaneItemHeaderDirtyButton;

  // Подсветка расхождений: реактивный флаг на панели. Управляется кликом
  // по DirtyButton (тоггл). При наведении мышью на саму кнопку даём
  // временный предпросмотр — но клик «защёлкивает» состояние.
  const showDiff = usePaneShowDiff(p.uniqId);
  const handleDirtyClick = useCallback(() => {
    if (hasStash) {
      applyPaneStash(p.uniqId);
      return;
    }
    setPaneShowDiff(p.uniqId, !showDiff);
  }, [hasStash, p.uniqId, showDiff]);
  // При размонтировании Pane сбрасываем флаг.
  useEffect(() => () => setPaneShowDiff(p.uniqId, false), [p.uniqId]);
  // Если форма стала чистой (после save / undo / ручного отката) — гасим
  // подсветку: иначе на disabled-кнопке остаётся «active»-стиль, а на Pane
  // — атрибут data-pane-show-diff="true", хотя подсвечивать уже нечего.
  useEffect(() => {
    if (!isDirty && !hasStash && showDiff) {
      setPaneShowDiff(p.uniqId, false);
    }
  }, [isDirty, hasStash, showDiff, p.uniqId]);

  // Детальный tooltip для кнопки Dirty: показывает список изменённых полей
  // в формате "Поле: 'старое' → 'новое'". Для вложенных таблиц — количество правок.
  // Нативный title поддерживает \n для переноса строк.
  const dirtyButtonTitle = useMemo(() => {
    if (hasStash) {
      return "Восстановить данные из прошлой сессии";
    }
    if (!isDirty) {
      return "Форма не содержит несохранённых изменений";
    }
    return showDiff
      ? "Скрыть подсветку несохранённых изменений"
      : "Показать подсветку несохранённых изменений";
  }, [hasStash, isDirty, showDiff]);

  return (
    <div
      ref={paneRootRef}
      className={[styles.PaneItem, isActive && styles.PaneItemActive].filter(Boolean).join(" ")}
      data-pane-show-diff={showDiff ? "true" : undefined}
    >
      <div className={styles.PaneItemHeader}>
        <h2 className={styles.PaneItemHeaderLabel}>
          {p.label}
          {(isDirty || hasStash) && (
            <span
              className={hasStash ? styles.PaneItemHeaderDirtyDotStash : styles.PaneItemHeaderDirtyDot}
              aria-label={isDirty ? "Несохранённые изменения" : "Данные прошлой сессии"}
              title={hasStash
                ? "Есть несохранённые данные из прошлой сессии"
                : "Форма содержит несохранённые изменения"}
            />
          )}
        </h2>
        <div className={styles.PaneItemHeaderToolbar}>
          {/* Слот для дополнительных кнопок от конкретной формы (напр. «Печать»).
              Регистрируются через usePaneHeaderActions(paneId, <…/>). */}
          <div ref={headerSlot} className={styles.PaneItemHeaderActionsSlot} />
          {showDirtyButton && (
            <DirtyButton
              onClick={handleDirtyClick}
              active={showDiff}
              className={dirtyButtonClass}
              title={dirtyButtonTitle}
            />
          )}
          {hasToolbar && <ReloadButton onClick={onReload} />}
          <CloseButton onClick={onClose} />
        </div>
      </div>
      <PaneScopeProvider paneId={p.uniqId}>
        <Component {...p} />
      </PaneScopeProvider>
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

  // Колокольчик теперь отвечает ТОЛЬКО за обычные уведомления; индикация
  // несохранённых изменений вынесена в DirtyButton (PaneItemHeaderToolbar).
  const showBell = notifications.length > 0;

  const openJournal = useCallback(() => {
    setShowNotes(false);
    addPane({ component: NotificationsList, label: "Центр уведомлений" });
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
            <span>Уведомления</span>
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
                          void a.onClick();
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
        </div>
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
          <div className={styles.NavGroup}>
            <h3>Справочники</h3>
            <ul className={styles.NavList}>
              {can("Product") && <li onClick={() => addPane({ component: ProductsList })}>Номенклатура</li>}
              {can("Brand") && <li onClick={() => addPane({ component: BrandsList })}>Бренды</li>}
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
              {can("Currency") && <li onClick={() => addPane({ component: CurrenciesList })}>Валюты</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Учёт</h3>
            <ul className={styles.NavList}>
              {can("OrganizationAccountingSetting") && <li onClick={() => addPane({ component: OrganizationAccountingSettingsList })}>Настройки учёта организации</li>}
              {can("UnitOfMeasure") && <li onClick={() => addPane({ component: UnitOfMeasuresList })}>Единицы измерения</li>}
              {can("Tax") && <li onClick={() => addPane({ component: TaxesList })}>Налоги</li>}
            </ul>
          </div>
          <div className={styles.NavGroup}>
            <h3>Администрирование</h3>
            <ul className={styles.NavList}>
              {can("User") && <li onClick={() => addPane({ component: UsersList })}>Пользователи</li>}
              {can("AccessRight") && <li onClick={async () => { const m = await import("src/models/UserPermissions"); addPane({ component: m.UserPermissionsModuleList, label: "Права пользователей" }); }}>Права пользователей</li>}
              {can("AccessRight") && <li onClick={async () => { const m = await import("src/models/AccessRights"); addPane({ component: m.AccessRightsList, label: "Права доступа" }); }}>Права доступа</li>}
              {can("ActivityHistory") && <li onClick={() => addPane({ component: ActivityHistoriesList })}>История активности</li>}
              {can("Notification") && <li onClick={() => addPane({ component: NotificationsList, label: "Центр уведомлений" })}>Центр уведомлений</li>}
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
