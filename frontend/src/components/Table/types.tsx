import { Dispatch, SetStateAction } from "react";
import { QueryObserverResult } from "@tanstack/react-query";

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
  name: string;
  width?: string;
  minWidth?: string;
  hint?: string;
  alignment?: string;
  sortable?: boolean;
  visible: boolean;
  filter: boolean;
  inlist: boolean;
};
export type TColumnSetting = {
  position: number;
  identifier: string;
  type: string;
  name: string;
  width?: string;
  minWidth?: string;
  hint?: string;
  alignment?: string;
  sortable?: boolean;
  visible: boolean;
  filter: boolean;
  inlist: boolean;
};
export type TypeModelStates = {

  // checkedRows?: number[];
  // setCheckedRows?: Dispatch<SetStateAction<number[]>>;

  // setActiveGrid?: Dispatch<SetStateAction<EActiveTable>>;
  // isLoading: boolean;
  // setIsLoading: Dispatch<SetStateAction<boolean>>;
  // columns?: TColumn[];
  // setColumns?: Dispatch<SetStateAction<TColumn[]>>;
  activeRow?: number | null;
  setActiveRow?: Dispatch<SetStateAction<number | null>>;
  selectedRows: Set<number>;
  setSelectedRows: Dispatch<SetStateAction<Set<number>>>;
  // isSelectedRows: booleDan;
  // toggleSelectAllRows: Dispatch<SetStateAction<boolean>>;
};

export type TResponseData = TDataItem[] & {
  [key: string]: string | number | boolean;
};

export type TypeTableContextProps = {
  model: string;
  rows: TDataItem[];
  columns: TColumn[];
  totalPages: number;
  isLoading: boolean;
  isFetching: boolean;
  query: {
    queryParams: TypeTableParams;
    setQueryParams: (newParams: Partial<TypeTableParams>) => void;
  };
  actions: {
    // loadDataGrid: (page?: number, limit?: number) => Promise<void>;
    setColumns: Dispatch<SetStateAction<TColumn[]>>;
    refetch: () => Promise<QueryObserverResult<{
      items: TDataItem[];
      totalPages: number;
    } | null, Error>>

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

type TypeTableSortDirection = 'asc' | 'desc';

export type TypeTableSort = {
  columnID: string;
  direction: TypeTableSortDirection;
};

export type TypeTableFilter = {
  searchBy?: {
    value: string;
    columns?: {
      identifier: string;
      type: string;
    }[];
  }
  dateRange?: TypeDateRange;
};


export type TypeTableParams = {
  model: string | undefined;
  page: number;
  limit: number;
  // totalPages?: number;
  sort: TypeTableSort;
  filter?: TypeTableFilter;
  selectedIds?: Set<number>;
};

export type TypeModalFormProps = {
  method: TypeFormMethod;
};