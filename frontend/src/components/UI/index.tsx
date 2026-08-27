import React, { CSSProperties, FC, PropsWithChildren, useEffect, useLayoutEffect, useState, useCallback, useMemo, forwardRef, useRef, useImperativeHandle, ReactNode, Component, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import modalManager from 'src/components/Modal/modalManager';
import { createPortal } from 'react-dom';
// Divider is imported in components that use it; not used here
import { translate } from 'src/i18';
import { useAppContext } from 'src/app/context';
import { ReloadButton, CloseButton, IconButton } from 'src/components/Toolbar';
import { copyPaneLink } from "src/utils/paneLink";
import type { TPane } from 'src/app/types';
import { usePaneToolbarSlot, useHasToolbar, usePaneHeaderActionsSlot } from 'src/hooks/usePaneToolbar';
import { ToolbarSlot } from 'src/components/Toolbar';
import { usePaneIsDirty, usePaneIsEditMode } from 'src/hooks/useFormStore';

// ── Ленивая загрузка моделей (code-split) ─────────────────────────────────────
// Статические импорты моделей убраны: иначе они все попадали в основной бандл и
// динамические import() в registry/openFormByRef/openReport не давали code-split
// (Vite: "dynamic import will not move module into another chunk"). displayName
// ОБЯЗАТЕЛЕН — по нему дедуплицируются панели (getComponentName в app/index.tsx).
// Рендерятся внутри <React.Suspense> (см. app/index.tsx).
// AccessRightsModuleList/AccessPermissionsList загружаются динамически (разрыв цикла UI→models→app→UI)
import UIToast from 'src/components/UIToast';


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
// uniqId вкладок, у которых enter-анимация уже проигралась. Enter должен запускаться
// РОВНО ОДИН РАЗ при реальном добавлении вкладки — не при перерисовке className
// (смена active) и не при кратковременном re-mount из-за пересчёта видимых вкладок
// после закрытия соседа. Освобождается с задержкой при размонтировании (быстрый
// churn-remount не переиграет enter, осознанное переоткрытие позже — переиграет).
const paneTabEntered = new Set<string>();

const PaneTabItem: FC<{
  pane: { uniqId: string; label: string; isSelector?: boolean; selectorPaneId?: string };
  isActive: boolean;
  isLocked: boolean;
  onActivate: () => void;
  onClose: () => void;
}> = ({ pane, isActive, isLocked, onActivate, onClose }) => {
  // Появление: одноразовый класс .PaneTabItemEntering (снимается после проигрыша).
  const [entering, setEntering] = useState(() => {
    if (paneTabEntered.has(pane.uniqId)) return false;
    paneTabEntered.add(pane.uniqId);
    return true;
  });
  useEffect(() => {
    if (!entering) return;
    const t = window.setTimeout(() => setEntering(false), 400);
    return () => window.clearTimeout(t);
  }, [entering]);
  useEffect(() => {
    const uid = pane.uniqId;
    return () => { window.setTimeout(() => paneTabEntered.delete(uid), 800); };
  }, [pane.uniqId]);

  // Анимация закрытия: exit-эффектом и удалением панели централизованно управляет
  // requestClose (см. app/index.tsx) — он шлёт "pane-closing", ждёт длительность
  // и удаляет панель. Здесь лишь навешиваем .PaneTabItemClosing по этому событию,
  // чтобы вкладка проиграла exit НЕЗАВИСИМО от способа закрытия (× вкладки, кнопка
  // «Закрыть» в шапке, ToolbarSlot и т.д.). Кнопка × просто зовёт onClose=requestClose.
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const onClosing = (e: Event) => {
      if ((e as CustomEvent<{ uniqId?: string }>).detail?.uniqId === pane.uniqId) setClosing(true);
    };
    window.addEventListener("pane-closing", onClosing);
    return () => window.removeEventListener("pane-closing", onClosing);
  }, [pane.uniqId]);

  return (
    <div
      className={[
        styles.PaneTabItem,
        isActive && styles.PaneTabItemActive,
        pane.isSelector && styles.PaneTabItemSelector,
        isLocked && styles.PaneTabItemDisabled,
        entering && styles.PaneTabItemEntering,
        closing && styles.PaneTabItemClosing,
      ].filter(Boolean).join(" ")}
      onClick={isLocked || closing ? undefined : onActivate}
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

  // ── Анимация Pane (best practice: только «появление» активной панели) ─────
  // При открытии/переключении/после закрытия соседа активная панель мягко
  // проявляется (opacity + лёгкий сдвиг, GPU-friendly — без filter:blur и оверлеев).
  // ВЫХОДА у контента нет: закрывающаяся панель просто скрывается, а следующую
  // активируют сразу (requestClose) → пустого фона/мерцания нет. Настройки — в :root.
  // useLayoutEffect: класс показа навешиваем СИНХРОННО до отрисовки — иначе панель
  // на 1 кадр мелькнёт в полной непрозрачности.
  const [revealing, setRevealing] = useState(isActive);
  const prevActiveRef = useRef(isActive);
  useLayoutEffect(() => {
    const was = prevActiveRef.current;
    prevActiveRef.current = isActive;
    if (isActive && !was) setRevealing(true);
  }, [isActive]);
  // Снимаем класс после проигрыша: по animationend + страховка таймаутом (reduced-motion),
  // чтобы следующая активация могла ПЕРЕИГРАТЬ показ.
  useEffect(() => {
    if (!revealing) return;
    const t = window.setTimeout(() => setRevealing(false), 1000);
    return () => window.clearTimeout(t);
  }, [revealing]);
  const handleAnimationEnd = useCallback((e: React.AnimationEvent<HTMLDivElement>) => {
    if (revealing && e.target === e.currentTarget) setRevealing(false);
  }, [revealing]);
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
      className={[
        styles.PaneItem,
        isActive && styles.PaneItemActive,
        revealing && styles.PaneItemEntering,
      ].filter(Boolean).join(" ")}
      onAnimationEnd={handleAnimationEnd}
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
          <CloseButton onClick={onClose} />
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
export { Navbar } from "./Navbar";
export { NavList } from "./NavList";
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
      const err = this.state.error;
      // В релизном бандле Tauri консоль недоступна — показываем реальную ошибку
      // на экране под фолбэком, чтобы её можно было диагностировать без DevTools.
      return (
        <div>
          {this.props.fallback}
          {err && (
            <details style={{ margin: "12px", fontFamily: "monospace", fontSize: "12px", whiteSpace: "pre-wrap", opacity: 0.85 }}>
              <summary style={{ cursor: "pointer" }}>Детали ошибки</summary>
              <div style={{ marginTop: 8, color: "#b00020" }}>{String(err.message || err)}</div>
              {err.stack && <pre style={{ overflow: "auto", maxHeight: "50vh" }}>{err.stack}</pre>}
            </details>
          )}
        </div>
      );
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
  const reloadPane = (ctx?.windows as { reloadPane?: (uniqId: string) => void })?.reloadPane;

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
