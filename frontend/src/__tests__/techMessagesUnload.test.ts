/**
 * Перезагрузка страницы: обрывы запросов не оседают в истории, длительность восстановленной работы — от её запуска.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { noteNotice, setTechMessagesOwner } from "src/components/TechMessages/store";
import { getOps, resetOps, startOp } from "src/components/TechMessages/operations";

describe("перезагрузка страницы", () => {
	afterEach(() => {
		window.dispatchEvent(new Event("pageshow"));
		setTechMessagesOwner(null);
		resetOps();
	});

	it("пока страница выгружается, «Нет связи с сервером» в историю не пишется", () => {
		setTechMessagesOwner("user-unload");
		noteNotice("Базы 1С", { type: "error", text: "до выгрузки" });
		window.dispatchEvent(new Event("pagehide"));
		noteNotice("Базы 1С", { type: "error", text: "Нет связи с сервером" });
		const saved = JSON.parse(localStorage.getItem("tech-messages:user-unload") ?? "[]") as { text: string }[];
		expect(saved.some((m) => m.text === "до выгрузки")).toBe(true);
		expect(saved.some((m) => m.text === "Нет связи с сервером")).toBe(false);
	});

	it("с начала перехода (beforeunload) обрыв тоже не пишется; отменили переход — через 5 с пишем снова", () => {
		vi.useFakeTimers();
		try {
			setTechMessagesOwner("user-before");
			window.dispatchEvent(new Event("beforeunload"));
			noteNotice("Базы 1С", { type: "error", text: "Нет связи с сервером" });
			const read = () => JSON.parse(localStorage.getItem("tech-messages:user-before") ?? "[]") as { text: string }[];
			expect(read().some((m) => m.text === "Нет связи с сервером")).toBe(false);
			vi.advanceTimersByTime(5000);
			noteNotice("Базы 1С", { type: "error", text: "после отмены перехода" });
			expect(read().some((m) => m.text === "после отмены перехода")).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("восстановленная операция считает длительность от запуска на сервере", () => {
		const started = Date.now() - 76_000;
		const id = startOp({ kind: "read", title: "Расширения базы", target: "_transition", total: 1, startedAt: started });
		expect(getOps().find((o) => o.id === id)?.startedAt).toBe(started);
	});
});
