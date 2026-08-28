// Navbar + его переключатели (язык/тема/режим хранения) и колокол уведомлений.
// Вынесено из UI/index.tsx (Q9).
import { FC, useCallback, useEffect, useRef, useState } from "react";
import styles from "../../styles/main.module.scss";
import { createPortal } from 'react-dom';
import { translate, getLanguage, setLanguage } from 'src/i18';
import { getEffectiveTheme, toggleTheme } from 'src/services/theme';
import { useAppContext } from 'src/app/context';
import { useAllPaneNotifications, dismissPaneNotification } from 'src/hooks/useFormStore';
import { openFormByRef, canOpenByRef } from 'src/utils/openFormByRef';
import OrgSwitcher from 'src/components/OrgSwitcher';
import NotificationToast from 'src/components/NotificationToast';
import OfflineIndicator from 'src/components/OfflineIndicator';
import { NotificationsList } from "src/registry/viewRegistry";
import { usePersistenceMode } from 'src/services/persistenceMode';

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
export const ThemeSwitcher: FC = () => {
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
          {/* Тумблер тёмной темы (E5, OPT-IN). Раскрыт после миграции хардкод-цветов
              module.scss на токены (var(--…)) — светлая тема инвариантна, тёмная берёт
              выверенные dark-значения из index.html. По умолчанию светлая; тёмная — по
              явному выбору. Единичные декоративные цвета (акцент-кнопки) остаются как есть. */}
          <ThemeSwitcher />
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
