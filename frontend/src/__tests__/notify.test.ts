/**
 * `notify` — единственный вход для событий (M10, docs/TASKS_MESSAGING_2026-09-13.md).
 *
 * Тест держит договорённость: автор говорит, ЧТО случилось и нужен ли след, а показы —
 * тост и запись журнала — выбирает одна функция. Пока автор звал `showToast` и
 * `noteNotice` по отдельности, событие то терялось через четыре секунды, то показывалось
 * тостом дважды.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	APP_SCOPE, addMessage, clearNoticeHistory, clearScope, getMessages, noteNotice, notify,
} from "src/components/TechMessages/store";
import { addPaneNotification } from "src/hooks/paneNotifications";

const toasts: { message: string; type?: string; title?: string }[] = [];
vi.mock("src/components/UIToast", () => ({
	showToast: (message: string, type?: string, _duration?: number, title?: string) => {
		toasts.push({ message, type, title });
	},
}));

describe("notify: тост и журнал — два показа одного события", () => {
	beforeEach(() => {
		toasts.length = 0;
		clearScope("pane-1");
		clearNoticeHistory(APP_SCOPE);
		getMessages().length = 0;
	});

	it("по умолчанию — и тост, и запись в истории", () => {
		notify({ severity: "error", text: "Нет связи с сервером", source: "Реализация" });
		expect(toasts).toEqual([{ message: "Нет связи с сервером", type: "error", title: undefined }]);
		expect(getMessages()).toHaveLength(1);
		expect(getMessages()[0]).toMatchObject({
			text: "Нет связи с сервером", source: "Реализация", scope: APP_SCOPE, active: false,
		});
	});

	it("короткий тост, полный текст — в журнале", () => {
		// Подробности за четыре секунды не прочитать: тост говорит о факте, журнал — всё.
		notify({
			severity: "warning", source: "Импорт выписки",
			text: "Загружено 88 из 100. Не распознаны контрагенты: ТОО А, ТОО Б…",
			toast: "Загружено 88 из 100",
		});
		expect(toasts.map((t) => t.message)).toEqual(["Загружено 88 из 100"]);
		expect(getMessages()[0].text).toMatch(/Не распознаны контрагенты/);
	});

	it("toast: false — только запись", () => {
		notify({ severity: "success", text: "Проверка завершена", source: "Базы 1С", toast: false });
		expect(toasts).toHaveLength(0);
		expect(getMessages()).toHaveLength(1);
	});

	it("ephemeral — только тост, следа нет", () => {
		const id = notify({ severity: "success", text: "Сохранено", source: "Контрагент", ephemeral: true });
		expect(id).toBe("");
		expect(toasts.map((t) => t.message)).toEqual(["Сохранено"]);
		expect(getMessages()).toHaveLength(0);
	});

	it("«не заполнено обязательное» у тоста — предупреждение, в журнале — свой род", () => {
		notify({ severity: "attention", text: "Не заполнен склад", source: "Реализация" });
		expect(toasts[0].type).toBe("warning");
		expect(getMessages()[0].type).toBe("attention");
	});

	it("событие, ждущее человека, актуально до снятия", () => {
		notify({ severity: "error", text: "Отказ", source: "Реализация", scope: "pane-1", active: true });
		expect(getMessages()[0]).toMatchObject({ scope: "pane-1", active: true });
	});

	it("noteNotice и addMessage — обёртки без тоста", () => {
		noteNotice("Базы 1С", { type: "error", text: "Команда отклонена" });
		addMessage({ scope: "pane-1", type: "warning", text: "Сохранено локально", source: "Реализация" });
		expect(toasts).toHaveLength(0);
		const [added, noted] = getMessages();
		expect(noted).toMatchObject({ text: "Команда отклонена", active: false });
		expect(added).toMatchObject({ text: "Сохранено локально", active: true, scope: "pane-1" });
	});

	it("уведомление панели — ОДИН тост с заголовком панели и активная запись", () => {
		addPaneNotification("pane-1", "error", "Нет связи с сервером", { paneLabel: "Реализация № 12" });
		expect(toasts).toEqual([{ message: "Нет связи с сервером", type: "error", title: "Реализация № 12" }]);
		expect(getMessages()).toHaveLength(1);
		expect(getMessages()[0]).toMatchObject({ scope: "pane-1", active: true, source: "Реализация № 12" });
	});
});
