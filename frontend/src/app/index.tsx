
import ActivityHistories from "../../models/ActivityHistories";
import { JSX, useMemo, useRef, useState, useCallback } from "react";
// import ActivityHistory from './models/ActivityHistory/index';
import ContractFORM from "../../models/Contracts/form";
import styles from "./styles.module.scss"
import Navbar from "./layout/Navbar";
import PaneTab from "./layout/PaneTab";
import PaneGroup from "./layout/PaneGroup";
import AppContextProvider from "./AppContextProvider";
import { TAppContext, TPaneTab } from "./types";
import NavigationPage from "./pages/NavigationPage";
import Contracts from "src/models/Contracts";
import { getTranslation } from "src/i18";
import Counterparties from "src/models/Counterparties";
import Organizations from "src/models/Organizations";



export default function App() {
  const screenRef = useRef<HTMLDivElement>(null);

  const [paneTabs, setPaneTabs] = useState<TPaneTab[]>([
    { id: 1, title: "Навигация", component: <NavigationPage /> },
    // { id: 2, title: "second", component: <ActivityHistories /> }
  ]);
  const [activePaneID, setActivePaneID] = useState<number>(1);

  // Словарь компонентов
  const COMPONENTS: Record<string, JSX.Element> = {
    ActivityHistories: <ActivityHistories />,
    ContractFORM: <ContractFORM />,
    NavigationPage: <NavigationPage />,
    // Sales: <Sales />,
    // Receipts: <Receipts />,
    Contracts: <Contracts />,
    Counterparties: <Counterparties />,
    Organizations: <Organizations />
  };


  const openPane = useCallback((component: string) => {

    const existsPane = paneTabs.find(paneTab =>
      paneTab.component && paneTab.component.type && paneTab.component.type.name === component
    );

    if (!existsPane) {
      const title = getTranslation(component)
      const newTab = {
        id: Date.now(),
        title: title || `Вкладка ${paneTabs.length + 1}`,
        component: COMPONENTS[component]
      };
      setPaneTabs((prevTabs) => [...prevTabs, newTab]);
      setActivePaneID(newTab.id);
    } else {
      setActivePaneID(existsPane.id)
    }
  }, [paneTabs, setActivePaneID]);

  const initialContext = useMemo<TAppContext>(() => {
    return {
      screenRef,
      pane: {
        activePaneID,
        paneTabs,
      },
      actions: {
        openPane
      },
      states: {
        setActivePaneID
      }
    }
  }, [activePaneID, paneTabs]);

  return (
    <AppContextProvider initialContext={initialContext}>
      <div ref={screenRef} className={styles.Screen}>
        <Navbar />
        <PaneGroup />
        <PaneTab />
      </div>
    </AppContextProvider>
  );
}
