import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import Notice from "src/components/Notice";
import {
	APP_SCOPE, NoticeScope, clearNoticeHistory, reportNotices, useScopedNotices,
} from "src/components/TechMessages/store";

// Правило вывода (запрос 2026-09-11): `<Notice />` НИЧЕГО не рисует на месте — он
// сообщает свои строки в область «Технические сообщения», и показывает их она.
//
// Раньше каждая форма вставляла сообщение в свою разметку: появилось — содержимое уехало
// вниз под курсором, исчезло — уехало обратно, а искать его приходилось заново в каждой
// форме. Исключение ровно одно: `inline` — там, где сообщение и ЕСТЬ содержимое места
// (тело модального окна подтверждения).

/** Витрина области: что бы она показала для этой области видимости. */
const Board = ({ scope }: { scope: string }) => (
	<ul>
		{useScopedNotices(scope).map((n) => (
			<li key={n.id} data-active={n.active}>{n.source}: {n.text}</li>
		))}
	</ul>
);

describe("Технические сообщения — единственное место вывода <Notice />", () => {
	beforeEach(() => {
		// Стор — модуль: между тестами его нужно опустошать, иначе записи копятся.
		act(() => {
			reportNotices("pane-1", "k", "s", []);
			reportNotices("pane-2", "k", "s", []);
			clearNoticeHistory(APP_SCOPE);
		});
	});

	it("на месте вызова не рисует ничего", () => {
		render(<Notice items={[{ type: "error", text: "Не заполнен склад" }]} />);
		expect(screen.queryByText("Не заполнен склад")).toBeNull();
	});

	it("сообщение доходит до области и подписано источником окружения", () => {
		render(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Реализация № 12" }}>
				<Notice items={[{ type: "error", text: "Не заполнен склад" }]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		expect(screen.getByText("Реализация № 12: Не заполнен склад")).toBeTruthy();
	});

	it("чужая форма своих сообщений не показывает", () => {
		render(
			<>
				<NoticeScope.Provider value={{ scope: "pane-1", source: "Реализация" }}>
					<Notice items={[{ type: "error", text: "Ошибка одной формы" }]} />
				</NoticeScope.Provider>
				<Board scope="pane-2" />
			</>,
		);
		expect(screen.queryByText(/Ошибка одной формы/)).toBeNull();
	});

	it("область «всё приложение» видит сообщения любой формы", () => {
		render(
			<>
				<NoticeScope.Provider value={{ scope: "pane-1", source: "Реализация" }}>
					<Notice items={[{ type: "warning", text: "Договор не тот" }]} />
				</NoticeScope.Provider>
				<Board scope={APP_SCOPE} />
			</>,
		);
		expect(screen.getByText("Реализация: Договор не тот")).toBeTruthy();
	});

	it("inline рисует на месте и НЕ дублируется в области", () => {
		render(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Подтверждение" }}>
				<Notice inline items={[{ type: "attention", text: "Данные базы будут заменены" }]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		// Видно ровно один раз — на месте вызова.
		expect(screen.getAllByText("Данные базы будут заменены")).toHaveLength(1);
		expect(screen.queryByText(/Подтверждение: /)).toBeNull();
	});

	it("замолчавший источник переводит запись в историю, а не теряет её", () => {
		const { rerender } = render(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Базы" }}>
				<Notice items={[{ type: "error", text: "Агент не на связи" }]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		expect(screen.getByText("Базы: Агент не на связи").getAttribute("data-active")).toBe("true");

		rerender(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Базы" }}>
				<Notice items={[]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		// Запись осталась, но уже как история: «было и прошло» — тоже ответ.
		expect(screen.getByText("Базы: Агент не на связи").getAttribute("data-active")).toBe("false");
	});
});
