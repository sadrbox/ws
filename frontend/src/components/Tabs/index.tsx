
import React, { useState, useRef, useCallback, useId } from "react";
import styles from "./Tabs.module.scss";

export type TabAccessLevel = "full" | "readonly" | "none";

interface Tab {
  id: string;
  label: string;
  component: React.ReactNode;
  /** Уровень доступа к данным вкладки. "readonly" — показывает иконку замка */
  accessLevel?: TabAccessLevel;
}

interface TypeTabs {
  tabs: Tab[];
  defaultActiveTab?: string;
  /**
   * Управляемый режим: активная вкладка задаётся снаружи. Нужен, когда переключить
   * вкладку должен не только клик по ней (напр. в «Администрировании 1С» клик по базе
   * открывает её сеансы). Без пропа компонент остаётся неуправляемым, как прежде.
   */
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
}

const Tabs: React.FC<TypeTabs> = ({
  tabs,
  defaultActiveTab,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [uncontrolledTab, setUncontrolledTab] = useState<string>(
    defaultActiveTab || tabs[0]?.id || ''
  );
  const activeTab = controlledTab ?? uncontrolledTab;
  const setActiveTab = useCallback((id: string) => {
    if (controlledTab === undefined) setUncontrolledTab(id);
    onTabChange?.(id);
  }, [controlledTab, onTabChange]);
  // Рефы на панели вкладок — нужны чтобы после переключения сфокусировать
  // скролл-контейнер таблицы внутри активной вкладки (для клавиатурной
  // навигации SubTable: Up/Down/Left/Right/Insert/Delete/Home/End/PgUp/PgDn).
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // id вкладок и панелей — уникальные на экземпляр: панелей с Tabs открыто много, и
  // `tab-main` повторялся между ними, а aria-controls вёл на несуществующий id.
  const uid = useId();
  const tabDomId = (id: string) => `${uid}-tab-${id}`;
  const panelDomId = (id: string) => `${uid}-panel-${id}`;

  const handleTabClick = useCallback((tabId: string) => {
    setActiveTab(tabId);
    // После применения CSS-видимости панели (display) — фокусируем первый
    // фокусируемый табличный контейнер внутри активной вкладки, чтобы
    // SubTable / Table сразу принимали клавиши клавиатуры без доп. клика.
    // Двойной rAF гарантирует, что React успел применить класс .active.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const panel = panelRefs.current[tabId];
        if (!panel) return;
        // Не перехватываем фокус, если пользователь уже сфокусирован внутри
        // активной панели (например в редактируемом поле inline-таблицы).
        if (panel.contains(document.activeElement)) return;
        // Ищем первый ВИДИМЫЙ табличный scroll-контейнер. Внутри вкладки
        // могут быть несколько таблиц (например SubTable внутри ModelForm,
        // в которой ещё одна вложенная панель Tabs). Фильтруем по
        // offsetParent !== null, чтобы пропустить таблицы из других
        // (неактивных) вложенных вкладок (display:none).
        const candidates = Array.from(
          panel.querySelectorAll<HTMLElement>('[class*="TableScrollWrapper"][tabindex="0"]')
        );
        const visible = candidates.find(el => el.offsetParent !== null);
        const target = visible ?? panel.querySelector<HTMLElement>('[tabindex="0"]');
        target?.focus({ preventScroll: true });
      });
    });
    // setActiveTab — в зависимостях: иначе обработчик замыкал первый onTabChange (аудит 26.09, О8).
  }, [setActiveTab]);

  // Клавиатура по паттерну tablist: ←/→ — соседняя вкладка, Home/End — первая/последняя.
  // Вкладка активируется сразу, фокус переходит на её заголовок (аудит 26.09, И17).
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const ids = tabs.map((t) => t.id);
    const idx = ids.indexOf(activeTab);
    let next = idx;
    if (e.key === "ArrowLeft") next = idx <= 0 ? ids.length - 1 : idx - 1;
    else if (e.key === "ArrowRight") next = idx < 0 || idx >= ids.length - 1 ? 0 : idx + 1;
    else if (e.key === "Home") next = 0;
    else next = ids.length - 1;
    e.preventDefault();
    const id = ids[next];
    if (id === undefined) return;
    setActiveTab(id);
    tabRefs.current[id]?.focus();
  }, [tabs, activeTab, setActiveTab]);

  // Если нет табов или массив пустой (после хуков — иначе rules-of-hooks).
  if (!tabs || tabs.length === 0) {
    return (
      <div className={styles.emptyState}>
        No tabs available
      </div>
    );
  }

  return (
    <div className={styles.TabsWrapper}>
      {/* Tab Headers — скрываем если таб только один */}
      {tabs.length > 1 && (
        <div className={styles.TabsHeader} role="tablist" onKeyDown={handleTabKeyDown}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el; }}
                id={tabDomId(tab.id)}
                type="button"
                className={`${styles.TabsLabel} ${isActive ? styles.active : ''}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={panelDomId(tab.id)}
                tabIndex={isActive ? 0 : -1}
                onClick={() => handleTabClick(tab.id)}
              >
                <span className={styles.labelText}>{tab.label}</span>
                {tab.accessLevel === "readonly" && (
                  <span className={styles.labelReadonly} title="Только чтение">
                    🔒
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab Content */}
      <div className={styles.TabsBody}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <div
              key={tab.id}
              ref={(el) => { panelRefs.current[tab.id] = el; }}
              id={panelDomId(tab.id)}
              className={`${styles.TabsBodyWrapper} ${isActive ? styles.active : ''}`}
              role="tabpanel"
              aria-labelledby={tabs.length > 1 ? tabDomId(tab.id) : undefined}
            >
              {tab.component}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Tabs;
