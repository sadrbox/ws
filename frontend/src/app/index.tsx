import AppContextProvider from "./AppContextProvider";
import { getTranslation } from "src/i18";
import { Content, Navbar, NavList, PaneGroup, PaneTab } from "../components/UI";
import { TypePaneItem } from "src/components/Tabs/types";
import { TypeAppContextProps, TypeNavbarProps } from "./types";

import { Screen } from "../components/UI";

// import NavigationPage from "./pages/NavigationPage";
// import { usePortal } from "src/hooks/usePortal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import React from "react";
import useUID from "src/hooks/useUID";



export default function App() {

  // перенести в отдельный файл для настройки topmenu - Navbar
  const navbar = [
    {
      id: useUID(),
      isActive: false,
      title: "Операционная деятельность",
      component: <NavList lable="OPErations" />
    },
    {
      id: useUID(),
      isActive: true,
      title: "CRM",
      component: <NavList lable="CRM" />
    },
    {
      id: useUID(),
      isActive: false,
      title: "Настройки",
      component: <NavList lable="settings" />
    }

  ]; //--------------//


  const screenRef = useRef<HTMLDivElement | null>(null);
  const [panes, setPanes] = useState<TypePaneItem[]>([]);
  // const [navbarOverlayIsVisible, setNavbarOverlayIsVisible] = useState(false);
  const [navbarList, setNavbarList] = useState<TypeNavbarProps>(navbar);
  // const [navbarOverlay, setNavbarOverlay] = useState<TypeNavbarOverlayProps>({
  //   isVisible: true,
  //   toggleVisibility: () => setNavbar(prev => !prev),
  //   component: <NavigationPage />
  // })

  // const navbarOverlayIsVisible = navbarList.find(n => n.isActive)




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
    setPanes(prev => prev.map(p => (p.id == id ? { ...p, isActive: true } : { ...p, isActive: false })));
  }, []);

  const addPane = useCallback((component: React.ReactNode) => {
    // if (!content || !inTab) return;
    setNavbarList(nav => nav.map(n => ({ ...n, isActive: false })));
    const componentName = getComponentName(component);
    const existingPane = panes && panes.find(p => getComponentName(p.component) === componentName);
    // console.log(existingPane);

    if (existingPane) {

      setActivePaneID(existingPane.id);
    } else {
      const label = getTranslation(componentName) || `Вкладка ${panes.length + 1}`;
      const newTab = {
        id: Date.now(),
        label,
        component,
        isActive: true,
      };
      setPanes(prev => [...prev.map(p => ({ ...p, isActive: false })), newTab]);
    }
  }, [panes, getComponentName, setActivePaneID]);


  const contextValue = useMemo<TypeAppContextProps>(() => ({
    screenRef,
    panes,
    navbar: { props: navbarList, setProps: setNavbarList },
    actions: {
      addPane,
      setActivePaneID,
    },
  }), [panes, addPane, setActivePaneID, navbarList]);



  return (
    <AppContextProvider init={contextValue}>
      <Screen ref={screenRef}>
        <Navbar />
        <Content />
      </Screen>
      {/* {overlayIsVisible && getOverlay.content && <Portal content={getOverlay.content} />} */}
    </AppContextProvider>
  );
}

