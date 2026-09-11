// Navbar + его переключатели (язык/тема/режим хранения) и колокол уведомлений.
// Вынесено из UI/index.tsx (Q9).
import { FC, useCallback, useEffect, useRef, useState } from "react";
import styles from "../../styles/main.module.scss";
import { translate, getLanguage, setLanguage } from 'src/i18';
import { getEffectiveTheme, toggleTheme } from 'src/services/theme';
import { useAppContext } from 'src/app/context';
import {
  useActiveNoticeCount, setTechMessagesOpen, useTechMessagesOpen,
} from 'src/components/TechMessages/store';
import OrgSwitcher from 'src/components/OrgSwitcher';
import OfflineIndicator from 'src/components/OfflineIndicator';
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
// Колокольчик технических сообщений — ОДИН на всё приложение.
//
// Их было два: этот показывал уведомления панелей своим всплывающим списком, соседний —
// журнал в localStorage своим. Плюс пейн «Центр уведомлений» и `<Notice />` внутри форм:
// четыре поверхности об одном и том же. Теперь колокольчик ничего не показывает сам — он
// раскрывает область «Технические сообщения» справа, где список один и тот же.
//
// Всплывающего списка здесь больше нет намеренно: он повторял бы область, стоящую рядом,
// и отвечал бы на тот же вопрос по-своему. Счётчик остался — по нему и решают, открывать.
// ═══════════════════════════════════════════════════════════════════════════
const NavbarPaneBell: FC = () => {
  const open = useTechMessagesOpen();
  const active = useActiveNoticeCount();

  return (
    <button
      className={[styles.NavbarBellBtn, styles.PaneNoteBell].join(" ")}
      onClick={() => setTechMessagesOpen(!open)}
      title={`${translate("techMessages")}${active ? `: ${active}` : ""}`}
      aria-pressed={open}
      type="button"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1.5a4 4 0 0 0-4 4v2.7L2.7 10.5a.75.75 0 0 0 .53 1.28h9.54a.75.75 0 0 0 .53-1.28L12 8.2V5.5a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
        <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      </svg>
      {active > 0 && <span className={styles.PaneNoteBadge}>{active}</span>}
    </button>
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
