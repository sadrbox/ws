
import React, { useState } from "react";
import styles from "./Tabs.module.scss";



interface Tab {
  id: string;
  label: string;
  component: React.ReactNode;
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

  // Если нет табов или массив пустой
  if (!tabs || tabs.length === 0) {
    return (
      <div className={styles.emptyState}>
        No tabs available
      </div>
    );
  }

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
  };

  // const activeTabContent = tabs.find(tab => tab.id === activeTab)?.component || null;

  return (
    <div
      className={styles.TabsWrapper}
      role="tablist"
    >
      {/* Tab Headers */}
      <div className={styles.TabsHeader}>
        {tabs.map((tab, mapID) => {
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              className={`${styles.TabsLabel} ${isActive ? styles.active : ''} `}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel - ${tab.id} `}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleTabClick(tab.id)}
            >
              <span className={styles.labelText}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className={styles.TabsBody}>
        {tabs.map((tab, mapID) => {
          const isActive = activeTab === tab.id;

          return (
            <div
              key={tab.id}
              // id={`panel - ${tab.id} `}
              className={`${styles.TabsBodyWrapper} ${isActive ? styles.active : styles.hidden} `}
              role="tabpanel"
              aria-labelledby={`tab - ${tab.id} `}
              hidden={!isActive}
              tabIndex={mapID}
            >
              {isActive && tab.component}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Tabs;
