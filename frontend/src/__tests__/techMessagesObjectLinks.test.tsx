/**
 * Сообщение об объекте — ссылкой на объект, а не только подписью.
 *
 * ЖИВОЙ СЛУЧАЙ (13.09). «Изменить пользователя. Выполнено», «Не заполнен склад», отказ удаления
 * называли объект подписью, а открыть его из списка было нельзя: ссылку передавало одно место
 * из сорока. Теперь объект знает область (форма записи, карточка 1С), и итог операции над
 * одной базой или одним пользователем знает свой объект сам.
 */
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import MessagesView from "src/components/TechMessages/MessagesView";
import {
	APP_SCOPE, clearNoticeHistory, getMessages, notify, reportNotices, setScopeObject, useScopedNotices,
} from "src/components/TechMessages/store";
import { abandonOp, finishOp, getOps, startOp } from "src/models/OneCAdmin/progress";
import { canOpenByRef } from "src/utils/openFormByRef";
import { TestWrapper } from "./utils/TestWrapper";

const sale = { endpoint: "sales", uuid: "s1", label: "Реализация № 3" };
/** Подписанная витрина — хук хранилища живёт внутри компонента. */
const Live = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;

describe("ссылка на объект сообщения", () => {
	beforeEach(() => {
		act(() => {
			setScopeObject("pane-1", null);
			getOps().slice().forEach((o) => abandonOp(o.id));
			clearNoticeHistory(APP_SCOPE);
			getMessages().length = 0;
		});
		localStorage.setItem("tech_messages_group", "none");
		// Тесты вида строки: показываем и историю, чтобы запись без ожидания была в списке.
		localStorage.setItem("tech_messages_history", "1");
	});

	it("событие формы получает объект её области", () => {
		act(() => {
			setScopeObject("pane-1", sale);
			notify({ severity: "error", text: "Удаление запрещено: есть движения", source: "Удаление", scope: "pane-1", toast: false });
		});
		expect(getMessages()[0].ref).toMatchObject({ endpoint: "sales", uuid: "s1" });
	});

	it("сообщение формы, пришедшее раньше объекта, получает ссылку задним числом", () => {
		act(() => { reportNotices("pane-1", "k", "Реализация → загрузка…", [{ type: "attention", text: "Не заполнен склад" }]); });
		expect(getMessages()[0].ref).toBeUndefined();
		act(() => { setScopeObject("pane-1", sale); });
		expect(getMessages()[0].ref?.label).toBe("Реализация № 3");
		act(() => { reportNotices("pane-1", "k", "Реализация № 3", []); });
	});

	it("чужая область чужого объекта не получает", () => {
		act(() => {
			setScopeObject("pane-1", sale);
			notify({ severity: "info", text: "Общее", source: "Система", toast: false });
		});
		expect(getMessages()[0].ref).toBeUndefined();
	});

	it("итог операции 1С над одним пользователем базы — ссылка на его карточку", () => {
		act(() => {
			finishOp(startOp({ kind: "update", title: "Изменить пользователя", target: "Оператор — _transition", total: 1,
				scope: { user: "Оператор", bases: ["_transition"] } }));
		});
		expect(getMessages()[0].ref).toEqual({ endpoint: "onec-base-users", uuid: "_transition|Оператор", label: "Оператор — _transition" });
	});

	it("операция по многим базам объекта не выдумывает", () => {
		act(() => {
			finishOp(startOp({ kind: "read", title: "Проверить", target: "базы: 2", total: 2, scope: { bases: ["a", "b"] } }));
		});
		expect(getMessages()[0].ref).toBeUndefined();
	});

	it("объекты 1С и записи реестра открываются по ссылке, неизвестное — нет", () => {
		for (const e of ["onec-bases", "onec-base-users", "onec-agents", "sales"]) expect(canOpenByRef(e), e).toBe(true);
		expect(canOpenByRef("нет-такого")).toBe(false);
	});

	it("текст объекта и есть ссылка — второй подписи того же объекта нет", () => {
		// Живой случай 13.09: «Реализация ТМЗ и услуг: № 23414 - 08.03.2026» и ниже ещё
		// «№ 23414 от 08.03.2026» — один объект двумя подписями.
		act(() => {
			notify({
				severity: "error", text: "Недостаточно остатка", source: "Реализация ТМЗ и услуг: № 3 - 05.03.2026",
				scope: "pane-1", toast: false, ref: { endpoint: "sales", uuid: "s1", label: "№ 3 от 05.03.2026" },
			});
		});
		render(<TestWrapper><Live /></TestWrapper>);
		expect(screen.getByRole("button", { name: "Реализация ТМЗ и услуг: № 3 - 05.03.2026" })).toBeTruthy();
		expect(screen.queryByText("№ 3 от 05.03.2026")).toBeNull();
	});

	it("отказ записи не повторяется: пока форма сообщает тот же текст, уведомление скрыто", () => {
		const text = "Недостаточно остатка для проведения";
		act(() => {
			reportNotices("pane-1", "k", "Реализация № 3", [{ type: "error", text }]);
			notify({ severity: "error", text, source: "Реализация № 3", scope: "pane-1", toast: false });
		});
		render(<TestWrapper><Live /></TestWrapper>);
		expect(screen.getAllByText(text)).toHaveLength(1);
		// Форма замолчала (закрыли, исправили) — уведомление уходит в историю: одна запись, неактуальная.
		act(() => { reportNotices("pane-1", "k", "Реализация № 3", []); });
		expect(screen.getAllByText(text)).toHaveLength(1);
		expect(getMessages().filter((m) => m.text === text)).toHaveLength(1);
		expect(getMessages().find((m) => m.text === text)?.active).toBe(false);
	});
});
