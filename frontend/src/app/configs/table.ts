// Значения по умолчанию для параметров таблицы
export const DEFAULT_TABLE_PARAMS = {
	page: 1,
	limit: 100,
	sort: { columnID: "id", direction: "asc" },
	filter: {
		ownerUID: "",
		searchBy: { columns: [], value: "" },
		dateRange: { startDate: null, endDate: null },
	},
	selectedIds: new Set(),
} as const;
