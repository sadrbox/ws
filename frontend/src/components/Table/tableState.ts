/**
 * СОСТОЯНИЕ ТАБЛИЦЫ — ОДНА ЗАПИСЬ НА ТАБЛИЦУ (28.09).
 *
 * Всё, что пользователь настроил в таблице и что должно пережить закрытие вкладки, лежит в ОДНОЙ записи
 * localStorage по имени таблицы (`componentName`): `table_state_<componentName>`.
 *
 *   columns — порядок, ширина и видимость колонок (идентификатор и тип — для сверки с определением);
 *   sort    — сортировка, если отличается от умолчания владельца;
 *   search  — быстрый поиск;
 *   filter  — отборы, в том числе период (`dateRange`);
 *   searchScope — к чему относятся поиск и отборы: у табличной части документа — документ (useTableViewState);
 *   layout  — вид списка: `list` или `split` (список + предпросмотр).
 *
 * ПОЧЕМУ ОДНА. Раньше у каждого куска была своя механика: колонки — `table_columns_*` (писали три места напрямую),
 * сортировка и период — `table_view_*` (только списки справочников и документов), вид списка — `listPaneLayout:*`
 * (два места), а быстрый поиск и прочие отборы не хранились вовсе. Три формата, три набора правил очистки и таблицы,
 * у которых сохранялось разное. Здесь — одно чтение, одна запись и одно правило: пустое не хранится.
 *
 * ЧТО НЕ ХРАНИТСЯ: служебные колонки (`__*` — их вставляет таблица в рантайме), сортировка, равная умолчанию
 * (иначе смена умолчания в коде не дошла бы до тех, кто однажды щёлкал по заголовку), и всё пустое.
 *
 * СТАРЫЕ КЛЮЧИ переносятся при первом чтении таблицы и удаляются — настройки пользователей не теряются.
 *
 * Модуль без React: колонки читает getModelColumns (десятки владельцев), сортировку, поиск и отборы —
 * useTableViewState, вид списка — Table и ModelList.
 */
import type { TColumn } from "./types";

export type TableSort = Record<string, "asc" | "desc">;
export type TableFilter = Record<string, { value: unknown; operator: string }>;
export type TableLayout = "list" | "split";
/** Колонка в хранилище: только то, что настраивает пользователь, плюс идентификатор и тип для сверки. */
export type StoredColumn = { identifier: string; type: string; width?: string; visible?: boolean };

export type TableState = {
	columns?: StoredColumn[];
	sort?: TableSort;
	search?: string;
	filter?: TableFilter;
	/** Поиск и отборы сохранены для этого владельца (документа) и только ему возвращаются. */
	searchScope?: string;
	layout?: TableLayout;
};

const PREFIX = "table_state_";
const LEGACY_COLUMNS = "table_columns_";
const LEGACY_VIEW = "table_view_";
const LEGACY_LAYOUT = "listPaneLayout:";
/** Строка поиска длиннее — не поиск, а случайно вставленный текст: хранить его незачем. */
const MAX_SEARCH = 500;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** localStorage бывает недоступен (приватный режим, запрет сайта) — тогда таблица просто ничего не помнит. */
function store(): Storage | null {
	try {
		return typeof window !== "undefined" ? window.localStorage : null;
	} catch {
		return null;
	}
}

function parse(raw: string | null): unknown {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

// ── Проверка прочитанного: в хранилище может лежать что угодно (другая версия панели, ручная правка) ─────────

function sortOf(v: unknown): TableSort | undefined {
	if (!isObj(v)) return undefined;
	const out: TableSort = {};
	for (const [k, d] of Object.entries(v)) if (d === "asc" || d === "desc") out[k] = d;
	return Object.keys(out).length ? out : undefined;
}

function filterOf(v: unknown): TableFilter | undefined {
	if (!isObj(v)) return undefined;
	const out: TableFilter = {};
	for (const [k, f] of Object.entries(v)) if (isObj(f)) out[k] = f as TableFilter[string];
	return Object.keys(out).length ? out : undefined;
}

function columnsOf(v: unknown): StoredColumn[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: StoredColumn[] = [];
	for (const c of v) {
		if (!isObj(c) || typeof c.identifier !== "string" || typeof c.type !== "string") return undefined;
		if (c.identifier.startsWith("__")) continue;
		out.push({
			identifier: c.identifier, type: c.type,
			...(typeof c.width === "string" ? { width: c.width } : {}),
			...(typeof c.visible === "boolean" ? { visible: c.visible } : {}),
		});
	}
	return out.length ? out : undefined;
}

const searchOf = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() && v.length <= MAX_SEARCH ? v : undefined;

const layoutOf = (v: unknown): TableLayout | undefined => (v === "split" ? "split" : undefined);

function clean(v: unknown): TableState {
	if (!isObj(v)) return {};
	const out: TableState = {};
	const columns = columnsOf(v.columns);
	const sort = sortOf(v.sort);
	const search = searchOf(v.search);
	const filter = filterOf(v.filter);
	const layout = layoutOf(v.layout);
	const searchScope = typeof v.searchScope === "string" && v.searchScope && (search || filter) ? v.searchScope : undefined;
	if (columns) out.columns = columns;
	if (sort) out.sort = sort;
	if (search) out.search = search;
	if (filter) out.filter = filter;
	if (searchScope) out.searchScope = searchScope;
	if (layout) out.layout = layout;
	return out;
}

/** Прежние ключи этой таблицы → одна запись; прежние удаляются. Нечего переносить — null. */
function migrateLegacy(s: Storage, name: string): TableState | null {
	const columnsRaw = s.getItem(LEGACY_COLUMNS + name);
	const viewRaw = s.getItem(LEGACY_VIEW + name);
	const layoutRaw = s.getItem(LEGACY_LAYOUT + name);
	if (columnsRaw === null && viewRaw === null && layoutRaw === null) return null;
	const view = parse(viewRaw);
	const dateRange = isObj(view) && isObj(view.dateRange) ? view.dateRange : undefined;
	const state = clean({
		columns: parse(columnsRaw),
		sort: isObj(view) ? view.sort : undefined,
		// Период в прежнем виде лежал отдельно — теперь это такой же отбор, как остальные.
		filter: dateRange ? { dateRange } : undefined,
		layout: layoutRaw,
	});
	try {
		if (Object.keys(state).length) s.setItem(PREFIX + name, JSON.stringify(state));
		s.removeItem(LEGACY_COLUMNS + name);
		s.removeItem(LEGACY_VIEW + name);
		s.removeItem(LEGACY_LAYOUT + name);
	} catch {
		/* квота — прочитанное всё равно вернём */
	}
	return state;
}

/** Состояние таблицы; ничего не сохранено (или имени нет) — пустой объект. */
export function readTableState(name: string | null | undefined): TableState {
	const s = store();
	if (!name || !s) return {};
	try {
		const raw = s.getItem(PREFIX + name);
		if (raw !== null) return clean(parse(raw));
		return migrateLegacy(s, name) ?? {};
	} catch {
		return {};
	}
}

const empty = (v: unknown): boolean =>
	v === undefined || v === null || v === "" || (Array.isArray(v) ? v.length === 0 : isObj(v) && Object.keys(v).length === 0);

/**
 * Записать часть состояния. Ключ, переданный в `patch`, заменяется; пустое значение (`undefined`, `""`, `{}`, `[]`)
 * убирает его; остальные ключи не трогаются. Пустое состояние целиком — запись удаляется, мусор не копится.
 */
export function writeTableState(name: string | null | undefined, patch: Partial<TableState>): void {
	const s = store();
	if (!name || !s) return;
	try {
		const next: Record<string, unknown> = { ...readTableState(name) };
		for (const [k, v] of Object.entries(patch)) {
			if (empty(v)) delete next[k];
			else next[k] = v;
		}
		const state = clean(next);
		if (Object.keys(state).length) s.setItem(PREFIX + name, JSON.stringify(state));
		else s.removeItem(PREFIX + name);
	} catch {
		/* квота или запрет хранилища — не критично: таблица просто не запомнит */
	}
}

/** Сохранить колонки, как их настроил пользователь: служебные (`__*`) — нет, из каждой — только настраиваемое. */
export function saveTableColumns(name: string | null | undefined, columns: readonly TColumn[]): void {
	writeTableState(name, {
		columns: columns
			.filter((c) => !c.identifier.startsWith("__"))
			.map((c) => ({
				identifier: c.identifier, type: c.type,
				...(c.width !== undefined ? { width: c.width } : {}),
				...(c.visible !== undefined ? { visible: c.visible } : {}),
			})),
	});
}

/** Равны ли две сортировки (порядок ключей важен: первый — главный). */
export const sameSort = (a: TableSort | undefined, b: TableSort | undefined): boolean =>
	JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
