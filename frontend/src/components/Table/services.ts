import { getFormatDateOnly } from "src/utils/datetime";
import { getFormatDate } from "src/utils/datetime";
import { TColumn, TDataItem, TypeTableTypes } from "./types";

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
			const parsed: TColumn[] = JSON.parse(storageColumns);
			// Служебные колонки (identifier начинается с "__", напр. "__rowActions")
			// инжектируются в рантайме и НЕ участвуют в кэше/сигнатуре — иначе
			// сигнатура не совпадёт с defaults и настройки колонок будут сбрасываться.
			const cached = parsed.filter((c) => !c.identifier.startsWith("__"));
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
				// Берём кэш (ширины, видимость), но sortable всегда из JSON-определения,
				// чтобы изменения в исходных схемах колонок применялись без сброса кэша.
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

// ── Персистентность вида таблицы: сортировка + период (dateRange) ────────────
// Колонки хранятся отдельно (table_columns_*, см. getModelColumns). Здесь —
// параметры сортировки и выбранный период, по тому же componentName.
const TABLE_VIEW_PREFIX = "table_view_";

export interface TableViewState {
	sort?: Record<string, "asc" | "desc">;
	dateRange?: { startDate?: string; endDate?: string };
}

export function loadTableView(componentName: string): TableViewState | null {
	try {
		const raw = localStorage.getItem(TABLE_VIEW_PREFIX + componentName);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as TableViewState) : null;
	} catch {
		return null;
	}
}

export function saveTableView(componentName: string, view: TableViewState): void {
	try {
		const hasSort = view.sort && Object.keys(view.sort).length > 0;
		const hasRange = !!(view.dateRange && (view.dateRange.startDate || view.dateRange.endDate));
		// Пустое состояние — убираем ключ, чтобы не копить мусор в localStorage.
		if (!hasSort && !hasRange) {
			localStorage.removeItem(TABLE_VIEW_PREFIX + componentName);
			return;
		}
		localStorage.setItem(TABLE_VIEW_PREFIX + componentName, JSON.stringify(view));
	} catch {
		/* localStorage недоступен (приватный режим/квота) — не критично */
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
		return getFormatNumerical(rawValue as number, column.decimals);
	} else if (column.identifier === "position" && column.type === "position") {
		return rawValue + "";
	} else if (column.type === "date") {
		return getFormatDateOnly(rawValue as string);
	} else if (column.type === "datetime") {
		return getFormatDate(rawValue as string);
	} else if (column.type === "string") {
		return rawValue != null ? rawValue + "" : "";
	} else if (column.type === "boolean") {
		return rawValue ? "✔" : "";
	}
	return "";
}

// ── Горизонтальное выравнивание содержимого ячейки ──────────────────────
// Числа выравниваются по правому краю (так удобно сравнивать разряды),
// булевы — по центру (галочка/пусто), остальные типы — по левому краю.
// Если в описании колонки явно задан `alignment`, он имеет приоритет.
export type THorizontalAlign = "left" | "right" | "center";

export function getColumnAlignment(column: TColumn): THorizontalAlign {
	const explicit = column.alignment;
	if (explicit === "left" || explicit === "right" || explicit === "center") {
		return explicit;
	}
	switch (column.type) {
		case "number":
		case "position":
			return "right";
		case "boolean":
			return "center";
		default:
			return "left";
	}
}

// Формат числовой идентификатор /////////////////////////////////////////////////////////////////////////
function getFormatNumericalID(n: number): string {
	// return n.toString().padStart(5, "0");
	return n.toString();
}

/**
 * Быстрый поиск строки по видимым колонкам.
 *
 * Ищет только по ВИДИМЫМ колонкам (visible=true), поддерживает ссылочные
 * поля (объекты с вложенными данными, например unitOfMeasure.name).
 * Слова поиска должны быть предварительно нормализованы (toLowerCase, trim,
 * замена запятой на точку).
 */
export function matchRowBySearch(
	row: TDataItem,
	visibleColumns: TColumn[],
	searchWords: string[],
): boolean {
	if (searchWords.length === 0) return true;
	const parts: string[] = [];

	const collectStrings = (obj: unknown) => {
		if (obj == null) return;
		if (typeof obj === "object") {
			for (const v of Object.values(obj as Record<string, unknown>)) {
				collectStrings(v);
			}
		} else if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
			parts.push(String(obj).toLowerCase());
		}
	};

	for (const col of visibleColumns) {
		const rawValue = getNestedValue(row, col.identifier);
		if (rawValue == null) continue;
		if (typeof rawValue === "object") {
			// Ссылочное поле — собираем все строковые значения из объекта
			collectStrings(rawValue);
		} else {
			// Примитивное поле — используем форматированное значение
			const formatted = getFormatColumnValue(row, col);
			if (formatted !== "" && formatted != null) {
				const s = String(formatted).toLowerCase();
				parts.push(s);
				// Поиск «Номера» с учётом префикса: помимо исходного «реал-4572»
				// добавляем вариант без разделителей — «реал4572». Тогда документ
				// находится и при вводе «реал4572», и «реал 4572», и «4572».
				if (col.identifier === "number") {
					const compact = s.replace(/[^\p{L}\p{N}]+/gu, "");
					if (compact && compact !== s) parts.push(compact);
				}
			}
		}
	}

	const haystack = parts.join(" ");
	return searchWords.every((w) => haystack.includes(w));
}

// Формат числа /////////////////////////////////////////////////////////////////////////
export function getFormatNumerical(n: number, maxDecimals = 9): string {
	return new Intl.NumberFormat("ru-RU", {
		style: "decimal",
		maximumFractionDigits: maxDecimals,
	}).format(n);
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
