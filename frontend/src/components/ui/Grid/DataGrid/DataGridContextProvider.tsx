import React, {
  createContext,
  useContext,
  // useEffect,
  // useState,
  // Dispatch,
  // SetStateAction,
  PropsWithChildren,
} from "react";
import { TDataGridContext } from "../types";

// type TGridContextInstance = {
//   context: TDataGridContext | undefined;
//   setContext: Dispatch<SetStateAction<TDataGridContext | undefined>>;
// };

export const DataGridContext = createContext<TDataGridContext | undefined>(undefined);

export const useDataGridContext = () => {
  const context = useContext(DataGridContext);
  if (context) {
    return context;
    // throw new Error("useDataGridContext must be used within DataGridContextProvider");
  }
};

const DataGridContextProvider: React.FC<PropsWithChildren<{ initialContext?: TDataGridContext }>> = ({
  children,
  initialContext,
}) => {
  // const [context, setContext] = useState<TDataGridContext | undefined>(initialContext);

  // useEffect(() => {
  //   if (initialContext && initialContext !== context) {
  //     setContext(initialContext);
  //   }
  // }, [initialContext]);

  return (
    <DataGridContext.Provider value={initialContext}>
      {children}
    </DataGridContext.Provider>
  );
};

export default DataGridContextProvider;
