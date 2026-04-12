import React, {
  createContext,
  isValidElement,
  PropsWithChildren,
  ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { getTranslation } from "src/i18";
import { Content, Navbar, NavList, ErrorBoundary, LoadingFallback, Screen, LoadingSpinner } from "../components/UI";
import { TComponentNode, TPane, TypeAppContextProps, TypeNavbarProps } from "./types";
import useUID from "src/hooks/useUID";
import { TDataItem } from "src/components/Table/types";
// import { OrganizationsList } from "src/models/Organizations";
// import { CounterpartiesList } from 'src/models/Counterparties';

import { ActivityHistoriesList } from "src/models/ActivityHistories";
import { CounterpartiesList } from "src/models/Counterparties";
import { uniqueId } from 'lodash';
import { ContactPersonsList } from "src/models/ContactPersons";
import LoginForm from "src/components/LoginForm";
import { isAuthenticated, verifyToken, logout, getCurrentUser, type AuthUser } from "src/services/auth";
import { useConfirm } from "src/hooks/useConfirm";
import ConfirmModal from "src/components/ConfirmModal";

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
  // *List компоненты — один экземпляр панели, id = имя компонента
  if (name.endsWith("List")) return name;
  // *Form компоненты — уникальный id на основе данных
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
  // ⚠️ QueryClient создаётся один раз и сохраняется в state.
  // Ранее `new QueryClient()` вызывался при каждом рендере — это приводило
  // к потере кэша React Query и невозможности invalidateQueries обновлять данные.
  const [queryClient] = useState(() => new QueryClient());

  const screenRef = useRef<HTMLDivElement>(null);

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(isAuthenticated());
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(getCurrentUser());

  // Проверяем токен при первом монтировании
  useEffect(() => {
    if (isAuthenticated()) {
      verifyToken().then((user) => {
        if (user) {
          setIsLoggedIn(true);
          setCurrentUser(user);
        } else {
          setIsLoggedIn(false);
          setCurrentUser(null);
        }
        setAuthChecked(true);
      });
    } else {
      setAuthChecked(true);
    }
  }, []);

  // Слушаем событие logout (от interceptor при 401)
  useEffect(() => {
    const handleLogout = () => {
      setIsLoggedIn(false);
      setCurrentUser(null);
    };
    window.addEventListener("auth_logout", handleLogout);
    return () => window.removeEventListener("auth_logout", handleLogout);
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setIsLoggedIn(true);
    setCurrentUser(getCurrentUser());
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setIsLoggedIn(false);
    setCurrentUser(null);
  }, []);

  const [panes, setPanes] = useState<TPane[]>([]);
  const [activePaneId, _setActivePaneId] = useState<string>("");

  // Стек истории активных панелей (для возврата к предыдущей при закрытии)
  const paneHistoryRef = useRef<string[]>([]);

  const setActivePaneId = useCallback((id: string) => {
    _setActivePaneId((prev) => {
      if (prev && prev !== id) {
        // Убираем id из стека, если он уже есть (чтобы не дублировать)
        const history = paneHistoryRef.current.filter((h) => h !== prev);
        history.push(prev);
        paneHistoryRef.current = history;
      }
      return id;
    });
  }, []);

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

  const addPane = useCallback((options: Partial<TPane>) => {
    if (!options.component) {
      console.warn("[addPane] Component is required");
      return "";
    }

    // Для selector-панелей всегда уникальный ID
    const uniqId = options.isSelector
      ? `selector-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      : getUniqId(options.component, options.data);

    // Если *List панель уже открыта — просто активируем её (не для selector)
    if (!options.isSelector) {
      const existing = panes.find(p => p.uniqId === uniqId);
      if (existing) {
        setActivePaneId(uniqId);
        setNavbarItems((prev) => prev.map((n) => ({ ...n, isActive: false })));
        return uniqId;
      }
    }

    // Формируем заголовок, если не передан
    let label = options.label;
    if (!label) {
      const compName = getComponentName(options.component);
      label = getTranslation(compName) || compName;
    }

    const newPane: TPane = {
      ...options,
      uniqId,
      label,
      component: options.component, // важно сохранить ссылку на компонент
    };

    // Если активна selector-панель и новая панель не является selector —
    // привязываем дочернюю панель к selector-панели
    if (!options.isSelector) {
      const activeSelector = panes.find(
        (p) => p.isSelector && (p.uniqId === activePaneId || panes.some((c) => c.selectorPaneId === p.uniqId && c.uniqId === activePaneId))
      );
      if (activeSelector) {
        newPane.selectorPaneId = activeSelector.uniqId;
      }
    }

    setPanes((prev) => [...prev, newPane]);
    setActivePaneId(uniqId);

    // Скрываем навбар после открытия панели
    setNavbarItems((prev) => prev.map((n) => ({ ...n, isActive: false })));

    return uniqId;
  }, [panes, activePaneId]);

  const removePane = useCallback((uniqId: string) => {
    setPanes((prev) => {
      const index = prev.findIndex((p) => p.uniqId === uniqId);
      if (index === -1) return prev;

      const next = prev.filter((_, i) => i !== index);
      const remainingIds = new Set(next.map((p) => p.uniqId));

      // Убираем закрываемую панель из истории
      paneHistoryRef.current = paneHistoryRef.current.filter(
        (h) => h !== uniqId && remainingIds.has(h)
      );

      // Если закрываем активную панель → переключаемся
      _setActivePaneId((currentActive) => {
        if (currentActive !== uniqId) return currentActive;
        if (next.length === 0) return "";

        // Приоритет: если есть открытая selector-панель → возвращаемся к ней
        const selectorPane = next.find((p) => p.isSelector);
        if (selectorPane) return selectorPane.uniqId;

        // Иначе — последняя из истории
        const history = paneHistoryRef.current;
        if (history.length > 0) {
          return history.pop()!;
        }
        // fallback
        const newIndex = index > 0 ? index - 1 : 0;
        return next[Math.min(newIndex, next.length - 1)].uniqId;
      });

      return next;
    });
  }, []);

  // const openPane = useCallback((pane: Partial<TOpenPaneProps>) => {
  //   addPane(pane);
  // }, [addPane]);

  const setActivePane = useCallback((uniqId: string) => {
    // Блокировка: если есть selector-панель, разрешаем переключение
    // только на selector и его дочерние панели
    const selectorPane = panes.find((p) => p.isSelector);
    if (selectorPane) {
      const isAllowed =
        uniqId === selectorPane.uniqId ||
        panes.some((p) => p.uniqId === uniqId && p.selectorPaneId === selectorPane.uniqId);
      if (!isAllowed) return;
    }
    if (panes.some((p) => p.uniqId === uniqId)) {
      setActivePaneId(uniqId);
    }
  }, [panes]);

  const updatePaneLabel = useCallback((uniqId: string, label: string) => {
    setPanes(prev => prev.map(p => p.uniqId === uniqId ? { ...p, label } : p));
  }, []);

  // ────────────────────────────────────────────────
  // Автоматическое открытие начальной панели
  // ────────────────────────────────────────────────

  useEffect(() => {
    // Открываем ActivityHistoriesList при монтировании приложения
    addPane({
      component: ActivityHistoriesList,
      label: getTranslation("ActivityHistoriesList") || "ActivityHistoriesList",
    });
  }, []);

  // ────────────────────────────────────────────────
  // Глобальный confirm (замена window.confirm)
  // ────────────────────────────────────────────────
  const { confirm, confirmState } = useConfirm();

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
        updatePaneLabel,
      },
      navbar: {
        props: navbarItems,
        setProps: setNavbarItems,
      },
      actions: {
        confirm,
      },
      auth: {
        user: currentUser,
        logout: handleLogout,
      },
    }),
    [panes, activePaneId, addPane, removePane, setActivePane, updatePaneLabel, navbarItems, currentUser, handleLogout, confirm]
  );

  return (
    <AppContextProvider value={contextValue}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary fallback={<div>Что-то пошло не так</div>}>
          <React.Suspense fallback={<LoadingSpinner />}>
            {!authChecked ? (
              <LoadingSpinner />
            ) : !isLoggedIn ? (
              <LoginForm onLoginSuccess={handleLoginSuccess} />
            ) : (
              <Screen ref={screenRef}>
                <Navbar />
                <Content />
              </Screen>
            )}
          </React.Suspense>
        </ErrorBoundary>

        {/* {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />} */}
      </QueryClientProvider>

      <ConfirmModal {...confirmState} />
    </AppContextProvider>
  );
};

export default App;