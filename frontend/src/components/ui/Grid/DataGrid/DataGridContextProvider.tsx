import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  Dispatch,
  SetStateAction,
  PropsWithChildren,
} from "react";
import { TDataGridContext } from "../types";

type TDataGridContextState = {
  context: TDataGridContext;
  setContext: Dispatch<SetStateAction<TDataGridContext>>;
};

export const DataGridContext = createContext<TDataGridContextState | undefined>(undefined);

export const useDataGridContext = () => {
  const context = useContext(DataGridContext);
  if (!context) {
    throw new Error("useDataGridContext must be used within DataGridContextProvider");
  }
  return context;
};

const DataGridContextProvider: React.FC<PropsWithChildren<{ initialContext: TDataGridContext }>> = ({
  children,
  initialContext,
}) => {
  const [context, setContext] = useState<TDataGridContext>(initialContext);

  useEffect(() => {
    if (initialContext !== context) {
      setContext(initialContext);
    }
  }, [initialContext]);

  return (
    <DataGridContext.Provider value={{ context, setContext }}>
      {children}
    </DataGridContext.Provider>
  );
};

export default DataGridContextProvider;
