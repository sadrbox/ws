import { TGridSorting, TStoreDataGrid } from "src/ui/DataGridTable/types";
import { atom } from "jotai";

export const storeDataGrid = atom(undefined as TStoreDataGrid);

const initSorting: TGridSorting = {
	columnID: "id",
	orderBy: "ASC",
};
export const storeGridSorting = atom(initSorting);
