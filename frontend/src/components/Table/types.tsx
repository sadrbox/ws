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

  // checkedRows?: number[];
  // setCheckedRows?: Dispatch<SetStateAction<number[]>>;

  setActiveGrid?: Dispatch<SetStateAction<EActiveTable>>;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  columns?: TColumn[];
  setColumns?: Dispatch<SetStateAction<TColumn[]>>;
  activeRow?: number | null;
  setActiveRow?: Dispatch<SetStateAction<number | null>>;
  selectedRows: number[];
  setSelectedRows: Dispatch<SetStateAction<number[]>>;
  isSelectedRows: boolean;
  toggleSelectAllRows: Dispatch<SetStateAction<boolean>>;
};

export type TResponseData = TDataItem[] & {
  [key: string]: string | number | boolean;
};

export type TypeTableContextProps = {
  name: string;
  rows: TDataItem[];
  columns: TColumn[];
  pagination: {
    currentPage: number;
    setCurrentPage: Dispatch<SetStateAction<number>>;
    totalPages: number;
  };
  query: {
    orderQuery: TOrder;
    setOrderQuery: Dispatch<SetStateAction<TOrder>>;
    fastSearchQuery: string,
    setFastSearchQuery: Dispatch<SetStateAction<string>>;
    dateRangeQuery: TypeDateRange,
    setDateRangeQuery: Dispatch<SetStateAction<TypeDateRange>>;
  };
  actions: {
    loadDataGrid: (page?: number, limit?: number) => Promise<void>;
  };
  states: TypeModelStates;
};


export enum EActiveTable {
  DATA,
  CONFIG,
  FILTER,
}

export type TypeDateRange = {
  startDate?: string | null;
  endDate?: string | null;
};

export type TypeModelProps = TypeTableContextProps

export type TypeFormAction = 'apply' | 'close' | 'open' | '';
export type TypeFormMethod = {
  get: TypeFormAction;
  set: Dispatch<SetStateAction<TypeFormAction>>;
};