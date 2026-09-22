/**
 * Область-спутник: ОДНО место на экране — несколько видов.
 *
 * ЗАЧЕМ. Справа от пейнов (или полосой внизу) помещается ровно одна колонка, а «спутников»
 * основного экрана несколько: журнал сообщений, переписка, помощник, задачи, заметки. Раньше
 * место занимал только журнал, а остальное открывалось отдельными панелями — и делило и без
 * того небольшой экран.
 *
 * Тест держит то, из-за чего переключатель был бы бесполезен:
 *   • выбор ПЕРЕЖИВАЕТ ПЕРЕЗАГРУЗКУ (localStorage): человек возвращается туда, где работал;
 *   • свёрнутая полоса подписывается ТЕКУЩИМ видом — свернув «Задачи», их и ищут глазами;
 *   • по умолчанию открыт журнал: сообщения появляются сами, и прятать их за чужой вкладкой
 *     нельзя;
 *   • чужие виды подгружаются лениво, поэтому переключение не должно ронять область — на
 *     время загрузки видно «Загрузка», а не пустота.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import TechMessages from "src/components/TechMessages/TechMessages";
import {
	setTechDockView, setTechMessagesOpen, setTechMessagesPlacement,
	TECH_DOCK_TITLES, TECH_DOCK_VIEWS,
} from "src/components/TechMessages/store";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";

const show = () => render(<TestWrapper><TechMessages /></TestWrapper>);

/** Пустая геометрия: в jsdom элементы не раскладываются, нужные поля подставляем сами. */
const EMPTY_RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };

/** Кадр отрисовки: меню сверяет положение кнопки раз в кадр, пока открыто. */
const frame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

/** Название любого вида — по нему узнаём заголовок среди кнопок шапки. */
const anyViewTitle = new RegExp(TECH_DOCK_VIEWS.map((v) => translate(TECH_DOCK_TITLES[v])).join("|"));
const viewButton = () => screen.getByRole("button", { name: anyViewTitle });

/** Открыть меню и выбрать вид — так это делает человек. */
const pick = (v: (typeof TECH_DOCK_VIEWS)[number]) => {
	fireEvent.click(viewButton());
	fireEvent.click(screen.getByRole("option", { name: new RegExp(translate(TECH_DOCK_TITLES[v])) }));
};

describe("Область-спутник: переключатель видов", () => {
	beforeEach(() => {
		act(() => { setTechMessagesOpen(true); setTechMessagesPlacement("right"); setTechDockView("messages"); });
	});

	it("заголовок называет открытый вид, а его меню перечисляет все", () => {
		show();
		// Заголовок — это и есть текущий вид: по умолчанию журнал сообщений.
		expect(viewButton().textContent).toContain(translate("techMessages"));

		fireEvent.click(viewButton());
		const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
		// Подписи — из словаря: в меню не должно быть кода вида.
		for (const v of TECH_DOCK_VIEWS) {
			expect(names.some((n) => n.includes(translate(TECH_DOCK_TITLES[v])))).toBe(true);
		}
		expect(screen.getByRole("option", { selected: true }).textContent).toContain(translate("techMessages"));
	});

	it("выбор вида запоминается и переживает перезагрузку", () => {
		const { unmount } = show();
		pick("notes");

		expect(viewButton().textContent).toContain(translate("notes"));
		expect(localStorage.getItem("tech_dock_view")).toBe("notes");
		// Меню закрывается выбором: оставленное открытым, оно перекрывало бы то, что выбрали.
		expect(screen.queryAllByRole("option")).toHaveLength(0);

		// Перемонтирование = новая загрузка страницы: вид обязан остаться тем же.
		unmount();
		show();
		expect(viewButton().textContent).toContain(translate("notes"));
	});

	it("меню закрывается по Escape, не меняя выбора: передумать — обычное дело", () => {
		show();
		fireEvent.click(viewButton());
		expect(screen.getAllByRole("option").length).toBe(TECH_DOCK_VIEWS.length);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryAllByRole("option")).toHaveLength(0);
		expect(viewButton().textContent).toContain(translate("techMessages"));
	});

	it("меню идёт за кнопкой: область меняет ширину — меню переезжает с ней", async () => {
		show();
		const btn = viewButton();
		// jsdom не раскладывает элементы — подставляем геометрию сами: до и после «ресайза».
		btn.getBoundingClientRect = () => ({ ...EMPTY_RECT, left: 700, right: 820, bottom: 40, width: 120 }) as DOMRect;
		fireEvent.click(btn);

		await frame();
		expect(screen.getByRole("listbox").style.left).toBe("700px");

		// Потянули разделитель: кнопка уехала. Ни scroll, ни resize при этом не происходит —
		// меню обязано найти её само, иначе останется висеть в стороне.
		btn.getBoundingClientRect = () => ({ ...EMPTY_RECT, left: 500, right: 620, bottom: 40, width: 120 }) as DOMRect;
		await frame();
		expect(screen.getByRole("listbox").style.left).toBe("500px");
	});

	it("окно потеряло фокус — меню закрывается, а не висит поверх забытым", () => {
		show();
		fireEvent.click(viewButton());
		expect(screen.getAllByRole("option").length).toBe(TECH_DOCK_VIEWS.length);

		fireEvent.blur(window);
		expect(screen.queryAllByRole("option")).toHaveLength(0);
	});

	it("свёрнутая полоса подписана тем видом, который был открыт", () => {
		act(() => { setTechDockView("tasks"); setTechMessagesOpen(false); });
		const { container } = show();

		const rail = container.querySelector("aside")!;
		expect(rail.getAttribute("aria-label")).toBe(translate(TECH_DOCK_TITLES.tasks));
		expect(rail.textContent).toContain(translate("TodosList"));
	});

	it("переключение на чужой вид не роняет область: пока он грузится, видно «Загрузка»", () => {
		const { container } = show();
		pick("assistant");

		// Вид подгружается лениво (React.lazy) — здесь важно, что область жива и объяснила паузу.
		expect(container.querySelector("aside")).toBeTruthy();
		expect(container.textContent).toContain(translate("loading"));
	});

	it("чужой вид обёрнут меткой — по ней он и ужимается под ширину области", () => {
		const { container } = show();

		// У журнала сообщений обёртки нет: он и написан под эту область.
		expect(container.querySelector("[data-dock-view]")).toBeNull();

		pick("communications");
		// Метка — единственная зацепка для стилей вида (Communications.module.scss и прочие):
		// пропадёт она — панель вернётся к вёрстке на весь экран внутри узкой колонки.
		expect(container.querySelector("[data-dock-view=\"communications\"]")).toBeTruthy();
	});
});
