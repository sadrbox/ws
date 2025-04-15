
import ActivityHistories from "../models/ActivityHistories";
import { JSX, useMemo, useRef, useState, useCallback } from "react";
import ContractFORM from "../models/Contracts/form";
import styles from "./styles/main.module.scss"

import AppContextProvider from "./AppContextProvider";
// import { TAppContext, TPaneTab } from "./types";
import NavigationPage from "./pages/NavigationPage";
import Contracts from "src/models/Contracts";
import { getTranslation } from "src/i18";
import Counterparties from "src/models/Counterparties";
import Organizations from "src/models/Organizations";
import { Navbar, PaneGroup, PaneTab } from "./DesignSystem";
import { TypeTabItem, TypeTabs } from "src/components/Tabs/types";
import { TypeAppContextProps } from "./types";


type TypePanes = {
  activeID: number;
  tabs: TypeTabItem[];
}


export default function App() {
  const screenRef = useRef<HTMLDivElement>(null);
  const [panes, setPanes] = useState<TypePanes>({
    activeID: 0,
    tabs: [
      { id: 0, label: "Навигация", content: <NavigationPage /> },
    ]
  });
  // const [paneTabs, setPaneTabs] = useState<TypeTabs>([
  //   { id: 0, label: "Навигация", content: <NavigationPage /> },
  //   // { id: 2, title: "second", component: <ActivityHistories /> }
  // ]);
  // const [activePaneID, setActivePaneID] = useState<number>(0);

  // Словарь компонентов
  const COMPONENTS: Record<string, React.ReactNode> = {
    ActivityHistories: <ActivityHistories />,
    ContractFORM: <ContractFORM />,
    NavigationPage: <NavigationPage />,
    // Sales: <Sales />,
    // Receipts: <Receipts />,
    Contracts: <Contracts />,
    Counterparties: <Counterparties />,
    Organizations: <Organizations />
  };

  const setActivePaneID = (id: number) => {
    setPanes((prev) => ({ ...prev, activeID: id }));
  }
  const openPane = useCallback((component: string) => {
    const currentComponent = COMPONENTS[component];

    if (!currentComponent) return;
    // const { activeID, tabs: paneTabs } = panes;
    // const setActivePaneID = setPanes}
    const existsPane = panes?.tabs.find(paneTab =>
      paneTab.content && (paneTab.content as React.ReactElement).type === component
    );

    if (!existsPane) {
      const label = getTranslation(component)
      const newTab = {
        id: Date.now(),
        label: label || `Вкладка ${panes?.tabs.length + 1}`,
        content: COMPONENTS[component]
      };
      setPanes((prev) => ({ activeID: newTab.id, tabs: [...prev.tabs, newTab] }));
      // setActivePaneID(newTab.id);
    } else {
      // setActivePaneID(existsPane.id)
    }
  }, [panes]);

  const init = useMemo<TypeAppContextProps>(() => {
    return {
      screenRef,
      panes: {
        activeID: panes.activeID,
        tabs: panes.tabs,
      },
      actions: {
        openPane,
        setActivePaneID
      }
    }
  }, [panes]);

  return (
    <AppContextProvider init={init}>
      <div ref={screenRef} className={styles.Screen}>
        <Navbar />
        <PaneGroup />
        <PaneTab />
      </div>
    </AppContextProvider>
  );
}
