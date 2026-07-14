import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { restoreQueryCache, persistQueryCache, clearPersistedCache } from "src/services/queryPersist";
import { initialSync, startPeriodicSync, stopPeriodicSync } from "src/services/syncManager";
import { clearOfflineDb } from "src/services/offlineDb";
import { registerServiceWorker } from "src/services/registerSW";

import { translate, getTranslation } from "src/i18";
import { Navbar, NavList, ErrorBoundary, Screen, LoadingSpinner, Container } from "../components/UI";
import { TComponentNode, TPane, TypeAppContextProps, TypeNavbarProps } from "./types";
import useUID from "src/hooks/useUID";
import { TDataItem } from "src/components/Table/types";


import LoginForm from "src/components/LoginForm";
import { isAuthenticated, verifyToken, logout, getCurrentUser, type AuthUser } from "src/services/auth";
import { useConfirm } from "src/hooks/useConfirm";
import ConfirmModal from "src/components/ConfirmModal";
import { startHealthCheck, stopHealthCheck } from "src/services/networkStatus";
import { clearAllFormStores } from "src/hooks/useFormSessionStore";
import { formStoreAPI } from "src/hooks/useFormStore";
import { AppContextProvider } from "src/app/context";
import { loadPersistedSession, savePersistedSession, restorePane, inferListRestore, type PersistedSession } from "src/app/paneRestore";
import { readPaneLink, clearPaneLinkParam } from "src/utils/paneLink";
import { openFormByRef } from "src/utils/openFormByRef";
import { getComponentName } from "./getComponentName";

// getUniqId — внутренняя утилита (не экспортируется, чтобы модуль оставался
// Fast-Refresh-совместимым: единственный value-export здесь — компонент App).
const getUniqId = (component: TComponentNode, data?: Partial<TDataItem>): string => {
  const name = getComponentName(component);
  // Синглтоны: *List
  if (name.endsWith("List")) return name;
  // Формы с конкретной записью: один pane на uuid/id
  if (data?.uuid || data?.id) return `${name}-${data.uuid ?? data.id}`;
  // Формы с явным токеном (например, открытые из основания) — уникальный pane
  if ((data as any)?._paneToken) return `${name}-${(data as any)._paneToken}`;
  // Прочие новые формы: синглтон
  return name;
};


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
    restoreQueryCache(queryClient).catch(() => { });
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
      }).catch(console.error);
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

  // Слушаем переключение организации — обновляем currentUser без перелогина
  useEffect(() => {
    const handleOrgSwitch = (e: Event) => {
      const user = (e as CustomEvent<AuthUser>).detail;
      if (user) {
        setCurrentUser(user);
        // Инвалидируем кэш React Query — данные теперь от другой орг
        queryClient.clear();
      }
    };
    window.addEventListener("auth_org_switched", handleOrgSwitch);
    return () => window.removeEventListener("auth_org_switched", handleOrgSwitch);
  }, [queryClient]);

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
    registerServiceWorker().catch(() => { });
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setIsLoggedIn(true);
    setCurrentUser(getCurrentUser());
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    // Очистка данных сессии при выходе
    clearAllFormStores();
    clearPersistedCache().catch(() => { });
    clearOfflineDb().catch(() => { });
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
      // «Все разделы» — полное меню одним списком: пользователю, который не помнит, в
      // каком разделе учёта лежит нужный пункт, не приходится обходить остальные вкладки.
      // Содержимое переиспользует те же группы (см. NavList), так что разойтись не может.
      { id: useUID(), isActive: false, title: translate("allSections"), component: <NavList label="All" /> },
      { id: useUID(), isActive: false, title: translate("trade"), component: <NavList label="Trade" /> },
      { id: useUID(), isActive: false, title: translate("accounting"), component: <NavList label="Accounting" /> },
      { id: useUID(), isActive: false, title: translate("hr"), component: <NavList label="HR" /> },
      { id: useUID(), isActive: false, title: translate("crm"), component: <NavList label="CRM" /> },
      { id: useUID(), isActive: false, title: translate("settings"), component: <NavList label="Settings" /> },
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
        // Списки — синглтоны (uniqId = имя компонента). Если тот же компонент
        // открывают с ДРУГОЙ подписью, второй вкладки не будет, а заголовок
        // останется от первого открытия — пункт меню выглядит сломанным. Так уже
        // было: «ЭСФ: Исходящие» и «Счета-фактуры (исходящие)» делили один список.
        // Молча это не ловится, поэтому ругаемся в dev.
        if (import.meta.env.DEV && options.label && options.label !== existing.label) {
          console.warn(
            `[addPane] Панель «${uniqId}» уже открыта с подписью «${existing.label}», ` +
            `а запрошена «${options.label}». Останется прежняя. Нужны две разные вкладки — ` +
            `различайте их через data (тогда будет разный uniqId), а не подписью.`,
          );
        }
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
      // Рецепт восстановления. Панели без него не переживают перезагрузку (см.
      // paneRestore): сохранить можно только сериализуемое описание, а не живой
      // компонент. Реестры (openListByRef / openFormByEndpoint / openReport) рецепт
      // проставляют, а навбар открывает списки НАПРЯМУЮ компонентом — и такие панели
      // после F5 пропадали. Выводим рецепт из имени компонента, чтобы не дублировать
      // endpoint в каждом из 120+ вызовов addPane.
      restore: options.restore ?? inferListRestore(options.component, options.data),
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

    // Опидатель: панель, активная в момент открытия. При закрытии этой панели
    // вернёмся к нему (напр. форма, из поля «Основание» которой открыт документ).
    if (!options.isSelector) {
      const opener = options.openerPaneId ?? (activePaneId && activePaneId !== uniqId ? activePaneId : undefined);
      if (opener) newPane.openerPaneId = opener;
    }

    setPanes((prev) => [...prev, newPane]);
    setActivePaneId(uniqId);

    // Скрываем навбар после открытия панели
    setNavbarItems((prev) => prev.map((n) => ({ ...n, isActive: false })));

    return uniqId;
  }, [panes, activePaneId]);

  /** Закрытие панели.
   * force=true — принудительно, без guards (после сохранения).
   * force=false (по умолчанию) — с проверкой beforeClose guards (из UI).
   */
  const requestClose = useCallback(async (uniqId: string, { force = false }: { force?: boolean } = {}) => {
    if (!force) {
      const guards = beforeCloseGuardsRef.current.get(uniqId);
      if (guards && guards.size > 0) {
        for (const guard of guards) {
          const canClose = await guard();
          if (!canClose) return;
        }
      }
    }
    beforeCloseGuardsRef.current.delete(uniqId);
    setPanes((prev) => {
      const index = prev.findIndex((p) => p.uniqId === uniqId);
      if (index === -1) return prev;

      const closed = prev[index];
      const next = prev.filter((_, i) => i !== index);
      const remainingIds = new Set(next.map((p) => p.uniqId));

      paneHistoryRef.current = paneHistoryRef.current.filter(
        (h) => h !== uniqId && remainingIds.has(h)
      );

      _setActivePaneId((currentActive) => {
        if (currentActive !== uniqId) return currentActive;
        if (next.length === 0) return "";

        const selectorPane = next.find((p) => p.isSelector);
        if (selectorPane) return selectorPane.uniqId;

        // Возврат к панели-открывателю (напр. форме с полем «Основание»,
        // из которого открыли документ), если она ещё открыта.
        if (closed.openerPaneId && remainingIds.has(closed.openerPaneId)) {
          return closed.openerPaneId;
        }

        const history = paneHistoryRef.current;
        if (history.length > 0) {
          return history.pop()!;
        }
        const newIndex = index > 0 ? index - 1 : 0;
        return next[Math.min(newIndex, next.length - 1)].uniqId;
      });

      return next;
    });
  }, []);

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

  // Сохранённая сессия панелей (читается один раз, ДО эффекта-персиста, чтобы
  // тот не затёр её пустым состоянием на первом рендере).
  const persistedSessionRef = useRef<PersistedSession | null | undefined>(undefined);
  if (persistedSessionRef.current === undefined) {
    persistedSessionRef.current = loadPersistedSession();
  }
  // restore завершён → можно персистить изменения панелей.
  const restoreDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = persistedSessionRef.current;
      // Ссылка на панель (?open=…) — открыть конкретную форму/справочник/файл.
      const linked = readPaneLink(window.location.search);
      if (session && session.panes.length > 0) {
        // Восстанавливаем панели прошлой сессии по сериализованным рецептам.
        for (const p of session.panes) {
          if (cancelled) return;
          try { await restorePane(p, addPane); } catch { /* пропускаем сбойную панель */ }
        }
        // Делаем активной последнюю активную вкладку (если она восстановлена).
        const activeId = session.activePaneId;
        if (activeId && session.panes.some((p) => p.uniqId === activeId)) {
          setTimeout(() => setActivePaneId(activeId), 0);
        }
      } else if (!linked) {
        // Первый визит / пустая сессия (и нет ссылки) — открываем список по умолчанию.
        // openFormByRef({ endpoint: "Sales", uuid: "213" }, addPane);
      }
      // Открыть панель по ссылке (поверх восстановленной сессии) и очистить URL.
      if (linked && !cancelled) {
        try { await restorePane({ uniqId: "", label: "", restore: linked }, addPane); }
        catch { /* битая ссылка — игнорируем */ }
        clearPaneLinkParam();
      }
      restoreDoneRef.current = true;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Персист открытых панелей + активной вкладки (после завершения restore).
  useEffect(() => {
    if (!restoreDoneRef.current) return;
    savePersistedSession(panes, activePaneId);
  }, [panes, activePaneId]);

  // ────────────────────────────────────────────────
  // Глобальный confirm (замена window.confirm)
  // ────────────────────────────────────────────────
  const { confirm, confirmState } = useConfirm();

  const reloadPane = useCallback(async (uniqId: string) => {
    const api = formStoreAPI.get(uniqId);
    if (api?.reload) {
      await api.reload();
    }
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
        requestClose,
        reloadPane,
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
    [panes, activePaneId, addPane, requestClose, reloadPane, setActivePane, updatePaneLabel, registerBeforeClose, navbarItems, currentUser, handleLogout, confirm]
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
                <Container />
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
