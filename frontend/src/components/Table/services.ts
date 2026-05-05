import { getFormatDateOnly } from "src/utils/main.module";
import { TColumn, TDataItem, TypeTableTypes } from "./types";
import { CSSProperties } from "react";

const getNestedValue = <T>(obj: T, path: string): any => {
	return path.split(".").reduce((acc: any, key) => acc?.[key], obj);
};
/**
 * Сортирует массив строк таблицы по указанной конфигурации сортировки
 * @param arr - массив элементов для сортировки
 * @param sort - объект вида { "name": "asc", "id": "desc" } или пустой объект
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

export function getModelColumns(
	initColumns: TColumn[],
	modelName: string,
	type?: TypeTableTypes,
): TColumn[] {
	const storageKey = `table_columns_${modelName}`;

	// Для подчинённых таблиц ownerName скрыт по умолчанию
	let defaults = initColumns;
	if (type === "part") {
		defaults = initColumns.map((col) =>
			col.identifier === "ownerName" ? { ...col, visible: false } : col,
		);
	}

	let columns = defaults;
	const storageColumns = localStorage.getItem(storageKey);
	if (storageColumns !== null) {
		try {
			const cached: TColumn[] = JSON.parse(storageColumns);
			// Проверяем актуальность кэша: набор identifier + type должен совпадать
			const initSig = defaults
				.map((c) => `${c.identifier}:${c.type}`)
				.sort()
				.join(",");
			const cachedSig = cached
				.map((c) => `${c.identifier}:${c.type}`)
				.sort()
				.join(",");
			if (initSig === cachedSig) {
				// Берём кэш (ширины, видимость), но sortable всегда из JSON-определения
				columns = cached.map((c) => {
					const def = defaults.find((d) => d.identifier === c.identifier);
					return def ? { ...c, sortable: def.sortable } : c;
				});
			} else {
				// Столбцы изменились — сбрасываем устаревший кэш
				localStorage.removeItem(storageKey);
			}
		} catch {
			localStorage.removeItem(storageKey);
		}
	}

	return columns;
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

export function getFormatColumnValue(
	row: TDataItem,
	column: TColumn,
): string | number {
	// Разрешаем значение: точечная нотация (user.username) → вложенный объект
	let rawValue: any;
	if (column.identifier.includes(".")) {
		rawValue = getNestedValue(row, column.identifier);
	} else {
		rawValue = row[column.identifier as keyof TDataItem];
	}
	// Если значение null или undefined — пустая строка
	if (rawValue == null) return "";

	if (column.identifier === "id" && column.type === "number") {
		return getFormatNumericalID(Number(row.id));
	} else if (
		column.identifier !== "id" &&
		column.identifier !== "position" &&
		column.type === "number"
	) {
		return getFormatNumerical(rawValue as number);
	} else if (column.identifier === "position" && column.type === "position") {
		return rawValue + "";
	} else if (column.type === "date") {
		return getFormatDateOnly(rawValue as string);
	} else if (column.type === "string") {
		return rawValue != null ? rawValue + "" : "";
	} else if (column.type === "boolean") {
		return rawValue ? "✔" : "";
	}
	return "";
}

// Формат числовой идентификатор /////////////////////////////////////////////////////////////////////////
function getFormatNumericalID(n: number): string {
	// return n.toString().padStart(5, "0");
	return n.toString();
}

// Формат числа /////////////////////////////////////////////////////////////////////////
export function getFormatNumerical(n: number): string {
	const formater = new Intl.NumberFormat("ru-RU", {
		style: "decimal",
		// minimumFractionDigits: 9,
		maximumFractionDigits: 9,
	});
	return formater.format(n);
}

/**
 * Нормализует форматированную числовую строку к стандартному виду с точкой.
 *
 * Удаляет разделители тысяч (пробелы, неразрывные пробелы U+00A0 и U+202F),
 * заменяет десятичную запятую на точку. Используется для input[type=text]
 * числовых полей, а также в правилах валидации.
 *
 * Примеры: "1 000" → "1000", "3,5" → "3.5", "10 000,75" → "10000.75"
 * Возвращает null если строку нельзя привести к числу.
 */
export function parseNumericInput(value: string): number | null {
	if (!value || value.trim() === "") return null;
	const normalized = value.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
	const n = Number(normalized);
	return isNaN(n) ? null : n;
}
