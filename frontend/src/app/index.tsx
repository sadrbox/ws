import AppContextProvider from "./AppContextProvider";
import { getTranslation } from "src/i18";
import { Navbar, NavbarOverlay, PaneGroup, PaneTab, Portal } from "../components/UI";
import { TypeTabItem } from "src/components/Tabs/types";
import { OverlayProps, TypeAppContextProps } from "./types";
import ReactDOM from 'react-dom';

import { Screen } from "../components/UI";
import NavigationPage from "./pages/NavigationPage";
import { usePortal } from "src/hooks/usePortal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import React from "react";

type TypePanes = {
  activeID: number;
  tabs: TypeTabItem[];
}



export default function App() {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [panes, setPanes] = useState<TypePanes>({
    activeID: 0,
    tabs: []
  });
  const [overlayIsVisible, setOverlayIsVisible] = useState(false);
  const [getOverlay, setOverlay] = useState<OverlayProps>({
    isVisible: overlayIsVisible,
    toggleVisibility: () => { (isVisible: boolean) => setOverlayIsVisible(isVisible) },
    content: <NavigationPage />
  })

  useEffect(() => { setOverlayIsVisible(getOverlay.isVisible) }, [getOverlay.isVisible])



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

  const openPane = useCallback((content: React.ReactNode, hideTab?: boolean) => {
    // if (!content || !inTab) return;
    setOverlayIsVisible(false);
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
    overlay: { getOverlay, setOverlay },
    actions: {
      openPane,
      setActivePaneID,
    },
  }), [panes, openPane, setActivePaneID, overlayIsVisible]);

  return (
    <AppContextProvider init={contextValue}>
      <Screen ref={screenRef}>
        <Navbar />
        <PaneGroup />
        <PaneTab />
      </Screen>
      {/* {overlayIsVisible && getOverlay.content && <Portal content={getOverlay.content} />} */}
    </AppContextProvider>
  );
}

