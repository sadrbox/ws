
import React, { useState, useRef, useCallback } from "react";
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
}

const Tabs: React.FC<TypeTabs> = ({
  tabs,
  defaultActiveTab,
}) => {
  const [activeTab, setActiveTab] = useState<string>(
    defaultActiveTab || tabs[0]?.id || ''
  );
  // Рефы на панели вкладок — нужны чтобы после переключения сфокусировать
  // скролл-контейнер таблицы внутри активной вкладки (для клавиатурной
  // навигации SubTable: Up/Down/Left/Right/Insert/Delete/Home/End/PgUp/PgDn).
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Если нет табов или массив пустой
  if (!tabs || tabs.length === 0) {
    return (
      <div className={styles.emptyState}>
        No tabs available
      </div>
    );
  }

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
  }, []);

  // const activeTabContent = tabs.find(tab => tab.id === activeTab)?.component || null;

  return (
    <div
      className={styles.TabsWrapper}
      role="tablist"
    >
      {/* Tab Headers — скрываем если таб только один */}
      {tabs.length > 1 && (
        <div className={styles.TabsHeader}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                className={`${styles.TabsLabel} ${isActive ? styles.active : ''}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
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
              className={`${styles.TabsBodyWrapper} ${isActive ? styles.active : ''}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab.id}`}
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
