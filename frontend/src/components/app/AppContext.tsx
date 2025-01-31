import { Dispatch, JSX, PropsWithChildren, ReactNode, SetStateAction, useEffect, useMemo, useState } from "react";
import { createContext, useContext } from "react";
import { TTabs } from "../ui/Tabs/types"


export type TAppContextData = {
  elementID: string | number;
} | undefined;

type TProps = {
  state: TAppContextData | undefined;
}

export type TContextInstance = {
  context: TAppContextData | undefined;
  setContext: Dispatch<SetStateAction<TAppContextData>>;
};

const ContextInstance = createContext<TContextInstance>({
  context: undefined,
  setContext: () => {
    throw new Error("setContext must be used within a ContextWrapper");
  },
});

export function useAppContext() {
  const context = useContext(ContextInstance);
  if (context === undefined) {
    throw new Error("setContext must be used within a ContextWrapper");
  }
  return context;
}


export default function AppContext<T extends PropsWithChildren<TProps>>({ children, state }: T): JSX.Element {
  const [context, setContext] = useState<TAppContextData | undefined>(state);

  const contextValue: TContextInstance = useMemo(() => ({
    context, setContext
  }), [context]);

  useEffect(() => {
    if (state !== undefined) {
      setContext(state)
    }
  }, [state])
  return (
    <ContextInstance.Provider value={contextValue}>
      {children}
    </ContextInstance.Provider>
  )
}
