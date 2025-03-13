
import ActivityHistories from "../../models/ActivityHistories";
import { JSX, useMemo, useState } from "react";
// import ActivityHistory from './models/ActivityHistory/index';
import ContractFORM from "../../models/Contracts/form";
import styles from "./styles.module.scss"
import Navbar from "./layout/Navbar";
import PaneTab from "./layout/PaneTab";
import PaneGroup from "./layout/PaneGroup";
import AppContextProvider from "./AppContextProvider";
import { TAppContext, TPaneTab } from "./types";
import Sales from "src/models/Sales";
import NavigationPage from "./Pages/NavigationPage";
import Contracts from "src/models/Contracts";
import { getTranslation } from "src/i18";
import Counterparties from "src/models/Counterparties";



export default function App() {
  const [paneTabs, setPaneTabs] = useState<TPaneTab[]>([
    { id: 1, title: "Навигация", component: <NavigationPage /> },
    { id: 2, title: "second", component: <ActivityHistories /> }
  ]);
  const [activePaneID, setActivePaneID] = useState<number>(1);

  // Словарь компонентов
  const COMPONENTS: Record<string, JSX.Element> = {
    ActivityHistories: <ActivityHistories />,
    ContractFORM: <ContractFORM />,
    NavigationPage: <NavigationPage />,
    Sales: <Sales />,
    // Receipts: <Receipts />,
    Contract: <Contracts />,
    Counterparties: <Counterparties />
  };


  function openPane(component: string) {

    const existsPane = paneTabs.find(paneTab => paneTab.component.type.name === component ? paneTab.id : null)
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
  }

  const initialContext = useMemo<TAppContext>(() => {
    return {
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
      <div className={styles.Screen}>
        <Navbar />
        <PaneGroup />
        <PaneTab />
      </div>
    </AppContextProvider>
  );
}
