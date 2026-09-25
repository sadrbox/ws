import { getFormatDateOnly } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { TColumn, TDataItem, TypeTableTypes } from "./types";
import { getTranslateColumn } from "src/i18";

/** Значение по точечному пути (user.employee.fullName). Возвращает unknown —
 *  вызывающий сам решает, как трактовать (форматирование/сравнение). */
const getNestedValue = <T>(obj: T, path: string): unknown =>
	path.split(".").reduce<unknown>(
		(acc, key) => (acc as Record<string, unknown> | null | undefined)?.[key],
		obj,
	);
/**
 * Сортирует массив строк таблицы по указанной конфигурации сортировки
 * @param arr - массив элементов для сортировки
 * @param sort - объект вида { "name": "asc", "id": "desc" } или пустой объект
 * @param locale - локаль для строкового сравнения (по умолчанию "default")
 * @param getValue - значение для сравнения; по умолчанию — поле строки по пути колонки. Нужен колонкам, где
 *   хранится ключ, а видна подпись (FieldSelect): сортировать надо по тому, что видит человек.
 * @returns новый отсортированный массив (оригинал не меняется)
 */
export function sortTableRows<T>(
	arr: readonly T[] | null | undefined,
	sort: Record<string, "asc" | "desc">,
	locale: string = "default",
	getValue: (item: T, columnID: string) => unknown = getNestedValue,
): T[] {
	// Защита от некорректных входных данных
	if (!arr || arr.length === 0) {
		return [];
	}

	if (!sort || Object.keys(sort).length === 0) {
		return [...arr];
	}

	// Ключи сортировки вычисляем ОДИН раз, а не на каждое сравнение в компараторе.
	const sortKeys = Object.entries(sort);

	return [...arr].sort((a, b) => {
		// Проходим по всем полям сортировки по порядку (multi-sort)
		for (const [columnID, direction] of sortKeys) {
			const aValue = getValue(a, columnID);
			const bValue = getValue(b, columnID);

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

/**
 * ОТМЕТКИ ЖИВУТ, ПОКА ЖИВЫ СТРОКИ. После удаления или замены данных в наборе остаются id, которых в таблице
 * больше нет: кнопки продолжают считать «выбрано 3», а групповое действие уходит по чужим строкам — тем, кому
 * теперь принадлежат те же id.
 *
 * Пустой набор строк — не повод снимать отметки: у таблиц, где галочка означает состояние данных (роли
 * пользователя, задачи расписания), строки приходят позже отметок, и чистка на пустом списке прочиталась бы
 * как «сняли всё».
 */
/**
 * ОТМЕТКА ПРИНАДЛЕЖИТ СТРОКЕ, А НЕ ЕЁ НОМЕРУ (17.09).
 *
 * ЖИВОЙ СЛУЧАЙ. В «Базах», «Сеансах» и «Соединениях» `id` строки — её ПОРЯДКОВЫЙ НОМЕР в ответе. Сняли сеанс —
 * список перечитан, номера сдвинулись, и галочка осталась на прежнем НОМЕРЕ, то есть переехала на соседнюю строку.
 * То же с активной строкой. Списки такие не только в панели 1С, поэтому правило здесь, в самой таблице.
 *
 * Правило: помним, какой строке принадлежал номер (`uuid` — постоянный ключ строки), и при новых данных переносим
 * отметку на НОВЫЙ номер той же строки. Строки не стало — отметка снимается (иначе групповое действие уйдёт по
 * чужой строке с тем же номером). При быстром поиске и отборе «не стало» не значит «удалена»: строка скрыта, и
 * отметка остаётся ждать снятия поиска.
 *
 * Строка без `uuid` (такие бывают у черновиков) работает по-старому — по номеру.
 */
export type RowIdentity = { id: number; uuid?: unknown };

const uuidOf = (r: RowIdentity): string => (typeof r.uuid === "string" ? r.uuid : "");

/** Кто сейчас стоит за номером строки: номер → постоянный ключ. Запоминается до прихода новых данных. */
export function rowIdentities(rows: readonly RowIdentity[]): Map<number, string> {
	const m = new Map<number, string>();
	for (const r of rows) {
		const u = uuidOf(r);
		if (u) m.set(Number(r.id), u);
	}
	return m;
}

/** Номера строк по их постоянным ключам — и все номера, которые сейчас есть. */
const currentRows = (rows: readonly RowIdentity[]) => {
	const byUuid = new Map<string, number>();
	const alive = new Set<number>();
	for (const r of rows) {
		const id = Number(r.id);
		alive.add(id);
		const u = uuidOf(r);
		if (u && !byUuid.has(u)) byUuid.set(u, id);
	}
	return { byUuid, alive };
};

/** Куда переехал номер строки: новый номер, `null` — строки больше нет, `undefined` — остаётся как был. */
function movedTo(
	id: number, was: ReadonlyMap<number, string>, rows: readonly RowIdentity[], narrowed: boolean,
): number | null | undefined {
	const { byUuid, alive } = currentRows(rows);
	const key = was.get(id);
	if (key) {
		const now = byUuid.get(key);
		if (now !== undefined) return now === id ? undefined : now;
		// Ключ известен, строки с ним нет: при поиске и отборе она скрыта, иначе — исчезла.
		return narrowed ? undefined : null;
	}
	// Ключа не знаем (строка без uuid или данные пришли впервые) — судим по номеру, как раньше.
	if (alive.has(id)) return undefined;
	return narrowed ? undefined : null;
}

/** Перенести набор отметок на новые номера строк. `null` — менять нечего. */
export function remapSelection(
	ids: ReadonlySet<number>,
	was: ReadonlyMap<number, string>,
	rows: readonly RowIdentity[],
	narrowed: boolean,
): Set<number> | null {
	// Пустой набор строк — не повод трогать отметки: у таблиц, где галочка означает состояние данных, строки
	// приходят позже отметок (см. pruneSelection).
	if (ids.size === 0 || rows.length === 0) return null;
	const next = new Set<number>();
	let changed = false;
	for (const id of ids) {
		const to = movedTo(id, was, rows, narrowed);
		if (to === undefined) { next.add(id); continue; }
		changed = true;
		if (to !== null) next.add(to);
	}
	return changed ? next : null;
}

/** Куда переехала активная строка: `undefined` — никуда. */
export function remapActiveRow(
	active: number | null,
	was: ReadonlyMap<number, string>,
	rows: readonly RowIdentity[],
	narrowed: boolean,
): number | null | undefined {
	if (active === null || rows.length === 0) return undefined;
	return movedTo(active, was, rows, narrowed);
}

export function pruneSelection(selected: ReadonlySet<number>, rowIds: readonly number[]): Set<number> | null {
	if (selected.size === 0 || rowIds.length === 0) return null;
	const alive = new Set(rowIds);
	let dropped = false;
	const next = new Set<number>();
	for (const id of selected) {
		if (alive.has(id)) next.add(id);
		else dropped = true;
	}
	return dropped ? next : null;
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
			const parsed = JSON.parse(storageColumns) as TColumn[];
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
		const parsed = JSON.parse(raw) as unknown;
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
	let rawValue: unknown;
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
		return asText(rawValue);
	} else if (column.type === "date") {
		return getFormatDateOnly(rawValue as string);
	} else if (column.type === "datetime") {
		return getFormatDate(rawValue as string);
	} else if (column.type === "string") {
		return asText(rawValue);
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


// ─── Шаблоны быстрого поиска: [Колонка: подстрока] ──────────────────────────
//
// Пример: «[номенклатура: ноутбук]» или «[контРагеНт: СтроЙ] [склад: основной]».
// Область поиска сопоставляется с ЗАГОЛОВКОМ колонки (а не с захардкоженным списком
// моделей) — поэтому шаблон работает в любом списке, где такая колонка есть, и не
// требует правок при добавлении новых моделей. Регистр и пробелы не важны.
//
// Свободные слова вне скобок ищутся как раньше — по всем видимым колонкам.
// Условия объединяются по И: все шаблоны + все свободные слова.

/** Один шаблон: искать `text` ТОЛЬКО в колонке, чей заголовок/идентификатор = `scope`. */
export interface SearchScope {
	scope: string;
	text: string;
	/**
	 * Шаблон записан БЕЗ скобок («контрагент: строй»). Такая форма может оказаться
	 * случайностью (время «12:30», префикс «ИНВ:1»), поэтому если колонки с таким
	 * именем нет — мягко откатываемся к обычному поиску по тексту, а не обнуляем
	 * выдачу. Скобочная форма — явное намерение, там режим строгий.
	 */
	bare?: boolean;
}

export interface ParsedSearch {
	scopes: SearchScope[];
	/** Свободные слова (нормализованные: lowercase, запятая → точка). */
	words: string[];
}

const normalize = (v: string) => v.toLowerCase().trim();

/**
 * Разбирает строку поиска на шаблоны и свободные слова.
 *
 * Поддерживаются ОБЕ формы (пользователи пишут и так, и так):
 *   [номенклатура: ноутбук]   — скобочная, строгая;
 *    контрагент: строй        — голая (скобки не обязательны).
 * Регистр и пробелы вокруг «:» не важны.
 */
export function parseSearchQuery(input: string): ParsedSearch {
	const scopes: SearchScope[] = [];

	// 1) Скобочная форма: [ имя : значение ]
	let rest = (input ?? "").replace(/\[\s*([^:\]]+?)\s*:\s*([^\]]*?)\s*\]/g, (_m, scope, text) => {
		const t = normalize(String(text));
		if (t) scopes.push({ scope: normalize(String(scope)), text: t });
		return " ";
	});

	// 2) Голая форма: имя: значение. Значение тянется до следующего «имя:» или конца
	//    строки — чтобы «номенклатура: ноутбук dell» искало «ноутбук dell» целиком.
	rest = rest.replace(
		/([^\s:]{2,})\s*:\s*([^:]*?)(?=\s+[^\s:]{2,}\s*:|$)/g,
		(_m, scope, text) => {
			const t = normalize(String(text));
			if (t) scopes.push({ scope: normalize(String(scope)), text: t, bare: true });
			return " ";
		},
	);

	const words = rest
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => w.replace(",", "."));
	return { scopes, words };
}

/** Колонки-«наименования» списка: name, product.name, counterpartyName и т.п. */
const isNameColumn = (col: TColumn): boolean => {
	const id = String(col.identifier ?? "");
	return id === "name" || id.endsWith(".name") || /name$/i.test(id);
};

/**
 * Колонки, подходящие под область поиска. Область — это ИМЯ МОДЕЛИ («номенклатура»,
 * «контрагент»), и в разных списках оно означает разное:
 *
 *   1) КОЛОНКА-ссылка на эту модель. В списке Реализаций есть колонка «Контрагент»
 *      → «контрагент: строй» фильтрует по ней.
 *   2) САМ СПИСОК. В списке Номенклатуры колонки «Номенклатура» нет (там «Наименование»),
 *      но список ИМЕННО о номенклатуре → «номенклатура: ноут» ищет в наименовании.
 *      Без этого шага шаблон в «родном» списке молча ничего не находил.
 *
 * Сопоставляем и с переведённым заголовком, и с идентификатором — чтобы работало
 * и для колонок без перевода.
 */
function columnsForScope(
	scope: string,
	visibleColumns: TColumn[],
	modelLabel?: string,
): TColumn[] {
	const byColumn = visibleColumns.filter((col) => {
		const id = normalize(String(col.identifier ?? ""));
		const label = normalize(String(getTranslateColumn(col) ?? ""));
		return (label && label.includes(scope)) || (id && id.includes(scope));
	});
	if (byColumn.length > 0) return byColumn;

	// Область = сам список («номенклатура» в списке Номенклатуры) → ищем в наименовании.
	const model = normalize(modelLabel ?? "");
	if (model && (model.includes(scope) || scope.includes(model))) {
		const nameCols = visibleColumns.filter(isNameColumn);
		return nameCols.length > 0 ? nameCols : visibleColumns;
	}
	return [];
}

/** Все строковые значения колонки строки — в нижнем регистре. */
function columnHaystack(row: TDataItem, col: TColumn): string {
	const parts: string[] = [];
	const collect = (v: unknown) => {
		if (v == null) return;
		if (typeof v === "object") {
			for (const x of Object.values(v as Record<string, unknown>)) collect(x);
		} else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
			parts.push(String(v).toLowerCase());
		}
	};
	const raw = getNestedValue(row, col.identifier);
	if (raw != null && typeof raw === "object") collect(raw);
	else {
		const formatted = getFormatColumnValue(row, col);
		if (formatted !== "" && formatted != null) parts.push(String(formatted).toLowerCase());
	}
	return parts.join(" ");
}

/**
 * Проверка строки по разобранному запросу: шаблоны ищутся в СВОЕЙ колонке,
 * свободные слова — по всем видимым (прежнее поведение).
 *
 * Область, которой нет в этом списке, НЕ совпадает ни с чем: молча искать по всем
 * колонкам было бы враньём — пользователь думал бы, что ограничил поиск.
 */
export function matchRowByQuery(
	row: TDataItem,
	visibleColumns: TColumn[],
	parsed: ParsedSearch,
	/** Переведённое имя МОДЕЛИ списка («Номенклатура») — см. columnsForScope. */
	modelLabel?: string,
): boolean {
	const extraWords: string[] = [];
	for (const { scope, text, bare } of parsed.scopes) {
		const cols = columnsForScope(scope, visibleColumns, modelLabel);
		if (cols.length === 0) {
			// Скобочная форма — явное намерение: колонки нет → не совпадает ничего.
			if (!bare) return false;
			// Голая форма могла оказаться случайным «:» (время, префикс номера) —
			// не обнуляем выдачу, а ищем текст как обычное слово.
			extraWords.push(text);
			continue;
		}
		const hit = cols.some((col) => columnHaystack(row, col).includes(text));
		if (!hit) return false;
	}
	return matchRowBySearch(row, visibleColumns, [...parsed.words, ...extraWords]);
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

// \u0418\u0442\u043E\u0433 \u043A\u043E\u043B\u043E\u043D\u043A\u0438 \u0434\u043B\u044F tfoot (sum/avg/min/max/count) \u043F\u043E \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u043C \u0441\u0442\u0440\u043E\u043A\u0430\u043C.
// \u0411\u0435\u0440\u0451\u0442 \u0441\u044B\u0440\u043E\u0435 \u0447\u0438\u0441\u043B\u043E\u0432\u043E\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435 r[col.identifier]. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432 Table \u0438 SubTableSheets.
export function computeFooterValue(col: TColumn, rows: TDataItem[]): string | null {
	if (!col.footer || col.footer === "none") return null;
	const vals = rows
		.map((r) => {
			const v = r[col.identifier];
			return typeof v === "number" ? v : parseFloat(String(v));
		})
		.filter((v) => !isNaN(v));

	if (vals.length === 0) return null;

	switch (col.footer) {
		case "sum": return vals.reduce((a, b) => a + b, 0).toLocaleString("ru-RU");
		case "avg": return (vals.reduce((a, b) => a + b, 0) / vals.length).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
		case "min": return Math.min(...vals).toLocaleString("ru-RU");
		case "max": return Math.max(...vals).toLocaleString("ru-RU");
		case "count": return vals.length.toLocaleString("ru-RU");
		default: return null;
	}
}

/**
 * Гарантирует, что последняя видимая колонка имеет width: 'auto' (растягивается на
 * оставшееся место), а не-последние 'auto' сбрасываются в minWidth. Вынесено из
 * Table/index.tsx (T4) — используется и главным Table, и TableHeader (ресайз).
 */
export function normalizeLastColumnWidth(cols: TColumn[]): TColumn[] {
	const visibleIds = cols.filter(c => c.visible).map(c => c.identifier);
	if (visibleIds.length === 0) return cols;
	const lastVisibleId = visibleIds[visibleIds.length - 1];
	return cols.map(c => {
		if (c.identifier === lastVisibleId) return { ...c, width: 'auto' };
		if (c.visible && c.width === 'auto') return { ...c, width: c.minWidth ?? '150px' };
		return c;
	});
}


/**
 * ОТМЕТКИ, БЫСТРЫЙ ПОИСК И ОТБОР (17.09).
 *
 * Отметка — состояние СТРОКИ, а поиск и отбор (в том числе по периоду) только СКРЫВАЮТ строки. Отсюда три правила:
 *   1. Скрытое поиском не трогаем: ни «выбрать все» в шапке, ни отметка строки не меняют отметок невидимых строк.
 *   2. Режим «выбраны все» включается только на несуженном списке: при поиске видима одна строка, и её отметка
 *      иначе выбирала весь список после снятия поиска.
 *   3. Индикатор шапки говорит о ВИДИМЫХ строках: отмечены все видимые — галочка, часть — промежуточное, ни одной —
 *      пусто. Отмеченное вне поиска на него не влияет — иначе шапка горела «частично» над списком без единой отметки.
 */
export type SelectionState = { selected: Set<number>; allMode: boolean; excluded: Set<number> };

/** Значение отбора пустое — отбора по этому полю нет (`undefined`, `''`, `{value: ''}`, период без дат). */
const isEmptyFilterValue = (v: unknown): boolean => {
	if (v == null || v === '') return true;
	if (Array.isArray(v)) return v.length === 0;
	if (typeof v === 'object') {
		const o = v as Record<string, unknown>;
		if ('value' in o) return isEmptyFilterValue(o.value);
		return Object.values(o).every(isEmptyFilterValue);
	}
	return false;
};

/** Список сужен: виден не весь набор, а результат поиска или отбора (в том числе по периоду). */
export const isNarrowedView = (
	search: string | null | undefined,
	filters: Record<string, unknown> | null | undefined,
): boolean => !!search?.trim() || Object.values(filters ?? {}).some((v) => !isEmptyFilterValue(v));

/** Отмечена ли строка — с учётом режима «выбраны все». */
export const isRowSelected = (state: SelectionState, id: number): boolean =>
	state.allMode ? !state.excluded.has(id) : state.selected.has(id);

/** Индикатор чекбокса в шапке — только по видимым строкам (правило 3). */
export function selectionIndicator(
	state: SelectionState, visibleIds: readonly number[],
): { all: boolean; some: boolean } {
	let count = 0;
	for (const id of visibleIds) if (isRowSelected(state, id)) count++;
	return { all: visibleIds.length > 0 && count === visibleIds.length, some: count > 0 && count < visibleIds.length };
}

const EMPTY: Set<number> = new Set();

/** Отметить или снять ОДНУ строку (галочка в строке, пробел на активной строке). */
export function toggleRowSelection(
	state: SelectionState, id: number, checked: boolean, visibleIds: readonly number[], narrowed: boolean,
): SelectionState {
	if (state.allMode) {
		const excluded = new Set(state.excluded);
		if (checked) excluded.delete(id); else excluded.add(id);
		// Исключили всё, что видно, и список не сужен — режим «все» больше не значит «все».
		if (!narrowed && visibleIds.every((rid) => excluded.has(rid))) return { selected: new Set(), allMode: false, excluded: new Set() };
		return { selected: new Set(), allMode: true, excluded };
	}
	const selected = new Set(state.selected);
	if (checked) selected.add(id); else selected.delete(id);
	if (!narrowed && visibleIds.length > 0 && visibleIds.every((rid) => selected.has(rid))) {
		return { selected: new Set(), allMode: true, excluded: new Set() };
	}
	return { selected, allMode: false, excluded: EMPTY };
}

/**
 * Строки списка между двумя строками, включительно, в порядке списка — диапазон протягивания мышью. Какой-то из
 * концов пропал из списка (перезагрузили, отфильтровали) — пусто: диапазон без конца не определён.
 */
export function rowIdsBetween(rows: readonly { id: number | string }[], fromId: number, toId: number): number[] {
	let from = -1;
	let to = -1;
	for (let i = 0; i < rows.length; i++) {
		const id = Number(rows[i].id);
		if (id === fromId) from = i;
		if (id === toId) to = i;
	}
	if (from < 0 || to < 0) return [];
	const out: number[] = [];
	for (let i = Math.min(from, to); i <= Math.max(from, to); i++) out.push(Number(rows[i].id));
	return out;
}

/**
 * Отметки после протягивания мышью по строкам: от строки, где нажали, до строки под курсором.
 *
 * Без Ctrl (⌘) диапазон ЗАМЕНЯЕТ выбор, с Ctrl — добавляется к тому, что было отмечено до начала протягивания.
 * Правила — те же, что у галочки (выше): скрытое поиском не трогаем (на суженном списке замена касается только
 * видимых строк), режим «выбраны все» — только на несуженном списке, где отмечено всё видимое.
 */
export function dragSelection(
	base: SelectionState, rangeIds: readonly number[], additive: boolean, visibleIds: readonly number[], narrowed: boolean,
): SelectionState {
	const range = new Set(rangeIds);
	let next: SelectionState;
	if (!additive && !narrowed) {
		// Весь список виден — диапазон и есть новый выбор целиком.
		next = { selected: new Set(range), allMode: false, excluded: new Set() };
	} else if (base.allMode) {
		const excluded = new Set(base.excluded);
		if (!additive) for (const id of visibleIds) if (!range.has(id)) excluded.add(id);
		for (const id of range) excluded.delete(id);
		next = { selected: new Set(), allMode: true, excluded };
	} else {
		const selected = new Set(base.selected);
		if (!additive) for (const id of visibleIds) if (!range.has(id)) selected.delete(id);
		for (const id of range) selected.add(id);
		next = { selected, allMode: false, excluded: new Set() };
	}
	if (!narrowed && visibleIds.length > 0) {
		if (!next.allMode && visibleIds.every((id) => next.selected.has(id))) return { selected: new Set(), allMode: true, excluded: new Set() };
		if (next.allMode && visibleIds.every((id) => next.excluded.has(id))) return { selected: new Set(), allMode: false, excluded: new Set() };
	}
	return next;
}

/**
 * «Выбрать все» в шапке. Щелчок при частичном или полном выборе снимает, при пустом — отмечает (как и раньше).
 *
 * Суженный список: «все» — это ВИДИМЫЕ строки, отметки скрытых остаются как были (правило 1), и решение «снять или
 * отметить» принимается по видимым (правило 3). Режим «выбраны все», если он уже включён, сохраняется: видимые
 * строки уходят в исключения или возвращаются из них.
 */
export function toggleAllSelection(
	state: SelectionState, visibleIds: readonly number[], narrowed: boolean,
): SelectionState {
	if (narrowed) {
		const { all, some } = selectionIndicator(state, visibleIds);
		const unselect = all || some;
		if (state.allMode) {
			const excluded = new Set(state.excluded);
			for (const id of visibleIds) { if (unselect) excluded.add(id); else excluded.delete(id); }
			return { selected: new Set(), allMode: true, excluded };
		}
		const selected = new Set(state.selected);
		for (const id of visibleIds) { if (unselect) selected.delete(id); else selected.add(id); }
		return { selected, allMode: false, excluded: new Set() };
	}
	return state.allMode || state.selected.size > 0
		? { selected: new Set(), allMode: false, excluded: new Set() }
		: { selected: new Set(), allMode: true, excluded: new Set() };
}
