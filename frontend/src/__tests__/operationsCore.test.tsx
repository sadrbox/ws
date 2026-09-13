/**
 * Общий реестр длительной работы (M13, docs/TASKS_MESSAGING_2026-09-13.md).
 *
 * Реестр вырос в панели 1С, и область сообщений склеивала два списка вручную: поиск,
 * «Только ошибки» и срез «Текущая форма» к операциям не применялись. Тест держит:
 * область сообщений не зависит от панели 1С; команды списка действуют и на операции;
 * операция без пейна видна в любом срезе; отмену знает тот, кто поставил работу.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderHook, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import MessagesView from "src/components/TechMessages/MessagesView";
import {
	APP_SCOPE, clearNoticeHistory, getMessages, noteNotice, useScopedNotices,
} from "src/components/TechMessages/store";
import {
	abandonOp, cancelOp, finishOp, getOps, setOpCanceler, startOp, useRunningWork,
} from "src/components/TechMessages/operations";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";

const Live = ({ pane }: { pane?: string }) => <MessagesView messages={useScopedNotices(APP_SCOPE)} pane={pane} />;
const show = (pane?: string) => render(<TestWrapper><Live pane={pane} /></TestWrapper>);
const op = (title: string, extra: { pane?: string } = {}) =>
	startOp({ kind: "read", title, target: "t", total: 1, ...extra });

describe("Общий реестр длительной работы", () => {
	beforeEach(() => {
		act(() => {
			getOps().slice().forEach((o) => abandonOp(o.id));
			clearNoticeHistory(APP_SCOPE);
			getMessages().length = 0;
		});
		localStorage.setItem("tech_messages_group", "object");
	});

	it("область сообщений не импортирует панель 1С", () => {
		// vitest запускается из каталога frontend; import.meta.url в jsdom — не file://.
		const dir = join(process.cwd(), "src/components/TechMessages");
		const files = readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n));
		expect(files).toContain("operations.ts");
		for (const f of files) {
			expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/from\s+["'][^"']*models\/OneCAdmin/);
		}
	});

	it("поиск находит операцию по названию и отсекает остальные", () => {
		act(() => {
			op("Сверить ленту А");
			op("Выгрузить базу Б");
			// Поиск показывается, когда в списке есть сообщения.
			noteNotice("Система", { type: "info", text: "Посторонняя запись" });
		});
		show();
		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "сверить" } });
		expect(screen.getByText(/Сверить ленту А/)).toBeTruthy();
		expect(screen.queryByText(/Выгрузить базу Б/)).toBeNull();
	});

	it("«Только ошибки» оставляет упавшую операцию", () => {
		act(() => {
			op("Идущая сверка");
			finishOp(op("Упавшая сверка"), { failed: 1, note: "нет доступа" });
		});
		show();
		fireEvent.click(screen.getByRole("button", { name: translate("techMsgErrorsOnly") }));
		expect(screen.queryByText(/Идущая сверка/)).toBeNull();
		expect(screen.getAllByText(/Упавшая сверка/).length).toBeGreaterThan(0);
	});

	it("срез формы: чужой пейн скрыт, своя и работа без пейна — видны", () => {
		act(() => {
			op("Чужая работа", { pane: "pane-2" });
			op("Работа панели 1С");
			op("Своя работа", { pane: "pane-1" });
		});
		show("pane-1");
		expect(screen.queryByText(/Чужая работа/)).toBeNull();
		expect(screen.getByText(/Работа панели 1С/)).toBeTruthy();
		expect(screen.getByText(/Своя работа/)).toBeTruthy();
	});

	it("итог операции ложится в журнал её пейна", () => {
		act(() => { finishOp(op("Импорт выписки", { pane: "pane-1" })); });
		expect(getMessages()[0]).toMatchObject({ scope: "pane-1", type: "success" });
	});

	it("итог сообщает вызывающий — второй записи в журнале нет", () => {
		// Импорт пишет «загружено 88 из 100» сам; безликое «Выполнено» рядом было бы дублем.
		act(() => { finishOp(startOp({ kind: "create", title: "Импорт выписки", target: "t", total: 1, reportsOwnOutcome: true })); });
		expect(getMessages()).toHaveLength(0);
	});

	it("пейн «всё приложение» — это отсутствие пейна", () => {
		act(() => { startOp({ kind: "read", title: "Общая работа", target: "t", total: 1, pane: APP_SCOPE }); });
		expect(getOps()[0].pane).toBeUndefined();
	});

	it("экран узнаёт, что работа с его ключом уже идёт", () => {
		const { result } = renderHook(() => useRunningWork("db-backup"));
		expect(result.current).toBe(false);
		let id = "";
		act(() => { id = startOp({ kind: "create", title: "Резервная копия", target: "", total: 1, workKey: "db-backup" }); });
		expect(result.current).toBe(true);
		act(() => { finishOp(id); });
		expect(result.current).toBe(false);
	});

	it("итог знает свою операцию, а «Скрыть» операцию итог не трогает (M14)", () => {
		let id = "";
		act(() => { id = op("Сверка прав"); finishOp(id); });
		expect(getMessages()[0].opId).toBe(id);
		act(() => { abandonOp(id); });
		expect(getMessages()).toHaveLength(1);
	});

	it("из итога переходят к операции, пока она в «Прогрессе»", () => {
		// Без группировки: итог — история, и в режиме объектов его группа свёрнута.
		localStorage.setItem("tech_messages_group", "none");
		let id = "";
		act(() => { id = op("Сверка прав"); finishOp(id); });
		show();
		const go = screen.getByRole("button", { name: translate("techMsgShowOp") });
		fireEvent.click(go);
		expect(document.activeElement?.id).toBe(`op-${id}`);
		act(() => { abandonOp(id); });
		expect(screen.queryByRole("button", { name: translate("techMsgShowOp") })).toBeNull();
	});

	it("отмену знает тот, кто поставил работу", async () => {
		const id = op("Команда агенту");
		setOpCanceler(id, () => Promise.resolve(3));
		expect(await cancelOp(id)).toBe(3);
		expect(await cancelOp("нет-такой")).toBe(0);
	});
});
