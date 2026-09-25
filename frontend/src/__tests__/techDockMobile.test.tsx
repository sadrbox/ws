/**
 * Область-спутник на телефоне: «Раскрыть/Скрыть» вместо «справа/внизу».
 *
 * ЗАЧЕМ. В 380 пикселях колонка справа оставляла и форме, и журналу по полоске, в которой не
 * читалось ни то, ни другое. На узком экране область либо свёрнута полосой под пейнами, либо
 * раскрыта на всё рабочее пространство.
 *
 * Тест держит то, без чего режим был бы ловушкой:
 *   • свёрнутую раскрывает полоса «Раскрыть», раскрытую сворачивает «Скрыть» — и выбора
 *     «справа/внизу», которому на телефоне не из чего выбирать, там нет;
 *   • телефонное «раскрыта» не пишется в настольную настройку: суженное и расширенное обратно
 *     окно возвращает область такой, какой её оставили на широком экране;
 *   • переход к другой форме скрывает раскрытую область — иначе форма открылась бы под ней.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import TechMessages from "src/components/TechMessages/TechMessages";
import { setTechDockView, setTechMessagesOpen, setTechMessagesPlacement } from "src/components/TechMessages/store";
import { translate } from "src/i18";

/*
 * ШИРИНА ЭКРАНА — через matchMedia. В jsdom его нет, подставляем управляемый: `matches`
 * читается при каждом обращении, а «поворот» экрана оповещает подписчиков, как это делает
 * браузер. Подставляется до первого рендера: запрос создаётся при первом обращении.
 */
let narrow = true;
const mediaListeners = new Set<() => void>();
window.matchMedia = ((query: string) => ({
	get matches() { return narrow; },
	media: query,
	onchange: null,
	addEventListener: (_: string, l: () => void) => { mediaListeners.add(l); },
	removeEventListener: (_: string, l: () => void) => { mediaListeners.delete(l); },
	addListener: () => { },
	removeListener: () => { },
	dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const resize = (toNarrow: boolean) => act(() => {
	narrow = toNarrow;
	for (const l of [...mediaListeners]) l();
});

const context = (activePane: string | null): TypeAppContextProps => ({
	screenRef: { current: null },
	windows: {
		panes: [],
		paneOrder: [],
		activePane,
		addPane: () => { },
		requestClose: async () => { },
		reloadPane: async () => { },
		setActivePane: () => { },
		updatePaneLabel: () => { },
		registerBeforeClose: () => () => { },
	},
	actions: { confirm: () => Promise.resolve(true) },
	navbar: { props: [], setProps: () => { } },
	auth: { user: null, logout: () => { } },
});

const Shell = ({ pane }: { pane: string | null }) => (
	<AppContextProvider value={context(pane)}><TechMessages /></AppContextProvider>
);

const expandBar = () => screen.queryByRole("button", { name: new RegExp(translate("techDockExpand")) });
const hideButton = () => screen.queryByRole("button", { name: translate("hide") });

describe("Область-спутник на телефоне", () => {
	beforeEach(() => {
		// Настольная настройка — «свёрнута», телефонная — тоже: каждый тест начинает с формы.
		narrow = false;
		act(() => { setTechMessagesOpen(false); setTechMessagesPlacement("right"); setTechDockView("messages"); });
		narrow = true;
		act(() => { setTechMessagesOpen(false); });
	});

	it("свёрнутая — полоса «Раскрыть»; нажатие раскрывает область на весь экран", () => {
		const { container } = render(<Shell pane="a" />);
		expect(container.querySelector('aside[data-place="mobile"]')).not.toBeNull();

		fireEvent.click(expandBar()!);

		expect(hideButton()).not.toBeNull();
		// Выбирать место на телефоне не из чего: кнопок «справа/внизу» нет.
		expect(screen.queryByRole("button", { name: translate("techMessagesDockRight") })).toBeNull();
		expect(screen.queryByRole("button", { name: translate("techMessagesDockBottom") })).toBeNull();
		expect(container.querySelector('aside[data-place="mobile"]')).not.toBeNull();
	});

	it("«Скрыть» сворачивает обратно в полосу", () => {
		render(<Shell pane="a" />);
		fireEvent.click(expandBar()!);
		fireEvent.click(hideButton()!);

		expect(hideButton()).toBeNull();
		expect(expandBar()).not.toBeNull();
	});

	it("телефонное «раскрыта» не трогает настольную настройку", () => {
		const { container } = render(<Shell pane="a" />);
		fireEvent.click(expandBar()!);
		// Настольное «раскрыта» не записано: на широком экране область осталась бы свёрнутой.
		expect(localStorage.getItem("tech_messages_open")).not.toBe("1");

		// Окно расширили: область такая, какой её оставили на широком экране, — свёрнутая.
		resize(false);
		expect(container.querySelector('aside[data-place="right"]')).not.toBeNull();
		expect(screen.queryByRole("button", { name: translate("techMessagesDockRight") })).toBeNull();

		// И обратно: телефонное состояние своё, оно по-прежнему «раскрыта».
		resize(true);
		expect(hideButton()).not.toBeNull();
	});

	it("переход к другой форме скрывает раскрытую область", () => {
		const { rerender } = render(<Shell pane="a" />);
		fireEvent.click(expandBar()!);
		expect(hideButton()).not.toBeNull();

		rerender(<Shell pane="b" />);
		expect(hideButton()).toBeNull();
		expect(expandBar()).not.toBeNull();
	});

	it("на широком экране смена формы область не сворачивает: она стоит рядом, а не поверх", () => {
		narrow = false;
		act(() => { setTechMessagesOpen(true); });
		const { rerender } = render(<Shell pane="a" />);
		rerender(<Shell pane="b" />);
		expect(screen.queryByRole("button", { name: translate("techMessagesClose") })).not.toBeNull();
	});
});
