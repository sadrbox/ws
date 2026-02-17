import React, {
  createContext,
  Dispatch,
  isValidElement,
  PropsWithChildren,
  ReactElement,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { getTranslation } from "src/app/i18";
import { Content, Navbar, NavList, ErrorBoundary, LoadingFallback, Screen } from "../components/UI";
import { TComponentNode, TPane, TypeAppContextProps, TypeNavbarProps } from "./types";
import useUID from "src/hooks/useUID";
import { TDataItem } from "src/components/Table/types";
// import { OrganizationsList } from "src/models/Organizations";
import CounterpartiesList from 'src/models/Counterparties/list';

import ActivityHistoriesList from "src/models/ActivityHistories";

export const getComponentName = (node: TComponentNode): string => {
  if (node == null) return "Unknown";

  if (isValidElement(node)) {
    const type = (node as ReactElement).type;
    if (typeof type === "string") return type;
    if (typeof type === "function") {
      return (type as any).displayName || (type as any).name || "AnonymousComponent";
    }
    return "UnknownElement";
  }

  if (typeof node === "function") {
    return (node as any).displayName || (node as any).name || "AnonymousComponent";
  }

  if (typeof node === "object" && (node as any).type && (node as any).type.displayName) {
    return (node as any).type.displayName;
  }
  return "NonComponent";
};

export const getUniqId = (component: TComponentNode, data?: TDataItem): string => {
  const name = getComponentName(component);
  const idPart = data?.uuid ?? data?.id ?? Date.now().toString(36);
  return `${name}-${idPart}`;
};

const AppContext = createContext<TypeAppContextProps | undefined>(undefined);

export const useAppContext = (): TypeAppContextProps => {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return ctx;
};

const AppContextProvider: React.FC<PropsWithChildren<{ value: TypeAppContextProps }>> = ({
  children,
  value,
}) => <AppContext.Provider value={value}>{children}</AppContext.Provider>;

// ────────────────────────────────────────────────
// Главный компонент приложения
// ────────────────────────────────────────────────

const App: React.FC = () => {
  const queryClient = new QueryClient();

  const screenRef = useRef<HTMLDivElement>(null);

  const [panes, setPanes] = useState<TPane[]>([]);
  const [activePaneId, setActivePaneId] = useState<string>("");

  // Навбар (можно вынести в отдельный хук / компонент позже)
  const initialNavbar: TypeNavbarProps[] =
    [
      { id: useUID(), isActive: false, title: "Операционная деятельность", component: <NavList label="Operations" /> },
      { id: useUID(), isActive: false, title: "CRM", component: <NavList label="CRM" /> },
      { id: useUID(), isActive: false, title: "Настройки", component: <NavList label="Settings" /> },
    ]


  const [navbarItems, setNavbarItems] = useState<TypeNavbarProps[]>(initialNavbar);

  // ────────────────────────────────────────────────
  // Управление панелями
  // ────────────────────────────────────────────────

  const addPane = useCallback((pane: Partial<TPane>): string => {
    if (!pane.component) {
      console.warn("[addPane] Component is required");
      return "";
    }

    const uniqId = getUniqId(pane.component, pane?.data as TDataItem | undefined);

    // Проверяем, существует ли уже такая панель
    const existing = panes.find((p) => p.uniqId === uniqId);
    if (existing) {
      setActivePaneId(uniqId);
      return uniqId;
    }

    // Формируем заголовок, если не передан
    let label = pane.label;
    if (!label) {
      const compName = getComponentName(pane.component);
      label = getTranslation(compName) || compName;
      // console.log(compName, label)
    }

    const newPane: TPane = {
      ...pane,
      uniqId,
      label,
      component: pane.component, // важно сохранить ссылку на компонент
    };

    setPanes((prev) => [...prev, newPane]);
    setActivePaneId(uniqId);

    // Скрываем навбар после открытия панели
    setNavbarItems((prev) => prev.map((n) => ({ ...n, isActive: false })));

    return uniqId;
  }, [panes]);

  const removePane = useCallback((uniqId: string) => {
    setPanes((prev) => {
      const index = prev.findIndex((p) => p.uniqId === uniqId);
      if (index === -1) return prev;

      const next = prev.filter((_, i) => i !== index);

      // Если закрываем активную панель → переключаемся на предыдущую или очищаем
      if (activePaneId === uniqId) {
        const newActive = next.length > 0 ? next[Math.max(0, index - 1)].uniqId : "";
        setActivePaneId(newActive);
      }

      return next;
    });
  }, [activePaneId]);

  // const openPane = useCallback((pane: Partial<TOpenPaneProps>) => {
  //   addPane(pane);
  // }, [addPane]);

  const setActivePane = useCallback((uniqId: string) => {
    if (panes.some((p) => p.uniqId === uniqId)) {
      setActivePaneId(uniqId);
    }
  }, [panes]);

  // ────────────────────────────────────────────────
  // Автоматическое открытие начальной панели
  // ────────────────────────────────────────────────

  useEffect(() => {
    // Открываем OrganizationsList при монтировании приложения
    addPane({
      component: ActivityHistoriesList,
      label: getTranslation("ActivityHistoriesList") || "ActivityHistoriesList",
    });
  }, []);

  // ────────────────────────────────────────────────
  // Контекстное значение (мемоизировано)
  // ────────────────────────────────────────────────

  const contextValue = useMemo<TypeAppContextProps>(
    () => ({
      screenRef,
      windows: {
        panes,
        activePane: activePaneId,
        addPane,
        removePane,
        setActivePane,
      },
      navbar: {
        props: navbarItems,
        setProps: setNavbarItems,
      },
      actions: {
        // можно расширить при необходимости
      },
    }),
    [panes, activePaneId, addPane, removePane, setActivePane, navbarItems]
  );

  return (
    <AppContextProvider value={contextValue}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary fallback={<div>Что-то пошло не так</div>}>
          <React.Suspense fallback={<LoadingFallback />}>
            <Screen ref={screenRef}>
              <Navbar />
              <Content />
            </Screen>
          </React.Suspense>
        </ErrorBoundary>

        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </AppContextProvider>
  );
};

export default App;