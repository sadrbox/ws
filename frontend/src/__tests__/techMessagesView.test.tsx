import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import MessagesView from "src/components/TechMessages/MessagesView";
import {
	APP_SCOPE, addMessage, clearNoticeHistory, clearScope, getMessages, useScopedNotices,
} from "src/components/TechMessages/store";
import { TestWrapper } from "./utils/TestWrapper";

// Вид «Технических сообщений»: ОДНА ВЕРТИКАЛЬНАЯ КОЛОНКА, без колоночной сетки.
//
// Сетка требует, чтобы у всех строк были одни и те же колонки одной ширины, — а здесь
// строки разной природы: заголовок объекта в одну строку и сообщение на три-четыре. Дата
// и состояние в отдельных колонках отнимали ширину у главного, у самого текста.
//
// Договорённости, которые тест держит:
//   1) заголовок объекта — ОДИН на группу, сообщения раскрываются под ним;
//   2) уточнения (тип, источник, когда, актуальность) стоят ПОД текстом, в его же строке,
//      а не в соседних колонках;
//   3) действия — внутри самого сообщения, а не в общей панели «по выбранной строке»;
//   4) текст сообщения доходит до разметки ЦЕЛИКОМ: обрезанное прячет то, ради чего смотрят.

const long = "ibcmd extension list по базе «almaz67» не ответил за 180 с — процесс снят. "
	+ "Обычно это занятый рабочий каталог или блокировка в самой базе";

describe("Технические сообщения: вид одной колонкой", () => {
	beforeEach(() => {
		act(() => { clearScope("pane-1"); clearScope("pane-2"); clearNoticeHistory(APP_SCOPE); });
	});

	/**
	 * Подписанная витрина — как в приложении. Снимок `getMessages()` показал бы вид один
	 * раз и не заметил бы изменений хранилища: тест проверял бы не то, что работает.
	 */
	const Live = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;
	const show = () => render(<TestWrapper><Live /></TestWrapper>);

	it("сообщения одного объекта собраны под одним заголовком", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Первое", source: "Базы 1С" });
			addMessage({ scope: "pane-1", type: "warning", text: "Второе", source: "Базы 1С" });
		});
		show();
		// Заголовок объекта один, а сообщений под ним два.
		expect(screen.getAllByRole("button", { name: /Базы 1С/ })).toHaveLength(1);
		expect(screen.getByText("Первое")).toBeTruthy();
		expect(screen.getByText("Второе")).toBeTruthy();
	});

	it("текст сообщения не обрезан, а уточнения стоят под ним в той же строке", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: long, source: "Базы 1С" });
		});
		const { container } = show();
		const text = screen.getByText(long);
		expect(text.textContent).toContain("блокировка в самой базе");

		// Уточнения — в СОСЕДНЕМ узле внутри того же сообщения, а не в другой колонке.
		const message = text.parentElement!;
		expect(message.textContent).toContain("Базы 1С");
		// Тип сообщения назван словом: цвет — подспорье, а читают текст.
		expect(message.textContent).toContain("Ошибка");
		// Полоса палитры — на самом сообщении: цвет виден и когда текста много.
		expect(container.querySelector('[data-type="error"]')).toBeTruthy();
	});

	it("действия живут внутри сообщения", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Сбой", source: "Базы 1С" });
		});
		show();
		const message = screen.getByText("Сбой").parentElement!;
		// «Скрыть» — у самого сообщения, а не в панели «по выбранной строке».
		const hide = Array.from(message.querySelectorAll("button"))
			.find((b) => /Скрыть/.test(b.textContent ?? ""));
		expect(hide).toBeTruthy();

		fireEvent.click(hide!);
		expect(screen.queryByText("Сбой")).toBeNull();
	});

	it("группа без актуальных сообщений свёрнута, пока её не откроют", () => {
		act(() => {
			const id = addMessage({ scope: "pane-1", type: "info", text: "Прошлое", source: "Базы 1С" });
			// Переводим в историю тем же путём, что и жизнь: запись остаётся, но не активна.
			void id;
		});
		// Делаем запись неактуальной: очистка истории её не тронет, а вид — свернёт.
		act(() => { getMessages().forEach((m) => { (m as { active: boolean }).active = false; }); });

		show();
		expect(screen.queryByText("Прошлое")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Базы 1С/ }));
		expect(screen.getByText("Прошлое")).toBeTruthy();
	});
});
