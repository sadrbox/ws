/**
 * Технические сообщения — у каждого пользователя свои: после входа другим пользователем чужой истории не видно.
 */
import { afterEach, describe, expect, it } from "vitest";
import { addMessage, getMessages, setTechMessagesOwner } from "src/components/TechMessages/store";
import { getOps, resetOps, startOp } from "src/components/TechMessages/operations";

describe("история технических сообщений по пользователю", () => {
	afterEach(() => { setTechMessagesOwner(null); resetOps(); });

	it("вход другим пользователем — чужой истории нет; вернулся первый — его история на месте", () => {
		setTechMessagesOwner("user-a");
		addMessage({ scope: "app", type: "error", text: "Ошибка пользователя А", source: "Базы 1С" });
		expect(getMessages().some((m) => m.text === "Ошибка пользователя А")).toBe(true);

		expect(setTechMessagesOwner("user-b")).toBe(true);
		expect(getMessages().some((m) => m.text === "Ошибка пользователя А")).toBe(false);

		setTechMessagesOwner("user-a");
		expect(getMessages().some((m) => m.text === "Ошибка пользователя А")).toBe(true);
	});

	it("общий ключ прежних версий не показывается никому", () => {
		localStorage.setItem("tech-messages", JSON.stringify([{ id: "x", scope: "app", key: "x", type: "error", text: "Чужое", source: "", firstAt: Date.now(), lastAt: Date.now(), active: false }]));
		setTechMessagesOwner("user-c");
		expect(getMessages().some((m) => m.text === "Чужое")).toBe(false);
		expect(localStorage.getItem("tech-messages")).toBeNull();
	});

	it("смена пользователя сбрасывает операции прежнего", () => {
		startOp({ kind: "update", title: "Установить расширение", target: "shahs", total: 1 });
		expect(getOps().length).toBeGreaterThan(0);
		resetOps();
		expect(getOps()).toHaveLength(0);
	});
});
