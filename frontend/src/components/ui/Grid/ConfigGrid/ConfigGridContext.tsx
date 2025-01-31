import { Dispatch, JSX, PropsWithChildren, ReactNode, SetStateAction, useEffect, useMemo, useState } from "react";
import { createContext, useContext } from "react";
// import { IResponseData } from "./types";
// import { TColumn, TDataItem } from "./index";
import React from "react";
import { TColumn } from "../types";
// import { TColumn, TDataItem, TSorting } from "./types";
// import { TSorting } from ".";
// import { TColumn, TDataItem } from "src/objects/Todos";

export type TContextGridSetting = {
  // IDs: number[];
  actions: {
    // loadDataGrid?: () => void;
  }
  states: {
    activeRow?: number | null;
    setActiveRow?: Dispatch<SetStateAction<number | null>>;
    gridColumns: TColumn[];
    setGridColumns: Dispatch<SetStateAction<TColumn[]>>;
    // sortableRows: number[];
    // setSortableRows: Dispatch<SetStateAction<number[]>>;
  }

};



type TProps = {
  contextGridSetting: TContextGridSetting | undefined;
}

type TContextInstance = {
  context: TContextGridSetting | undefined;
  setContext: Dispatch<SetStateAction<TContextGridSetting | undefined>>;
};

export const ContextInstance = createContext<TContextInstance>({
  context: undefined,
  setContext: () => { },
});

// eslint-disable-next-line react-refresh/only-export-components
export const useContextGridSetting = () => useContext(ContextInstance);

export default function ContextWrapper<T extends PropsWithChildren<TProps>>({ children, contextGridSetting }: T): JSX.Element {

  const [context, setContext] = useState<TContextGridSetting | undefined>(contextGridSetting);

  const contextValue: TContextInstance = useMemo(() => ({
    context, setContext
  }), [context]);

  useEffect(() => {
    if (contextGridSetting !== undefined) {
      setContext(contextGridSetting)
    }
  }, [contextGridSetting])

  return (
    <ContextInstance.Provider value={contextValue}>
      {children}
    </ContextInstance.Provider>
  )
}

