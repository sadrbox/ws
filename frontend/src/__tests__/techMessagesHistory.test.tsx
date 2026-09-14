/**
 * Неактуальное — в историю автоматически, история — по кнопке.
 *
 * ЖИВОЙ СЛУЧАЙ (14.09). «Недостаточно остатка для проведения…» дважды у реализации, форма
 * которой закрыта: уведомление формы заводилось активным и оставалось таким навсегда.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import MessagesView from "src/components/TechMessages/MessagesView";
import {
	APP_SCOPE, clearNoticeHistory, getMessages, notify, reportNotices, resolveMessages, retireScope, useScopedNotices,
} from "src/components/TechMessages/store";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";

const Live = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;
const text = "Недостаточно остатка для проведения";
const formEvent = () => notify({ severity: "error", text, source: "Реализация № 3", scope: "pane-1", active: true, toast: false });

describe("актуальные сообщения и история", () => {
	beforeEach(() => {
		act(() => { reportNotices("pane-1", "k", "s", []); clearNoticeHistory(APP_SCOPE); getMessages().length = 0; });
		localStorage.setItem("tech_messages_group", "none");
		localStorage.removeItem("tech_messages_history");
	});

	it("форму закрыли — её события уходят в историю, но не удаляются", () => {
		act(() => { formEvent(); });
		expect(getMessages()[0].active).toBe(true);
		act(() => { retireScope("pane-1"); });
		expect(getMessages()).toHaveLength(1);
		expect(getMessages()[0].active).toBe(false);
	});

	it("форма перестала говорить тот же текст — событие уже неактуально", () => {
		act(() => { formEvent(); reportNotices("pane-1", "k", "Реализация № 3", [{ type: "error", text }]); });
		act(() => { reportNotices("pane-1", "k", "Реализация № 3", []); });
		expect(getMessages().find((m) => !m.fromSource)?.active).toBe(false);
	});

	it("форму записали — отказ записи в историю", () => {
		act(() => { formEvent(); resolveMessages("pane-1"); });
		expect(getMessages()[0].active).toBe(false);
	});

	it("по умолчанию неактуальное скрыто, «История» показывает всё", () => {
		act(() => {
			formEvent();
			retireScope("pane-1");
			notify({ severity: "warning", text: "Нет связи", source: "Сеть", active: true, toast: false });
		});
		render(<TestWrapper><Live /></TestWrapper>);
		expect(screen.queryByText(text)).toBeNull();
		expect(screen.getByText("Нет связи")).toBeTruthy();
		// Сколько в истории — числом на самой кнопке «История» (вариант Г).
		const historyButton = screen.getByRole("button", { name: new RegExp(`^${translate("techMsgHistory")}\\s*1$`) });

		fireEvent.click(historyButton);
		expect(screen.getByText(text)).toBeTruthy();
		// Выбор запомнен — это настройка рабочего места.
		expect(localStorage.getItem("tech_messages_history")).toBe("1");
	});

	it("всё неактуально — список говорит, что прошлое в истории", () => {
		act(() => { formEvent(); retireScope("pane-1"); });
		render(<TestWrapper><Live /></TestWrapper>);
		expect(screen.getByText(translate("techMsgNoActual"))).toBeTruthy();
	});
});
