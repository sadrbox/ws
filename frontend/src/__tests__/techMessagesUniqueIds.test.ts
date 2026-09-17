/**
 * Идентификаторы технических сообщений уникальны и между перезагрузками страницы.
 *
 * ЖИВОЙ СЛУЧАЙ (17.09): «Warning: Encountered two children with the same key, `m1`» в MessagesView. История лежала в
 * localStorage вместе с идентификаторами, а счётчик после перезагрузки начинался заново: первое новое сообщение
 * получало `m1`, который уже был в поднятой истории.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { dismissMessage, getMessages, notify, setTechMessagesOwner } from "src/components/TechMessages/store";

const old = (id: string, text: string) => ({
	id, scope: "app", key: id, type: "error", text, source: "Базы", active: false,
	firstAt: Date.now() - 60_000, lastAt: Date.now() - 60_000, count: 1,
});

describe("идентификаторы сообщений", () => {
	beforeEach(() => { setTechMessagesOwner(null); });

	it("новое сообщение после «перезагрузки» не совпадает с сохранённым `m1`", () => {
		localStorage.setItem("tech-messages:user-1", JSON.stringify([old("m1", "было до перезагрузки")]));
		setTechMessagesOwner("user-1");
		expect(getMessages().map((m) => m.id)).toEqual(["m1"]);

		const id = notify({ severity: "error", text: "новое", source: "Базы", toast: false });
		const ids = getMessages().map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(id).not.toBe("m1");

		// Крестик на новом сообщении не убирает старое с тем же прежним id.
		dismissMessage(id);
		expect(getMessages().map((m) => m.text)).toEqual(["было до перезагрузки"]);
	});

	it("повторы в истории прежних версий разводятся при загрузке, первая запись сохраняет id", () => {
		localStorage.setItem("tech-messages:user-2", JSON.stringify([old("m1", "первое"), old("m1", "второе")]));
		setTechMessagesOwner("user-2");
		const ids = getMessages().map((m) => m.id);
		expect(ids[0]).toBe("m1");
		expect(new Set(ids).size).toBe(2);
	});
});
