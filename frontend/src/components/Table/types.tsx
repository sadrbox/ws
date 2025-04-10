import { Dispatch, SetStateAction } from "react";

export type TFieldType =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "symbol"
  | "undefined"
  | "object"
  | "function"
  | unknown[];

export type TOrder = {
  columnID: string;
  direction: "asc" | "desc";
};

export type TDataRow = { [key: string | number]: string | number | boolean };
export type TDataItem = {
  id: number;
  [key: string | number]: string | number | boolean;
};
export type TColumn = {
  position: number;
  identifier: string;
  type: string;
  column?: string;
  width?: string;
  hint?: string;
  alignment?: string;
  sortable?: boolean;
  visible: boolean;
};
export type TColumnSetting = {
  position: number;
  identifier: string;
  type: string;
  column?: string;
  width?: string;
  hint?: string;
  alignment?: string;
  sortable?: boolean;
  visible: boolean;
};
export type TypeModelStates = {
  activeRow?: number | null;
  setActiveRow?: Dispatch<SetStateAction<number | null>>;
  checkedRows?: number[];
  setCheckedRows?: Dispatch<SetStateAction<number[]>>;
  order: TOrder;
  setOrder: Dispatch<SetStateAction<TOrder>>;
  isAllChecked?: boolean;
  setIsAllChecked?: Dispatch<SetStateAction<boolean>>;
  setActiveGrid?: Dispatch<SetStateAction<EActiveTable>>;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
};

export type TResponseData = TDataItem[] & {
  [key: string]: string | number | boolean;
};

export type TypeTableContextProps = {
  name: string;
  rows: TDataItem[];
  columns: TColumn[];
  actions?: {
    loadDataGrid?: () => Promise<void>;
    setColumnsi?: Dispatch<SetStateAction<TColumn[]>>;
  };
  states: TypeModelStates;
};


export enum EActiveTable {
  DATA,
  CONFIG,
  FILTER,
}

export type TypeModelProps = {
  name: string;
  rows: TDataItem[];
  columns: TColumn[];
  pagination: {
    currentPage: number;
    setCurrentPage: Dispatch<SetStateAction<number>>;
    totalPages: number;
  }
  actions: {
    loadDataGrid: (currentPage: number, limit?: number) => Promise<void>;
  };
  states: TypeModelStates;
};
