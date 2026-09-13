/**
 * «Технические сообщения» для тех, кто не видит экран (M17).
 *
 * Тост объявляет себя сам, а итог фоновой работы, отказ команды и сообщение формы приходят
 * без тоста — и при свёрнутой области человек со скринридером о них не узнавал. Тест держит:
 * список размечен журналом; новое без тоста объявляется (ошибка — срочно); сказанное тостом
 * и существовавшее до открытия — не объявляется; свёрнутая полоса говорит числа словами.
 */
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import TechMessages from "src/components/TechMessages/TechMessages";
import {
	APP_SCOPE, addMessage, clearNoticeHistory, clearScope, getMessages, notify, setTechMessagesOpen,
} from "src/components/TechMessages/store";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";

const show = () => render(<TestWrapper><TechMessages /></TestWrapper>);
const said = (c: HTMLElement, kind: "urgent" | "calm") =>
	c.querySelector(`[data-announce="${kind}"]`)?.textContent ?? "";

describe("Технические сообщения: доступность", () => {
	beforeEach(() => {
		act(() => {
			clearScope("pane-1");
			clearNoticeHistory(APP_SCOPE);
			getMessages().length = 0;
			setTechMessagesOpen(true);
		});
		localStorage.setItem("tech_messages_all", "1");
	});

	it("список размечен журналом", () => {
		show();
		expect(screen.getByRole("log")).toBeTruthy();
	});

	it("ошибка без тоста объявляется срочно, с тостом — нет", () => {
		const { container } = show();
		act(() => { notify({ severity: "error", text: "Команда отклонена", source: "Базы 1С", toast: false }); });
		expect(said(container, "urgent")).toBe("Базы 1С: Команда отклонена");

		act(() => { notify({ severity: "error", text: "Нет связи", source: "Реализация" }); });
		// Тост уже объявил это сам — второй раз говорить незачем.
		expect(said(container, "urgent")).not.toMatch(/Нет связи/);
	});

	it("событие не-ошибка без тоста объявляется вежливо", () => {
		const { container } = show();
		act(() => { notify({ severity: "success", text: "Проверка завершена", source: "Базы 1С", toast: false }); });
		expect(said(container, "calm")).toBe("Базы 1С: Проверка завершена");
		expect(said(container, "urgent")).toBe("");
	});

	it("то, что было до открытия, — не новость", () => {
		act(() => { notify({ severity: "error", text: "Давний отказ", source: "Базы 1С", toast: false }); });
		const { container } = show();
		expect(said(container, "urgent")).toBe("");
	});

	it("объявление слышно и при свёрнутой области", () => {
		act(() => { setTechMessagesOpen(false); });
		const { container } = show();
		act(() => { notify({ severity: "error", text: "Команда отклонена", source: "Базы 1С", toast: false }); });
		expect(said(container, "urgent")).toMatch(/Команда отклонена/);
	});

	it("свёрнутая полоса называет счётчик словами", () => {
		act(() => {
			setTechMessagesOpen(false);
			addMessage({ scope: "pane-1", type: "warning", text: "Сохранено локально", source: "Реализация" });
		});
		show();
		expect(screen.getByLabelText(`${translate("techMsgActive")}: 1`)).toBeTruthy();
	});
});
