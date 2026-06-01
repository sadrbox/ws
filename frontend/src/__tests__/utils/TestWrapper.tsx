import React, { useRef, type PropsWithChildren } from 'react';
import { AppContextProvider } from 'src/app/index';
import type { TypeAppContextProps } from 'src/app/types';

/** Минимальный мок AppContext для использования в тестах */
export const TestWrapper: React.FC<PropsWithChildren> = ({ children }) => {
  const screenRef = useRef<HTMLDivElement | null>(null);

  const value: TypeAppContextProps = {
    screenRef,
    windows: {
      panes: [],
      activePane: null,
      addPane: () => { },
      requestClose: async () => { },
      reloadPane: async () => { },
      setActivePane: () => { },
      updatePaneLabel: () => { },
      registerBeforeClose: () => () => { },
    },
    actions: {
      confirm: () => Promise.resolve(true),
    },
    navbar: {
      props: [],
      setProps: () => { },
    },
    auth: {
      user: null,
      logout: () => { },
    },
  };

  return (
    <AppContextProvider value={value}>
      {children}
    </AppContextProvider>
  );
};
