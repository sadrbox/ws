
import styles from "./styles/global.module.scss";
import ActivityHistory from "./models/ActivityHistory";
import { JSX, useState } from "react";
// import ActivityHistory from './models/ActivityHistory/index';
import ContractFORM from "./models/Contracts/form";

type PaneTab = {
  id: number;
  title: string;
  component: JSX.Element;
};

export default function App() {
  const [tabs, setTabs] = useState<PaneTab[]>([
    { id: 1, title: "first", component: <ActivityHistory /> },
    { id: 2, title: "second", component: <ActivityHistory /> }
  ]);
  const [activeTab, setActiveTab] = useState<number>(1);

  // Словарь компонентов
  const COMPONENTS: Record<string, JSX.Element> = {
    ActivityHistory: <ActivityHistory />,
    ContractFORM: <ContractFORM />
  };


  function openPane(component: string) {
    const newTab = {
      id: Date.now(),
      title: `Вкладка ${tabs.length + 1}`,
      component: COMPONENTS[component]
    };
    setTabs((prevTabs) => [...prevTabs, newTab]);
    setActiveTab(newTab.id);
  }

  return (
    <div className={styles.Screen}>
      <div className={styles.NavbarWrapper}>
        <a href="#" className={styles.NavbarItem} onClick={() => openPane('ActivityHistory')}>
          История активности
        </a>
        <a href="#" className={styles.NavbarItem} onClick={() => openPane('ContractFORM')}>
          Форма
        </a>
      </div>
      <div className={styles.PaneWrapper}>
        {tabs.map((tab) => (
          <div key={tab.id} className={[styles.Pane, tab.id === activeTab ? styles.ActivePane : ""].filter(s => s && s).join(" ")}>
            {tab.component}
          </div>
        ))}
      </div>
      <div className={styles.PaneTabWrapper}>
        {tabs.map((tab) => (
          <div className={[styles.PaneTab, tab.id === activeTab ? styles.ActivePaneTab : ""].filter(s => s && s).join(" ")}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.title}
          </div>
        ))}
      </div>
    </div>
  );
}
