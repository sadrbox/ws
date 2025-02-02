import { Dispatch, JSX, PropsWithChildren, ReactNode, SetStateAction, useEffect, useMemo, useState } from "react";
import { createContext, useContext } from "react";
// import { IResponseData } from "./types";
// import { TColumn, TDataItem } from "./index";
import React from "react";
import { TDataGridSettingsContext } from "../types";
// import { TColumn, TDataItem, TOrder } from "./types";
// import { TOrder } from ".";
// import { TColumn, TDataItem } from "src/objects/Todos";

// export type TDataGridSettingsContext = {
//   // IDs: number[];
//   actions: {
//     // loadDataGrid?: () => void;
//   }
//   states: {
//     activeRow?: number | null;
//     setActiveRow?: Dispatch<SetStateAction<number | null>>;
//     gridColumns: TColumn[];
//     setGridColumns: Dispatch<SetStateAction<TColumn[]>>;
//     // sortableRows: number[];
//     // setSortableRows: Dispatch<SetStateAction<number[]>>;
//   }

// };



type TDataGridSettingsContextState = {
  context: TDataGridSettingsContext;
  setContext: Dispatch<SetStateAction<TDataGridSettingsContext>>;
};

export const DataGridSettingsContext = createContext<TDataGridSettingsContextState | undefined>(undefined);


export const useDataGridSettingsContext = () => {
  const context = useContext(DataGridSettingsContext);
  if (!context) {
    throw new Error("useDataGridContext must be used within DataGridContextProvider");
  }
  return context;
};



const DataGridSettingsContextProvider: React.FC<PropsWithChildren<{ initialContext: TDataGridSettingsContext }>> = ({
  children,
  initialContext,
}) => {
  const [context, setContext] = useState<TDataGridSettingsContext>(initialContext);

  useEffect(() => {
    if (initialContext !== context) {
      setContext(initialContext);
    }
  }, [initialContext]);

  return (
    <DataGridSettingsContext.Provider value={{ context, setContext }}>
      {children}
    </DataGridSettingsContext.Provider>
  );
};

export default DataGridSettingsContextProvider;
