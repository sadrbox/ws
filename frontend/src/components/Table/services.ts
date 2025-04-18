import { TColumn, TDataItem, TOrder } from "./types";
import { CSSProperties } from "react";

const getNestedValue = <T>(obj: T, path: string): any => {
	return path.split(".").reduce((acc: any, key) => acc?.[key], obj);
};
const isCompositeKey = (key: string): boolean => key.includes(".");

export function sortTableRows(
	arr: TDataItem[],
	order: TOrder,
	locale = "default"
): TDataItem[] {
	if (!order.columnID || !order.direction) return arr || [];

	const { columnID, direction } = order;

	return [...arr].sort((a, b) => {
		if (isCompositeKey(columnID)) {
			// Добавь логику для составных ключей, если необходимо
		}

		const aValue = getNestedValue(a, columnID);
		const bValue = getNestedValue(b, columnID);

		// Обработка null и undefined: перемещаем их в конец
		if (aValue == null && bValue == null) return 0;
		if (aValue == null) return 1;
		if (bValue == null) return -1;

		// Числовое сравнение
		if (typeof aValue === "number" && typeof bValue === "number") {
			return direction === "asc" ? aValue - bValue : bValue - aValue;
		}

		// Строковое сравнение
		if (typeof aValue === "string" && typeof bValue === "string") {
			return direction === "asc"
				? aValue.localeCompare(bValue, locale, { numeric: true })
				: bValue.localeCompare(aValue, locale, { numeric: true });
		}

		return 0; // Если типы не совпадают или их нельзя сравнить
	});
}

export function getModelColumns(
	initColumns: TColumn[],
	modelName: string
): TColumn[] {
	const storageColumns = localStorage.getItem(modelName);
	if (storageColumns !== null) {
		const columns = JSON.parse(storageColumns);
		// console.log(columns);
		return columns;
	}
	return initColumns;
}

// Функция для поиска ширины колонки по id
export function getColumnWidthById(
	columns: TColumn[],
	columnId: string
): string {
	// console.log(tableParams);
	const column = columns.find((col) => col.identifier === columnId);
	return column?.width ? column.width : "auto"; // Возвращает ширину или undefined, если не найдено
}

// Функция для поиска ширины колонки по id модификация
export function getColumnWidthSetting(
	columns: TColumn[],
	columnID: string
): string | undefined {
	const column = columns.find((col) => col.identifier === columnID);
	return column ? column.width : "auto"; // Возвращает ширину или undefined, если не найдено
}

export function getColumnSettings<T extends TColumn>(
	columns: T[],
	columnID: string
): T | undefined {
	return columns.find((column) => {
		if (column.identifier === columnID) {
			return column;
		}
	});
}

export function getColumnWidth<T extends TColumn>(
	columns: T[],
	columnID: keyof T | string
): T | undefined {
	return columns.find((column) => {
		if (column.identifier === columnID) {
			return column;
		}
	});
}

export function getTextAlignByColumnType(column: TColumn): CSSProperties {
	switch (column.type) {
		case "number":
			return { textAlign: "right" }; // align-items - не подойдет!
		case "string":
			return { textAlign: "left" };
		case "switcher":
			return { textAlign: "center" };
		default:
			return { textAlign: "left" };
	}
}
export function getColumnSettingValue(
	rowSettingColumn: TColumn,
	column: TColumn
): string {
	if (column.type === "string") {
		return rowSettingColumn[column.identifier as keyof TColumn] + "";
	} else if (column.type === "number") {
		return rowSettingColumn[column.identifier as keyof TColumn] + "";
	}
	return rowSettingColumn[column.identifier as keyof TColumn] + "";
}

export function getFormatColumnValue(
	row: TDataItem,
	column: TColumn
): string | number {
	if (column.identifier === "id" && column.type === "number") {
		return getFormatNumericalID(+row.id);
	} else if (
		column.identifier !== "id" &&
		column.identifier !== "position" &&
		column.type === "number"
	) {
		return getFormatNumerical(+row[column.identifier]);
	} else if (column.identifier === "position" && column.type === "position") {
		return row[column.identifier] + "";
	} else if (column.type === "date") {
		const date = getFormatDate(row[column.identifier] as string);
		return date;
		// k else if (column.type === "object") {
		// 	return getValueByIdentifier(row, column.identifier);
	} else if (column.type === "string") {
		const [field, subField]: string[] = column.identifier.split(".");

		if (typeof row[field] === "object" && row[field] !== null) {
			return (row[field] as Record<string, any>)[subField];
		} else {
			// console.log(row);
			return row[column.identifier] !== undefined
				? row[column.identifier] + ""
				: "";
		}
	}
	return "";
}

const getValueByIdentifier = (row: any, identifier: string): any => {
	return identifier.split(".").reduce((acc, key) => acc?.[key], row);
};

// Формат числовой идентификатор /////////////////////////////////////////////////////////////////////////
export function getFormatNumericalID(n: number): string {
	return n.toString().padStart(5, "0");
}

// Формат числа /////////////////////////////////////////////////////////////////////////
export function getFormatNumerical(n: number): string {
	const formater = new Intl.NumberFormat("ru-RU", {
		style: "decimal",
		minimumFractionDigits: 1,
	});
	return formater.format(n);
}

// Формат даты /////////////////////////////////////////////////////////////////////////
export function getFormatDate(d: string): string {
	const date = new Date(d);
	const localDateString = date.toLocaleString();

	return localDateString;
}
