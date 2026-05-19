/**
 * Утилита для клавиатурной навигации по строкам таблицы.
 *
 * Используется в Table (*List) и SubTable для единообразной обработки
 * клавиш Home / End / PgUp / PgDn / ArrowUp / ArrowDown.
 *
 * Не зависит от React — чистая функция, принимает текущий список строк
 * и идентификатор активной строки (или -1, если активной нет), возвращает
 * id новой активной строки (или null, если строк нет).
 */

export type TKeyboardNavDirection =
	| "first"
	| "last"
	| "up"
	| "down"
	| "pageUp"
	| "pageDown";

/**
 * Размер «страницы» для PgUp/PgDn по умолчанию.
 * Можно переопределить через параметр `pageSize`.
 */
export const TABLE_NAV_PAGE_SIZE = 10;

interface TNavRow {
	id: number;
}

/**
 * Сопоставляет нажатую клавишу с направлением навигации.
 * Возвращает null, если клавиша не относится к табличной навигации.
 */
export function getTableNavDirection(
	key: string,
): TKeyboardNavDirection | null {
	switch (key) {
		case "Home":
			return "first";
		case "End":
			return "last";
		case "ArrowUp":
			return "up";
		case "ArrowDown":
			return "down";
		case "PageUp":
			return "pageUp";
		case "PageDown":
			return "pageDown";
		default:
			return null;
	}
}

/**
 * Вычисляет id новой активной строки на основе текущей позиции
 * и направления навигации.
 *
 * @param rows         Видимые строки таблицы (в порядке отображения).
 * @param activeRowId  Текущий id активной строки или null.
 * @param direction    Направление навигации.
 * @param pageSize     Шаг для PgUp/PgDn (по умолчанию 10).
 * @returns            id новой активной строки или null.
 */
export function computeNextActiveRowId<R extends TNavRow>(
	rows: readonly R[],
	activeRowId: number | null,
	direction: TKeyboardNavDirection,
	pageSize: number = TABLE_NAV_PAGE_SIZE,
): number | null {
	if (rows.length === 0) return null;
	const idx =
		activeRowId !== null ? rows.findIndex((r) => r.id === activeRowId) : -1;
	// Если активной строки нет (idx < 0) — первое нажатие ЛЮБОЙ клавиши
	// навигации должно установить активной первую строку, а не «вторую»
	// (как было раньше: при idx = -1, safeIdx = 0, ArrowDown / PageDown
	// возвращали rows[1], пропуская rows[0]). Это унифицирует поведение
	// между *List и SubTable при открытии форм.
	if (idx < 0) {
		switch (direction) {
			case "last":
			case "up":
			case "pageUp":
				return rows[rows.length - 1].id;
			case "first":
			case "down":
			case "pageDown":
			default:
				return rows[0].id;
		}
	}
	const safeIdx = idx;
	switch (direction) {
		case "first":
			return rows[0].id;
		case "last":
			return rows[rows.length - 1].id;
		case "up":
			return rows[Math.max(0, safeIdx - 1)].id;
		case "down":
			return rows[Math.min(rows.length - 1, safeIdx + 1)].id;
		case "pageUp":
			return rows[Math.max(0, safeIdx - pageSize)].id;
		case "pageDown":
			return rows[Math.min(rows.length - 1, safeIdx + pageSize)].id;
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Колоночная (cell-level) навигация
// ────────────────────────────────────────────────────────────────────────────

/** Виртуальный идентификатор колонки чекбокса (выбор строки). */
export const CHECKBOX_COL_ID = "__checkbox";

export type TCellNavDirection = "left" | "right";

/**
 * Сопоставляет клавишу с направлением навигации по колонкам активной строки.
 * Используется для механики activeCell (выделение ячейки) — ArrowLeft/ArrowRight
 * двигают по соседним колонкам.
 *
 * Home/End ЦЕЛЕНАПРАВЛЕННО исключены: эти клавиши работают только по вертикали
 * таблицы (первая/последняя строка) — см. getTableNavDirection. Это
 * унифицирует поведение между *List и SubTable.
 *
 * Возвращает null, если клавиша не относится к колоночной навигации.
 */
export function getCellNavDirection(key: string): TCellNavDirection | null {
	switch (key) {
		case "ArrowLeft":
			return "left";
		case "ArrowRight":
			return "right";
		default:
			return null;
	}
}

interface TNavCol {
	identifier: string;
	visible?: boolean;
}

/**
 * Вычисляет идентификатор следующей активной колонки на основе текущей и
 * направления. Учитывает только видимые колонки.
 *
 * @param columns         Полный список колонок (могут быть скрытые — будут отфильтрованы).
 * @param activeColId     Текущий идентификатор активной колонки или null.
 * @param direction       Направление навигации.
 * @returns               Идентификатор новой активной колонки или null, если видимых нет.
 */
export function computeNextActiveColId<C extends TNavCol>(
	columns: readonly C[],
	activeColId: string | null,
	direction: TCellNavDirection,
): string | null {
	const visible = columns.filter((c) => c.visible !== false);
	if (visible.length === 0) return null;
	const idx =
		activeColId !== null
			? visible.findIndex((c) => c.identifier === activeColId)
			: -1;
	switch (direction) {
		case "left":
			// Если активной колонки нет — выбираем последнюю, чтобы стрелка влево
			// «зашла в строку» с правого края.
			if (idx < 0) return visible[visible.length - 1].identifier;
			return visible[Math.max(0, idx - 1)].identifier;
		case "right":
			// Если активной колонки нет — выбираем первую.
			if (idx < 0) return visible[0].identifier;
			return visible[Math.min(visible.length - 1, idx + 1)].identifier;
	}
}
