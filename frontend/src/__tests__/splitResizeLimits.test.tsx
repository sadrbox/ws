/**
 * Разделитель областей: предел виден, движение не тормозит, за экран ничего не уезжает.
 *
 * ЧТО БЫЛО НЕ ТАК. Размер считался накоплением дельты и ограничивался процентами, а реальный
 * предел задавала вёрстка соседа (`min-width: min-content` у пейнов). Получалось три беды
 * разом: указатель уезжал дальше предела, а граница стояла; на обратном ходе она не двигалась,
 * пока «накопленный» процент не вернётся к достижимому; и каждое движение перерисовывало всю
 * область вместе с открытым в ней списком — отсюда рывки.
 *
 * Теперь размер считается АБСОЛЮТНО по положению указателя и ограничивается ПИКСЕЛЯМИ, а во
 * время движения пишется прямо в CSS-переменную, минуя React. Тест держит ровно это.
 */
import { FC } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useSplitResize } from "src/components/SplitPane";

const WIDTH = 1000;
const MIN_PX = 240;
/** Область на момент нажатия — 30 % от тысячи. От неё и считается движение. */
const START = 300;

/**
 * Куда встанет граница, если указатель уехал на `moved` пикселей и предел не мешает.
 *
 * Область у правого края растёт, когда указатель идёт влево: размер меняется РОВНО на
 * пройденное расстояние — в этом и смысл, полоса остаётся под курсором.
 */
const afterMove = (moved: number) => ((START - moved) / WIDTH) * 100;

/** Ширина контейнера в jsdom нулевая — подставляем свою: хук считает по реальной геометрии. */
const rect = (left: number, width: number): DOMRect => ({
	x: left, y: 0, left, right: left + width, top: 0, bottom: 600, width, height: 600,
	toJSON: () => ({}),
}) as DOMRect;

const Harness: FC = () => {
	const split = useSplitResize({
		storageKey: "test_split", side: "right", defaultPercent: 30,
		min: 5, max: 95, minPx: MIN_PX, cssVar: "--w",
	});
	return (
		<div ref={split.containerRef} data-testid="box">
			<div data-testid="near" />
			<div data-testid="bar" onPointerDown={split.startResize} />
			{/* Управляемая область — последняя в контейнере (side: "right"): её и меряет хук. */}
			<div data-testid="panel">{Math.round(split.percent)}</div>
		</div>
	);
};

/** Размер области в процентах, как его сейчас видит браузер (переменная контейнера). */
const shown = (): number => {
	const box = screen.getByTestId("box");
	const live = box.style.getPropertyValue("--w");
	return live ? Number.parseFloat(live) : Number(screen.getByTestId("panel").textContent);
};

/** Движение указателя и кадр отрисовки: хук копит события до кадра, показывая один раз. */
const dragTo = async (clientX: number) => {
	await act(async () => {
		fireEvent.pointerMove(window, { clientX, clientY: 0 });
		await new Promise((r) => requestAnimationFrame(() => r(null)));
	});
};

describe("Разделитель: пределы и плавность", () => {
	beforeEach(() => {
		localStorage.clear();
		render(<Harness />);
		const box = screen.getByTestId("box");
		box.getBoundingClientRect = () => rect(0, WIDTH);
		// Размер на момент нажатия — из доли (30 % от 1000 = 300 px). Зазоры и ширина полосы в
		// расчёт не входят вовсе: область меняется ровно на пройденное указателем расстояние —
		// отсюда и совпадение курсора с разделителем.
		fireEvent.pointerDown(screen.getByTestId("bar"), { clientX: 700, clientY: 0 });
	});

	it("указатель за пределом — граница встаёт на предел, а не уезжает с ним", async () => {
		// Тянем почти к левому краю: области справа досталось бы 900 пикселей, соседу — 100.
		await dragTo(100);  // сдвиг −600 → 900 px
		// Осталось ровно столько, чтобы сосед сохранил свои 240.
		expect(shown()).toBeCloseTo(((WIDTH - MIN_PX) / WIDTH) * 100, 1);
	});

	it("обратный ход подхватывается сразу, без «мёртвой зоны»", async () => {
		await dragTo(100);      // упёрлись в предел
		await dragTo(600);      // вернулись в допустимое
		// Размер считается от исходного, а не накоплением, поэтому граница оказывается ровно
		// там, куда ушёл курсор, с первого же движения назад.
		expect(shown()).toBeCloseTo(afterMove(600 - 700), 1);
	});

	it("вторая область тоже не уже предела", async () => {
		await dragTo(990);  // сдвиг +290 → области осталось бы 10 px
		expect(shown()).toBeCloseTo((MIN_PX / WIDTH) * 100, 1);
	});

	it("во время движения состояние React не трогается — перерисовки нет", async () => {
		const before = screen.getByTestId("panel").textContent;
		await dragTo(500);

		// Показанное уже изменилось (CSS-переменная), а состояние — ещё нет: в этом и смысл.
		expect(shown()).toBeCloseTo(afterMove(500 - 700), 1);
		expect(screen.getByTestId("panel").textContent).toBe(before);

		// По отпусканию состояние догоняет — и уходит в localStorage.
		act(() => { fireEvent.pointerUp(window); });
		expect(Number(screen.getByTestId("panel").textContent)).toBe(Math.round(afterMove(500 - 700)));
		expect(localStorage.getItem("test_split")).toBe(String(Math.round(afterMove(500 - 700))));
	});

	it("полоса идёт за курсором один к одному — и возвращается в исходное", async () => {
		// Ровно та жалоба, из-за которой это переписано: курсор ушёл на сто пикселей —
		// разделитель обязан уйти на сто, а не на сто минус зазор и ширина полосы.
		await dragTo(700 - 100);
		expect(shown()).toBeCloseTo(afterMove(-100), 1);

		await dragTo(700 - 250);
		expect(shown()).toBeCloseTo(afterMove(-250), 1);

		// Вернули курсор на место — вернулся и размер: смещения не накапливаются.
		await dragTo(700);
		expect(shown()).toBeCloseTo((START / WIDTH) * 100, 1);
	});

	it("отмена жеста системой заканчивает перетаскивание, а не оставляет его висеть", async () => {
		await dragTo(500);
		act(() => { fireEvent.pointerCancel(window); });
		expect(document.body.style.cursor).toBe("");

		// После отмены движение указателя границу больше не двигает.
		const after = shown();
		await dragTo(300);
		expect(shown()).toBeCloseTo(after, 1);
	});
});
