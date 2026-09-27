import React, { createContext, PropsWithChildren, useCallback, useContext, useMemo, useRef } from "react";
import type { TypeAppActions, TypeAppContextProps, TypeAppPanesState } from "./types";

/*
 * КОНТЕКСТ ПРИЛОЖЕНИЯ РАЗДЕЛЁН ПО ЧАСТОТЕ ИЗМЕНЕНИЙ (аудит 26.09, О3).
 *
 * Раньше был один контекст: панели, порядок вкладок, активная, навбар, пользователь и все
 * действия. Переключение вкладки меняло его значение, и перерисовывались ВСЕ потребители —
 * каждая открытая форма, список, поле-ссылка: при десяти панелях десять полных деревьев
 * на клик. Теперь рядом с полным контекстом лежат части:
 *   • useAppActions() — стабильные функции (открыть/закрыть панель, подтверждение…),
 *     значение не меняется за всю жизнь приложения;
 *   • useAppPanes()   — панели, порядок вкладок, активная;
 *   • useAppNavbar()  — пункты навбара;
 *   • useAppAuth()    — пользователь и выход (меняется только при входе и смене организации).
 * useAppContext() остаётся прежним (полный объект, перерисовка на любое изменение) — для
 * совместимости; новому коду брать нужную часть.
 *
 * Части собираются здесь из того же `value`, что и раньше: провайдер один, и тесты,
 * подставляющие значение целиком, получают все части без доработок.
 */
const AppContext = createContext<TypeAppContextProps | undefined>(undefined);
const AppActionsContext = createContext<TypeAppActions | undefined>(undefined);
const AppPanesContext = createContext<TypeAppPanesState | undefined>(undefined);
const AppNavbarContext = createContext<TypeAppContextProps["navbar"] | undefined>(undefined);
const AppAuthContext = createContext<TypeAppContextProps["auth"] | undefined>(undefined);

function required<T>(value: T | undefined, hook: string): T {
  if (!value) {
    throw new Error(`${hook} must be used within AppContextProvider`);
  }
  return value;
}

export const useAppContext = (): TypeAppContextProps =>
  required(useContext(AppContext), "useAppContext");

/** Стабильные действия приложения: значение не меняется — потребитель не перерисовывается от чужих панелей. */
export const useAppActions = (): TypeAppActions =>
  required(useContext(AppActionsContext), "useAppActions");

/** Панели, порядок вкладок и активная панель. */
export const useAppPanes = (): TypeAppPanesState =>
  required(useContext(AppPanesContext), "useAppPanes");

/** Пункты навбара и их установка. */
export const useAppNavbar = (): TypeAppContextProps["navbar"] =>
  required(useContext(AppNavbarContext), "useAppNavbar");

/** Текущий пользователь и выход. */
export const useAppAuth = (): TypeAppContextProps["auth"] =>
  required(useContext(AppAuthContext), "useAppAuth");

export const AppContextProvider: React.FC<PropsWithChildren<{ value: TypeAppContextProps }>> = ({
  children,
  value,
}) => {
  const { screenRef, windows, actions, navbar, auth } = value;
  const { panes, paneOrder, activePane } = windows;

  // Зеркала для getPanes/getActivePane: обработчик читает список на момент вызова, а не
  // на момент рендера, и потому не обязан подписываться на каждое изменение панелей.
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const activeRef = useRef(activePane);
  activeRef.current = activePane;
  const getPanes = useCallback(() => panesRef.current, []);
  const getActivePane = useCallback(() => activeRef.current, []);

  const { addPane, requestClose, reloadPane, setActivePane, updatePaneLabel, registerBeforeClose } = windows;
  const { confirm } = actions;
  const { setProps } = navbar;
  const { logout } = auth;
  const actionsValue = useMemo<TypeAppActions>(
    () => ({
      screenRef,
      windows: { addPane, requestClose, reloadPane, setActivePane, updatePaneLabel, registerBeforeClose, getPanes, getActivePane },
      actions: { confirm },
      navbar: { setProps },
      auth: { logout },
    }),
    [screenRef, addPane, requestClose, reloadPane, setActivePane, updatePaneLabel, registerBeforeClose, getPanes, getActivePane, confirm, setProps, logout],
  );
  const panesValue = useMemo<TypeAppPanesState>(
    () => ({ panes, paneOrder, activePane }),
    [panes, paneOrder, activePane],
  );
  // Объекты navbar и auth собираются заново вместе с полным значением (на каждое изменение
  // панелей), поэтому их части мемоизируются по полям, а не по самому объекту.
  const navbarProps = navbar.props;
  const navbarValue = useMemo(() => ({ props: navbarProps, setProps }), [navbarProps, setProps]);
  const user = auth.user;
  const authValue = useMemo(() => ({ user, logout }), [user, logout]);

  return (
    <AppContext.Provider value={value}>
      <AppActionsContext.Provider value={actionsValue}>
        <AppPanesContext.Provider value={panesValue}>
          <AppNavbarContext.Provider value={navbarValue}>
            <AppAuthContext.Provider value={authValue}>{children}</AppAuthContext.Provider>
          </AppNavbarContext.Provider>
        </AppPanesContext.Provider>
      </AppActionsContext.Provider>
    </AppContext.Provider>
  );
};
