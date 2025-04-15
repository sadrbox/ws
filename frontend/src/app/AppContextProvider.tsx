import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  Dispatch,
  SetStateAction,
  PropsWithChildren,
} from "react";
import { TypeAppContextProps } from "./types";
// import { TAppContext } from "./types";

type TypeAppContextInstance = {
  appContextProps: TypeAppContextProps;
  setAppContextProps: Dispatch<SetStateAction<TypeAppContextProps>>;
};

const AppContextInstance = createContext<TypeAppContextInstance | undefined>(undefined);
export const AppContextProvider: React.FC<PropsWithChildren<{ init: TypeAppContextProps }>> = ({
  children,
  init,
}) => {
  const [appContextProps, setAppContextProps] = useState<TypeAppContextProps>(init);

  useEffect(() => {
    if (init !== appContextProps) {
      setAppContextProps(init);
    }
  }, [init]);

  return (
    <AppContextInstance.Provider value={{ appContextProps, setAppContextProps }}>
      {children}
    </AppContextInstance.Provider>
  );
};

export const useAppContextProps = () => {
  const context = useContext(AppContextInstance);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return { ...context.appContextProps };
};

export default AppContextProvider;
