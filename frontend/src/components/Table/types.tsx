import { Dispatch, SetStateAction } from "react";
// import { TypeOpenForm } from 'src/components/Table/types';
import { TOpenModelFormProps } from "src/app/types";

export type TOrder = {
  columnID: string;
  direction: "asc" | "desc";
};

export type TDataItem = {
  id: number;
  uuid: string;
  // shortName?: string;
  [key: string | number]: unknown;
};
export type TColumnFooter = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'none';

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
  footer?: TColumnFooter; // итог колонки в tfoot
  /**
   * Если true — в модалке «Колонки таблицы» рядом с чекбоксом видимости
   * отображается дополнительный чекбокс «В печать». Используется для
   * динамических полей (НДС, скидки, акциз и т. п.), которые могут
   * включаться/исключаться из печатной формы независимо от видимости в UI.
   */
  togglePrintable?: boolean;
  /** Текущее состояние «показывать в печатной форме». Игнорируется,
   *  если `togglePrintable !== true`. По умолчанию считается true. */
  printable?: boolean;
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