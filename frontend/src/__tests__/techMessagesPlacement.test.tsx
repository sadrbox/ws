/**
 * «Технические сообщения»: где стоит область — справа или внизу.
 *
 * ЗАЧЕМ ВЫБОР. Сообщения бывают разной формы. Ошибка проверки базы — это абзац, и ему нужна
 * ширина: в узкой колонке справа он превращается в лесенку из двух слов. Широкой форме
 * документа, наоборот, жалко четверти экрана вбок — ей область уместнее полосой внизу. Что
 * дороже в конкретной работе, знает только тот, кто работает.
 *
 * Тест держит три вещи: область знает своё место, переключатель его меняет, и выбор
 * переживает перезагрузку (он живёт в localStorage, а не в компоненте: место области —
 * привычка рабочего места, а не свойство текущего экрана).
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import TechMessages from "src/components/TechMessages/TechMessages";
import { setTechMessagesOpen, setTechMessagesPlacement } from "src/components/TechMessages/store";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";

const show = () => render(<TestWrapper><TechMessages /></TestWrapper>);
const dock = (c: HTMLElement) => c.querySelector("aside")!;

describe("Технические сообщения: место области", () => {
	beforeEach(() => {
		act(() => { setTechMessagesOpen(true); setTechMessagesPlacement("right"); });
	});

	it("по умолчанию область стоит справа", () => {
		const { container } = show();
		expect(dock(container).getAttribute("data-place")).toBe("right");
	});

	it("переключатель переносит область вниз и обратно", () => {
		const { container } = show();

		fireEvent.click(screen.getByRole("button", { name: translate("techMessagesDockBottom") }));
		expect(dock(container).getAttribute("data-place")).toBe("bottom");
		expect(localStorage.getItem("tech_messages_placement")).toBe("bottom");

		fireEvent.click(screen.getByRole("button", { name: translate("techMessagesDockRight") }));
		expect(dock(container).getAttribute("data-place")).toBe("right");
	});

	it("свёрнутая полоса стоит там же, где стояла область", () => {
		// Свернули — место не забылось: полоса раскрытия обязана быть там, где её ищут.
		act(() => { setTechMessagesPlacement("bottom"); setTechMessagesOpen(false); });
		const { container } = show();
		expect(dock(container).getAttribute("data-place")).toBe("bottom");
		expect(screen.getByRole("button", { name: translate("techMessagesOpen") })).toBeTruthy();
	});
});
