import { TGridSorting, TStoreDataGrid } from "src/DataGridTable/types";
import { atom } from "jotai";

export const storeDataGrid = atom(undefined as TStoreDataGrid);

const iniTOrder: TGridSorting = {
	columnID: "id",
	orderBy: "ASC",
};
export const storeGridSorting = atom(iniTOrder);
