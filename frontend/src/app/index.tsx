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
import { restoreQueryCache, persistQueryCache, clearPersistedCache } from "src/services/queryPersist";
import { initialSync, startPeriodicSync, stopPeriodicSync } from "src/services/syncManager";
import { clearOfflineDb } from "src/services/offlineDb";
import { registerServiceWorker } from "src/services/registerSW";

import { getTranslation } from "src/i18";
import { Content, Navbar, NavList, ErrorBoundary, LoadingFallback, Screen, LoadingSpinner } from "../components/UI";
import { TComponentNode, TPane, TypeAppContextProps, TypeNavbarProps } from "./types";
import useUID from "src/hooks/useUID";
import { TDataItem } from "src/components/Table/types";
// import { OrganizationsList } from "src/models/Organizations";
// import { CounterpartiesList } from 'src/models/Counterparties';

import { ActivityHistoriesList } from "src/models/ActivityHistories";
import { CounterpartiesList } from "src/models/Counterparties";
import { ContactPersonsList } from "src/models/ContactPersons";
import LoginForm from "src/components/LoginForm";
import { isAuthenticated, verifyToken, logout, getCurrentUser, type AuthUser } from "src/services/auth";
import { useConfirm } from "src/hooks/useConfirm";
import ConfirmModal from "src/components/ConfirmModal";
import { startHealthCheck, stopHealthCheck } from "src/services/networkStatus";
import { clearAllFormStores } from "src/hooks/useFormSessionStore";
import { clearAllEntries as clearOfflineQueue } from "src/services/offlineQueue";

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
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // offlineFirst: при отсутствии сети — сначала отдать данные из кэша,
        // а сетевой запрос выполнить позже, когда сеть восстановится.
        networkMode: "offlineFirst",
        staleTime: 2 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: (failureCount, error: any) => {
          // Не ретраить при сетевых ошибках — бессмысленно
          if (error?.code === "ERR_NETWORK" || error?.message === "Network Error") return false;
          return failureCount < 1;
        },
      },
      mutations: {
        networkMode: "offlineFirst",
      },
    },
  }));

  const screenRef = useRef<HTMLDivElement>(null);

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(isAuthenticated());
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(getCurrentUser());

  // ── Query Persist: восстановить кэш из IndexedDB + подписка на сохранение ──
  useEffect(() => {
    // Восстанавливаем кэш (данные появляются мгновенно при offline)
    restoreQueryCache(queryClient).catch(() => {});
    // Подписываемся на сохранение изменений кэша в IndexedDB
    const unsubscribe = persistQueryCache(queryClient);
    return unsubscribe;
  }, [queryClient]);

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

  // Запускаем health-check для определения реальной доступности сервера
  useEffect(() => {
    if (isLoggedIn) {
      startHealthCheck(30_000); // каждые 30 сек

      // ── Offline-first: начальная синхронизация + периодическая ──
      initialSync().catch((err) =>
        console.warn("[App] Initial sync failed:", err),
      );
      startPeriodicSync(5 * 60 * 1000); // каждые 5 минут

      return () => {
        stopHealthCheck();
        stopPeriodicSync();
      };
    }
  }, [isLoggedIn]);

  // ── Регистрация Service Worker (один раз при монтировании) ──
  useEffect(() => {
    registerServiceWorker().catch(() => {});
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setIsLoggedIn(true);
    setCurrentUser(getCurrentUser());
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    // Очистка данных сессии при выходе
    clearAllFormStores();
    clearPersistedCache().catch(() => {});
    clearOfflineQueue().catch(() => {});
    clearOfflineDb().catch(() => {});
    stopPeriodicSync();
    queryClient.clear();
    setIsLoggedIn(false);
    setCurrentUser(null);
  }, [queryClient]);

  const [panes, setPanes] = useState<TPane[]>([]);
  const [activePaneId, _setActivePaneId] = useState<string>("");

  // Стек истории активных панелей (для возврата к предыдущей при закрытии)
  const paneHistoryRef = useRef<string[]>([]);

  // ── beforeClose guards ──────────────────────────────────────────────
  // Map: paneUniqId → Set<guard-функций>
  const beforeCloseGuardsRef = useRef<Map<string, Set<() => Promise<boolean> | boolean>>>(new Map());

  /** Регистрирует guard-функцию для панели. Возвращает unregister. */
  const registerBeforeClose = useCallback(
    (uniqId: string, guard: () => Promise<boolean> | boolean): (() => void) => {
      const guards = beforeCloseGuardsRef.current;
      if (!guards.has(uniqId)) guards.set(uniqId, new Set());
      guards.get(uniqId)!.add(guard);
      return () => {
        guards.get(uniqId)?.delete(guard);
        if (guards.get(uniqId)?.size === 0) guards.delete(uniqId);
      };
    },
    [],
  );

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
      { id: useUID(), isActive: false, title: "Торговля", component: <NavList label="Trade" /> },
      { id: useUID(), isActive: false, title: "Кадровый учёт", component: <NavList label="HR" /> },
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

  /** Закрытие панели с проверкой beforeClose guards. Если guard вернул false — закрытие отменяется. */
  const requestClose = useCallback(async (uniqId: string) => {
    const guards = beforeCloseGuardsRef.current.get(uniqId);
    if (guards && guards.size > 0) {
      for (const guard of guards) {
        const canClose = await guard();
        if (!canClose) return; // guard отменил закрытие
      }
    }
    // Все guards разрешили (или их нет) — закрываем
    beforeCloseGuardsRef.current.delete(uniqId);
    removePane(uniqId);
  }, [removePane]);

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
        requestClose,
        setActivePane,
        updatePaneLabel,
        registerBeforeClose,
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
    [panes, activePaneId, addPane, removePane, requestClose, setActivePane, updatePaneLabel, registerBeforeClose, navbarItems, currentUser, handleLogout, confirm]
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