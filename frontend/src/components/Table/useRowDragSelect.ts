/**
 * Выделение строк протягиванием мышью: нажали левую кнопку на строке и ведут вверх или вниз — отмечаются все
 * строки от той, где нажали, до строки под курсором. С Ctrl (⌘) диапазон добавляется к уже отмеченному;
 * Escape во время протягивания возвращает отметки, какими они были до нажатия.
 *
 * Это те же отметки, что у галочек в строках (selectedRows), и по тем же правилам (services.dragSelection):
 * групповые операции — удаление, команды над выбранным — видят их как обычно.
 *
 * СЛУШАЕТ КОНТЕЙНЕР, А НЕ СТРОКИ. Строки мемоизированы и виртуализированы: при протягивании за край окна под
 * курсор приходят новые строки, а обработчик на каждой строке заставил бы их перерисовываться. Нажатие ловит
 * контейнер прокрутки, движение — документ (курсор может уйти за пределы таблицы), строка под курсором
 * находится по data-row-id.
 *
 * ПРОСТОЙ ЩЕЛЧОК ОСТАЁТСЯ ЩЕЛЧКОМ. Протягивание начинается, только когда курсор перешёл на другую строку, —
 * до этого активная строка, ячейка и двойной щелчок работают как раньше.
 *
 * НЕ НАЧИНАЕТСЯ с элементов управления (галочка, кнопки, ссылки) и с поля, в котором уже идёт ввод: там мышь
 * выделяет текст. С неактивного поля табличной части (SubTable) — начинается: одиночный щелчок по нему лишь
 * выбирает ячейку.
 *
 * У КРАЯ СПИСКА он прокручивается сам — тем быстрее, чем глубже курсор за краем, — и выделение идёт следом.
 */
import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { isTextControl } from "src/components/SubTable/fieldDom";
import { dragSelection, rowIdsBetween, type SelectionState } from "./services";
import type { TDataItem } from "./types";

/** Строка данных (вложенные строки раскрытия не выделяются протягиванием: их отметка — у владельца). */
const ROW_SELECTOR = "tbody tr[data-row-id]:not([data-child])";
/** С этих элементов протягивание не начинается: у них своё поведение мыши. */
const INTERACTIVE = 'button, a[href], input[type="checkbox"], input[type="radio"], label, [role="button"], [data-no-row-drag]';
/** Полоса у верхнего и нижнего края списка, в которой он прокручивается сам, px. */
const EDGE = 28;
/** Предельная скорость самопрокрутки, px за кадр. */
const MAX_SPEED = 28;

export interface RowDragSelectOptions {
	scrollRef: RefObject<HTMLDivElement | null>;
	/** Можно ли сейчас выделять протягиванием; читается при каждом нажатии. */
	enabledRef: MutableRefObject<boolean>;
	/** Строки в порядке списка (как нарисованы). */
	rowsRef: MutableRefObject<readonly TDataItem[]>;
	selectionRef: MutableRefObject<SelectionState>;
	visibleIdsRef: MutableRefObject<number[]>;
	narrowedRef: MutableRefObject<boolean>;
	apply: (next: SelectionState) => void;
	/** Строка под курсором в конце протягивания становится активной — как после щелчка по ней. */
	setActiveRow: (id: number) => void;
}

interface DragState {
	anchor: number;
	current: number;
	additive: boolean;
	base: SelectionState;
	lastX: number;
	lastY: number;
	active: boolean;
}

function rowIdOf(container: HTMLElement, el: Element | null): number | null {
	const tr = el instanceof Element ? el.closest<HTMLTableRowElement>(ROW_SELECTOR) : null;
	if (!tr || !container.contains(tr)) return null;
	const id = Number(tr.dataset.rowId);
	return Number.isFinite(id) ? id : null;
}

/** Видимая полоса строк: между закреплённой шапкой и итогами, в пределах контейнера. */
function rowsBand(container: HTMLElement): { top: number; bottom: number; left: number; right: number } {
	const r = container.getBoundingClientRect();
	const head = container.querySelector("thead")?.getBoundingClientRect();
	const foot = container.querySelector("tfoot")?.getBoundingClientRect();
	const top = head && head.height > 0 ? Math.max(r.top, head.bottom) : r.top;
	const bottom = foot && foot.height > 0 ? Math.min(r.bottom, foot.top) : r.bottom;
	return { top, bottom, left: r.left, right: r.right };
}

/**
 * Строка под курсором. Курсор над строкой этой таблицы — она. Над шапкой, итогами или за пределами таблицы —
 * строка у ближайшего края видимой полосы: протягивание за край выделяет до крайней видимой строки.
 */
function rowUnderPointer(container: HTMLElement, x: number, y: number): number | null {
	const direct = rowIdOf(container, document.elementFromPoint(x, y));
	if (direct !== null) return direct;
	const band = rowsBand(container);
	if (band.bottom - band.top < 4) return null;
	const px = Math.min(Math.max(x, band.left + 2), band.right - 2);
	const py = Math.min(Math.max(y, band.top + 2), band.bottom - 2);
	const probed = rowIdOf(container, document.elementFromPoint(px, py));
	if (probed !== null) return probed;
	// Под курсором заглушка виртуализации или пустое место под строками — ближайшая видимая строка.
	let best: number | null = null;
	let bestDist = Infinity;
	for (const tr of container.querySelectorAll<HTMLTableRowElement>(ROW_SELECTOR)) {
		const r = tr.getBoundingClientRect();
		if (r.height === 0 || r.bottom <= band.top || r.top >= band.bottom) continue;
		const dist = py < r.top ? r.top - py : py > r.bottom ? py - r.bottom : 0;
		if (dist < bestDist) {
			bestDist = dist;
			best = Number(tr.dataset.rowId);
		}
	}
	return best !== null && Number.isFinite(best) ? best : null;
}

/** Скорость самопрокрутки: 0 — курсор внутри полосы строк, иначе растёт с глубиной за краем. */
function edgeSpeed(container: HTMLElement, y: number): number {
	const band = rowsBand(container);
	// Слишком низкий список прокручивать нечем (и в тестовой среде без раскладки размеры нулевые).
	if (band.bottom - band.top < EDGE * 3) return 0;
	const speed = (depth: number) => Math.min(MAX_SPEED, Math.max(2, Math.round(depth / 2)));
	if (y < band.top + EDGE) return -speed(band.top + EDGE - y);
	if (y > band.bottom - EDGE) return speed(y - (band.bottom - EDGE));
	return 0;
}

export function useRowDragSelect(options: RowDragSelectOptions): void {
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const { scrollRef } = options;

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return undefined;
		const container: HTMLDivElement = scroller;
		let drag: DragState | null = null;
		let raf = 0;
		let prevUserSelect = "";

		const select = (id: number) => {
			const s = drag;
			if (!s || id === s.current) return;
			const o = optionsRef.current;
			const range = rowIdsBetween(o.rowsRef.current, s.anchor, id);
			if (!range.length) return;
			s.current = id;
			o.apply(dragSelection(s.base, range, s.additive, o.visibleIdsRef.current, o.narrowedRef.current));
		};

		const tick = () => {
			raf = 0;
			const s = drag;
			if (!s?.active) return;
			const speed = edgeSpeed(container, s.lastY);
			if (!speed) return;
			const before = container.scrollTop;
			container.scrollTop = before + speed;
			// Строки под новую прокрутку дорисуются к следующему кадру; до тех пор хватает уже нарисованных.
			const id = rowUnderPointer(container, s.lastX, s.lastY);
			if (id !== null) select(id);
			if (container.scrollTop !== before) raf = requestAnimationFrame(tick);
		};

		const finish = (commit: boolean) => {
			document.removeEventListener("mousemove", onMove, true);
			document.removeEventListener("mouseup", onUp, true);
			document.removeEventListener("keydown", onKey, true);
			window.removeEventListener("blur", onBlur);
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			const s = drag;
			drag = null;
			if (!s?.active) return;
			document.body.style.userSelect = prevUserSelect;
			delete container.dataset.dragSelecting;
			if (commit) optionsRef.current.setActiveRow(s.current);
		};

		function onMove(e: MouseEvent) {
			const s = drag;
			if (!s) return;
			// Кнопку отпустили за пределами окна — mouseup сюда не пришёл.
			if ((e.buttons & 1) === 0) { finish(true); return; }
			s.lastX = e.clientX;
			s.lastY = e.clientY;
			const id = rowUnderPointer(container, e.clientX, e.clientY);
			if (!s.active) {
				if (id === null || id === s.anchor) return;
				s.active = true;
				prevUserSelect = document.body.style.userSelect;
				document.body.style.userSelect = "none";
				window.getSelection()?.removeAllRanges();
				container.dataset.dragSelecting = "true";
			}
			e.preventDefault(); // по пути не выделять текст
			if (id !== null) select(id);
			if (!raf && edgeSpeed(container, e.clientY)) raf = requestAnimationFrame(tick);
		}

		function onUp(e: MouseEvent) {
			if (e.button !== 0) return;
			finish(true);
		}

		function onKey(e: KeyboardEvent) {
			if (e.key !== "Escape" || !drag) return;
			// Отмена: отметки — как до нажатия. Escape не уходит дальше (не закрывает панель).
			e.preventDefault();
			e.stopPropagation();
			if (drag.active) optionsRef.current.apply(drag.base);
			finish(false);
		}

		function onBlur() {
			finish(false);
		}

		function onDown(e: MouseEvent) {
			if (e.button !== 0 || e.shiftKey || e.altKey || !optionsRef.current.enabledRef.current) return;
			const target = e.target;
			if (!(target instanceof Element) || target.closest(INTERACTIVE)) return;
			// Поле, в котором уже идёт ввод: мышь выделяет в нём текст.
			const focused = document.activeElement;
			if (focused instanceof HTMLElement && focused !== container && focused.contains(target)
				&& (isTextControl(focused) || focused instanceof HTMLSelectElement || focused.isContentEditable)) return;
			const anchor = rowIdOf(container, target);
			if (anchor === null) return;
			if (drag) finish(false);
			drag = {
				anchor, current: anchor, additive: e.ctrlKey || e.metaKey, base: optionsRef.current.selectionRef.current,
				lastX: e.clientX, lastY: e.clientY, active: false,
			};
			document.addEventListener("mousemove", onMove, true);
			document.addEventListener("mouseup", onUp, true);
			document.addEventListener("keydown", onKey, true);
			window.addEventListener("blur", onBlur);
		}

		container.addEventListener("mousedown", onDown);
		return () => {
			container.removeEventListener("mousedown", onDown);
			finish(false);
		};
	}, [scrollRef]);
}
