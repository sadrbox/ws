import React, { CSSProperties, FC, PropsWithChildren, useEffect, useLayoutEffect, useState, useCallback, forwardRef, useRef, useImperativeHandle, ReactNode, Component, ErrorInfo } from 'react';
import styles from "../../styles/main.module.scss"
import modalManager from 'src/components/Modal/modalManager';
import { createPortal } from 'react-dom';
// Divider is imported in components that use it; not used here
import { translate } from 'src/i18';
import { useAppContext } from 'src/app/context';
import { ReloadButton, CloseButton, IconButton } from 'src/components/Toolbar';
import { ToolbarSlot } from 'src/components/Toolbar';
import { copyPaneLink } from "src/utils/paneLink";
import type { TPane } from 'src/app/types';
import { usePaneToolbarSlot, useHasToolbar, usePaneHeaderActionsSlot } from 'src/hooks/usePaneToolbar';
import { usePaneIsDirty, usePaneIsEditMode } from 'src/hooks/useFormStore';

// ── Ленивая загрузка моделей (code-split) ─────────────────────────────────────
// Статические импорты моделей убраны: иначе они все попадали в основной бандл и
// динамические import() в registry/openFormByRef/openReport не давали code-split
// (Vite: "dynamic import will not move module into another chunk"). displayName
// ОБЯЗАТЕЛЕН — по нему дедуплицируются панели (getComponentName в app/index.tsx).
// Рендерятся внутри <React.Suspense> (см. app/index.tsx).
// AccessRightsModuleList/AccessPermissionsList загружаются динамически (разрыв цикла UI→models→app→UI)
import UIToast from 'src/components/UIToast';
import { PanesTabs } from "./PanesTabs";


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


export { PanesTabs } from "./PanesTabs";
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
  const Component = p.component as FC<Partial<TPane>>;

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
