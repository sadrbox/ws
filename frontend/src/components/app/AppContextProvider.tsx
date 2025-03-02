import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  Dispatch,
  SetStateAction,
  PropsWithChildren,
} from "react";
import { TAppContext } from "./types";

type TAppContextState = {
  context: TAppContext;
  setContext: Dispatch<SetStateAction<TAppContext>>;
};

const AppContext = createContext<TAppContextState | undefined>(undefined);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return context;
};

const AppContextProvider: React.FC<PropsWithChildren<{ initialContext: TAppContext }>> = ({
  children,
  initialContext,
}) => {
  const [context, setContext] = useState<TAppContext>(initialContext);

  useEffect(() => {
    if (initialContext !== context) {
      setContext(initialContext);
    }
  }, [initialContext]);

  return (
    <AppContext.Provider value={{ context, setContext }}>
      {children}
    </AppContext.Provider>
  );
};

export default AppContextProvider;
