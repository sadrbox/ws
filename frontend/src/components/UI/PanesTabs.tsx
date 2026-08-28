// Подсистема вкладок панелей (PaneTabItem/PaneTabsMore/PanesTabs). Вынесено из UI/index.tsx (Q9).
import { FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "../../styles/main.module.scss";
import { translate } from 'src/i18';
import { useAppContext } from 'src/app/context';
import { IconButton } from 'src/components/Toolbar';
import type { TPane } from 'src/app/types';

// uniqId вкладок, у которых enter-анимация уже проигралась (запускается один раз).
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

