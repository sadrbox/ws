import { getFormatDate } from "src/utils/main.module";
import { TColumn, TDataItem, TOrder, TypeTableTypes } from "./types";
import { CSSProperties } from "react";

const getNestedValue = <T>(obj: T, path: string): any => {
	return path.split(".").reduce((acc: any, key) => acc?.[key], obj);
};
const isCompositeKey = (key: string): boolean => key.includes(".");

/**
 * Сортирует массив строк таблицы по указанной конфигурации сортировки
 * @param arr - массив элементов для сортировки
 * @param sort - объект вида { "createdAt": "desc", "name": "asc" } или пустой объект
 * @param locale - локаль для строкового сравнения (по умолчанию "default")
 * @returns новый отсортированный массив (оригинал не меняется)
 */
export function sortTableRows<T>(
	arr: readonly T[] | null | undefined,
	sort: Record<string, "asc" | "desc">,
	locale: string = "default",
): T[] {
	// Защита от некорректных входных данных
	if (!arr || arr.length === 0) {
		return [];
	}

	if (!sort || Object.keys(sort).length === 0) {
		return [...arr];
	}

	return [...arr].sort((a, b) => {
		// Проходим по всем полям сортировки по порядку (multi-sort)
		for (const [columnID, direction] of Object.entries(sort)) {
			const aValue = getNestedValue(a, columnID);
			const bValue = getNestedValue(b, columnID);

			// null / undefined → в конец независимо от направления
			if (aValue == null && bValue == null) continue;
			if (aValue == null) return 1;
			if (bValue == null) return -1;

			// Числовое сравнение
			if (typeof aValue === "number" && typeof bValue === "number") {
				const diff = aValue - bValue;
				if (diff !== 0) {
					return direction === "asc" ? diff : -diff;
				}
				continue;
			}

			// Строковое сравнение с поддержкой чисел внутри строк
			if (typeof aValue === "string" && typeof bValue === "string") {
				const comparison = aValue.localeCompare(bValue, locale, {
					numeric: true,
					sensitivity: "base",
				});

				if (comparison !== 0) {
					return direction === "asc" ? comparison : -comparison;
				}
				continue;
			}

			// Даты (если в данных могут быть Date объекты)
			if (aValue instanceof Date && bValue instanceof Date) {
				const diff = aValue.getTime() - bValue.getTime();
				if (diff !== 0) {
					return direction === "asc" ? diff : -diff;
				}
				continue;
			}

			// Если типы разные или не умеем сравнивать → считаем равными по этому полю
		}

		// Все поля дали равенство → сохраняем относительный порядок
		return 0;
	});
}

// Вспомогательная функция для получения вложенного значения
// function getNestedValue(obj: any, path: string): unknown {
// 	if (obj == null || !path) return undefined;

// 	let current: any = obj;
// 	const parts = path.split(".");

// 	for (const part of parts) {
// 		if (current == null) return undefined;
// 		current = current[part];
// 	}

// 	return current;
// }

export function getModelColumns(
	initColumns: TColumn[],
	modelName: string,
	type?: TypeTableTypes,
): TColumn[] {
	let columns = initColumns;
	const storageColumns = localStorage.getItem(modelName);
	if (storageColumns !== null) {
		columns = JSON.parse(storageColumns);
	}

	if (!!type && type === "part") {
		columns = columns.filter((col) => col.identifier !== "ownerName");
	}
	return columns;
}

// Функция для поиска ширины колонки по id
export function getColumnWidthById(
	columns: TColumn[],
	columnId: string,
): string {
	// console.log(tableParams);
	const column = columns.find((col) => col.identifier === columnId);
	return column?.width ? column.width : "auto"; // Возвращает ширину или undefined, если не найдено
}

// Функция для поиска ширины колонки по id модификация
export function getColumnWidthSetting(
	columns: TColumn[],
	columnID: string,
): string | undefined {
	const column = columns.find((col) => col.identifier === columnID);
	return column ? column.width : "auto"; // Возвращает ширину или undefined, если не найдено
}

export function getColumnSettings<T extends TColumn>(
	columns: T[],
	columnID: string,
): T | undefined {
	return columns.find((column) => {
		if (column.identifier === columnID) {
			return column;
		}
	});
}

export function getColumnWidth<T extends TColumn>(
	columns: T[],
	columnID: keyof T | string,
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
			return { justifyContent: "right" }; // align-items - не подойдет!
		case "string":
			return { justifyContent: "left" };
		case "switcher":
			return { justifyContent: "center" };
		default:
			return { justifyContent: "left" };
	}
}
export function getColumnSettingValue(
	rowSettingColumn: TColumn,
	column: TColumn,
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
	column: TColumn,
): string | number {
	if (column.identifier === "id" && column.type === "number") {
		return getFormatNumericalID(+row.id);
	} else if (
		column.identifier !== "id" &&
		column.identifier !== "position" &&
		column.type === "number"
	) {
		return getFormatNumerical(
			+(row[column.identifier as keyof TDataItem] as number),
		);
	} else if (column.identifier === "position" && column.type === "position") {
		return row[column.identifier] + "";
	} else if (column.type === "date") {
		const date = getFormatDate(row[column.identifier] as string);
		return date;
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

// Формат числовой идентификатор /////////////////////////////////////////////////////////////////////////
export function getFormatNumericalID(n: number): string {
	// return n.toString().padStart(5, "0");
	return n.toString();
}

// Формат числа /////////////////////////////////////////////////////////////////////////
export function getFormatNumerical(n: number): string {
	const formater = new Intl.NumberFormat("ru-RU", {
		style: "decimal",
		minimumFractionDigits: 1,
	});
	return formater.format(n);
}

// // Формат даты /////////////////////////////////////////////////////////////////////////
// export function getFormatDate(d: string): string {
// 	const date = new Date(d);

// 	// Проверка на валидность даты и на эпоху Unix (01.01.1970)
// 	if (isNaN(date.getTime()) || date.getTime() === 0) {
// 		return ""; // Возвращаем пустую строку или другое значение по умолчанию
// 	}

// 	const localDateString = date.toLocaleString();
// 	return localDateString;
// }
