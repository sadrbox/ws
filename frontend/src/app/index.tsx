import React, { useMemo, useRef, useState, useCallback } from "react";
import styles from "./styles/main.module.scss"
import AppContextProvider from "./AppContextProvider";
import { getTranslation } from "src/i18";
import { Navbar, PaneGroup, PaneTab } from "../components/UI";
import { TypeTabItem } from "src/components/Tabs/types";
import { TypeAppContextProps } from "./types";

type TypePanes = {
  activeID: number;
  tabs: TypeTabItem[];
}

export default function App() {
  const screenRef = useRef<HTMLDivElement>(null);
  const [panes, setPanes] = useState<TypePanes>({
    activeID: 0,
    tabs: []
  });

  const getComponentName = useCallback((node: React.ReactNode): string => {
    if (React.isValidElement(node) && typeof node.type === "function") {
      return node.type.name || "AnonymousComponent";
    }
    if (React.isValidElement(node) && typeof node.type === "string") {
      return node.type;
    }
    return "";
  }, []);

  const setActivePaneID = useCallback((id: number) => {
    setPanes(prev => ({ ...prev, activeID: id }));
  }, []);

  const openPane = useCallback((content: React.ReactNode, inTab?: boolean) => {
    // if (!content || !inTab) return;

    const componentName = getComponentName(content);
    const existingPane = panes.tabs.find(paneTab =>
      paneTab.content && getComponentName(paneTab.content) === componentName
    );

    if (existingPane) {
      setActivePaneID(existingPane.id);
    } else {
      const label = getTranslation(componentName) || `Вкладка ${panes.tabs.length + 1}`;
      const newTab = {
        id: Date.now(),
        label,
        content
      };
      setPanes(prev => ({
        activeID: newTab.id,
        tabs: [...prev.tabs, newTab]
      }));
    }
  }, [panes.tabs, getComponentName, setActivePaneID]);

  const contextValue = useMemo<TypeAppContextProps>(() => ({
    screenRef,
    panes,
    actions: {
      openPane,
      setActivePaneID
    }
  }), [panes, openPane, setActivePaneID]);

  return (
    <AppContextProvider init={contextValue}>
      <div ref={screenRef} className={styles.Screen}>
        <Navbar />
        <PaneGroup />
        <PaneTab />
      </div>
    </AppContextProvider>
  );
}