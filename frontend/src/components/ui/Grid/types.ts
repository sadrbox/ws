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

export type TSorting = {
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
export type TModelStates = {
	activeRow?: number | null;
	setActiveRow?: Dispatch<SetStateAction<number | null>>;
	checkedRows?: number[];
	setCheckedRows?: Dispatch<SetStateAction<number[]>>;
	orderRows?: TSorting;
	setOrderRows?: Dispatch<SetStateAction<TSorting>>;
	isAllChecked?: boolean;
	setIsAllChecked?: Dispatch<SetStateAction<boolean>>;
	setActiveGrid?: Dispatch<SetStateAction<EActiveGrid>>;
	isLoadedGrid: boolean;
	setIsLoadedGrid: Dispatch<SetStateAction<boolean>>;
};

export type TResponseData = TDataItem[] & {
	[key: string]: string | number | boolean;
};

export type TDataGridContext = {
	name: string;
	rows: TDataItem[];
	columns: TColumn[];
	order: TSorting;
	actions: {
		loadDataGrid: () => Promise<void>;
		setOrder: Dispatch<SetStateAction<TSorting>>;
	};
	states?: TModelStates;
};

export type TModelProps = {
	name: string;
	rows: TDataItem[];
	columns: TColumn[];
	order: TSorting;
	actions: {
		loadDataGrid: () => void;
		setOrder: Dispatch<SetStateAction<TSorting>>;
	};
	states?: TModelStates;
};

export enum EActiveGrid {
	DATA,
	CONFIG,
	FILTER,
}
