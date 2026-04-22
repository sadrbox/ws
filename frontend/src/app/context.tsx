import React, { createContext, PropsWithChildren, useContext } from "react";
import type { TypeAppContextProps } from "./types";

const AppContext = createContext<TypeAppContextProps | undefined>(undefined);

export const useAppContext = (): TypeAppContextProps => {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return ctx;
};

export const AppContextProvider: React.FC<PropsWithChildren<{ value: TypeAppContextProps }>> = ({
  children,
  value,
}) => <AppContext.Provider value={value}>{children}</AppContext.Provider>;
