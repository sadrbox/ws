import { Dispatch, SetStateAction } from "react";
// import { TypeOpenForm } from 'src/components/Table/types';
import { TOpenModelFormProps, TPane } from "src/app/types";

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
  uuid: string;
  createdAt: string;
  updatedAt: string;
  // shortName?: string;
  [key: string | number]: unknown;
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
  activeRow?: number | null;
  setActiveRow?: Dispatch<SetStateAction<number | null>>;
  selectedRows: Set<number>;
  setSelectedRows: Dispatch<SetStateAction<Set<number>>>;
};

export type TResponseData = TDataItem[] & {
  [key: string]: string | number | boolean;
};

export type TypeTableTypes = "part" | "list" | undefined;

export type TOpenModelForm = (form: TOpenModelFormProps) => void;


export enum EActiveTable {
  DATA,
  CONFIG,
  FILTER,
}

export type TypeDateRange = {
  startDate?: string | null;
  endDate?: string | null;
};


export type TypeFormAction = 'apply' | 'close' | 'open' | '';
export type TypeFormMethod = {
  get: TypeFormAction;
  set: Dispatch<SetStateAction<TypeFormAction>>;
};

// export type TypeTableSort = {
//   columnID: string;
//   direction: TypeTableSortDirection;
// };
export type TSortDirectionTable = 'asc' | 'desc';
export type TSortTable = {
  [key: string]: TSortDirectionTable,
  // createdAt?: TSortDirectionTable;
};

export type TypeTableFilter = {
  ownerUID?: string;
  searchBy?: {
    value: string;
    columns?: {
      identifier: string;
      type: string;
    }[];
  }
  dateRange?: TypeDateRange;
};


export type TypeModalFormProps = {
  method: TypeFormMethod;
};
export interface FetchDataResult<T> {
  items: T[];
  total: number;
  totalPages: number;
};