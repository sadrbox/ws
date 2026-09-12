import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import Notice from "src/components/Notice";
import {
	APP_SCOPE, NoticeScope, addMessage, clearNoticeHistory, clearScope, dismissMessage,
	getMessages, isClearable, reportNotices, useScopedNotices,
} from "src/components/TechMessages/store";
import { groupMessages } from "src/components/TechMessages/grouping";
import { addPaneNotification } from "src/hooks/paneNotifications";
import { translate } from "src/i18";

// Правило вывода (запрос 2026-09-11): `<Notice />` НИЧЕГО не рисует на месте — он
// сообщает свои строки в область «Технические сообщения», и показывает их она.
//
// Раньше каждая форма вставляла сообщение в свою разметку: появилось — содержимое уехало
// вниз под курсором, исчезло — уехало обратно, а искать его приходилось заново в каждой
// форме. Исключение ровно одно: `inline` — там, где сообщение и ЕСТЬ содержимое места
// (тело модального окна подтверждения).

/** Витрина области: что бы она показала для этой области видимости. */
const Board = ({ scope }: { scope: string }) => (
	<ul>
		{useScopedNotices(scope).map((n) => (
			<li key={n.id} data-active={n.active}>{n.source}: {n.text}</li>
		))}
	</ul>
);

describe("Технические сообщения — единственное место вывода <Notice />", () => {
	beforeEach(() => {
		// Стор — модуль: между тестами его нужно опустошать, иначе записи копятся.
		act(() => {
			reportNotices("pane-1", "k", "s", []);
			reportNotices("pane-2", "k", "s", []);
			clearNoticeHistory(APP_SCOPE);
		});
	});

	it("на месте вызова не рисует ничего", () => {
		render(<Notice items={[{ type: "error", text: "Не заполнен склад" }]} />);
		expect(screen.queryByText("Не заполнен склад")).toBeNull();
	});

	it("сообщение доходит до области и подписано источником окружения", () => {
		render(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Реализация № 12" }}>
				<Notice items={[{ type: "error", text: "Не заполнен склад" }]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		expect(screen.getByText("Реализация № 12: Не заполнен склад")).toBeTruthy();
	});

	it("чужая форма своих сообщений не показывает", () => {
		render(
			<>
				<NoticeScope.Provider value={{ scope: "pane-1", source: "Реализация" }}>
					<Notice items={[{ type: "error", text: "Ошибка одной формы" }]} />
				</NoticeScope.Provider>
				<Board scope="pane-2" />
			</>,
		);
		expect(screen.queryByText(/Ошибка одной формы/)).toBeNull();
	});

	it("область «всё приложение» видит сообщения любой формы", () => {
		render(
			<>
				<NoticeScope.Provider value={{ scope: "pane-1", source: "Реализация" }}>
					<Notice items={[{ type: "warning", text: "Договор не тот" }]} />
				</NoticeScope.Provider>
				<Board scope={APP_SCOPE} />
			</>,
		);
		expect(screen.getByText("Реализация: Договор не тот")).toBeTruthy();
	});

	it("inline рисует на месте и НЕ дублируется в области", () => {
		render(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Подтверждение" }}>
				<Notice inline items={[{ type: "attention", text: "Данные базы будут заменены" }]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		// Видно ровно один раз — на месте вызова.
		expect(screen.getAllByText("Данные базы будут заменены")).toHaveLength(1);
		expect(screen.queryByText(/Подтверждение: /)).toBeNull();
	});

	it("замолчавший источник переводит запись в историю, а не теряет её", () => {
		const { rerender } = render(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Базы" }}>
				<Notice items={[{ type: "error", text: "Агент не на связи" }]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		expect(screen.getByText("Базы: Агент не на связи").getAttribute("data-active")).toBe("true");

		rerender(
			<NoticeScope.Provider value={{ scope: "pane-1", source: "Базы" }}>
				<Notice items={[]} />
				<Board scope="pane-1" />
			</NoticeScope.Provider>,
		);
		// Запись осталась, но уже как история: «было и прошло» — тоже ответ.
		expect(screen.getByText("Базы: Агент не на связи").getAttribute("data-active")).toBe("false");
	});
});

// ── Слияние с уведомлениями панелей ────────────────────────────────────────
//
// Раньше об одном и том же рассказывали четыре поверхности: колокольчик уведомлений
// панелей, второй колокольчик со своим журналом, пейн «Центр уведомлений» и `<Notice />`
// внутри форм. Теперь хранилище одно, и уведомление панели — такая же запись, как
// сообщение формы: видно в том же списке, группируется по тому же объекту.

describe("Технические сообщения — один механизм с уведомлениями панелей", () => {
	beforeEach(() => {
		act(() => { clearScope("pane-1"); clearScope("pane-2"); clearNoticeHistory(APP_SCOPE); });
	});

	it("уведомление панели попадает в тот же список, что и <Notice />", () => {
		act(() => {
			addPaneNotification("pane-1", "warning", "Сохранено локально", { paneLabel: "Реализация № 12" });
		});
		render(<Board scope="pane-1" />);
		expect(screen.getByText("Реализация № 12: Сохранено локально")).toBeTruthy();
	});

	it("группа — ВИД ОБЪЕКТА: разные документы одного вида идут вместе", () => {
		act(() => {
			addPaneNotification("pane-1", "error", "Не проведён", {
				paneLabel: "Реализация № 12", ref: { endpoint: "sales", uuid: "u1", label: "№ 12" },
			});
			addPaneNotification("pane-2", "error", "Нет договора", {
				paneLabel: "Реализация № 13", ref: { endpoint: "sales", uuid: "u2", label: "№ 13" },
			});
		});
		const groups = groupMessages(getMessages());
		const sales = groups.find((g) => g.id === "ref:sales");
		expect(sales).toBeTruthy();
		expect(sales!.items).toHaveLength(2);
		// Заголовок — вид объекта из словаря, а не заголовок формы: у двух документов
		// заголовки разные, а назначение одно.
		expect(sales!.title).toBe(translate("sale"));
	});

	it("без ссылки на объект группой служит источник, без источника — «Прочее»", () => {
		act(() => {
			addPaneNotification("pane-1", "info", "Агент не на связи", { paneLabel: "Базы 1С" });
			addPaneNotification("pane-1", "info", "Что-то общее", {});
		});
		const groups = groupMessages(getMessages());
		expect(groups.some((g) => g.title === "Базы 1С")).toBe(true);
		expect(groups.some((g) => g.title === translate("techMessagesOther"))).toBe(true);
	});

	it("группа с актуальными сообщениями идёт выше группы из одной истории", () => {
		act(() => {
			// История: запись, которая уже не активна.
			reportNotices("pane-1", "old", "Прошлое", [{ type: "info", text: "Было" }]);
			reportNotices("pane-1", "old", "Прошлое", []);
			// Актуальное — заведено позже, но важнее.
			addPaneNotification("pane-1", "error", "Сейчас", { paneLabel: "Сейчас" });
		});
		const groups = groupMessages(getMessages());
		expect(groups[0].active).toBeGreaterThan(0);
	});
});

// ── Сводка формы: одно новое сообщение не плодит копий соседних ─────────────
//
// ЖИВОЙ СЛУЧАЙ: в карточке пользователя базы список сообщений выглядел так, будто «Не
// записано изменений: 1» случилось трижды. Форма шлёт сводку одним списком под одним
// ключом, и любое изменение этого списка раньше гасило ВСЕ его записи и заводило все
// заново: стоило появиться «идёт операция», как соседние уходили в историю копиями самих
// себя.

describe("Технические сообщения: сводка формы", () => {
	beforeEach(() => {
		act(() => {
			reportNotices("pane-1", "k", "s", []);
			clearNoticeHistory(APP_SCOPE);
			getMessages().slice().forEach((m) => dismissMessage(m.id));
		});
	});

	it("новое сообщение в сводке не дублирует прежние", () => {
		act(() => { reportNotices("pane-1", "k", "Карточка", [{ type: "info", text: "Не применено правок: 1" }]); });
		act(() => {
			reportNotices("pane-1", "k", "Карточка", [
				{ type: "info", text: "Правка заблокирована" },
				{ type: "info", text: "Не применено правок: 1" },
			]);
		});
		const texts = getMessages().map((m) => m.text);
		expect(texts.filter((t) => t === "Не применено правок: 1")).toHaveLength(1);
		expect(texts).toContain("Правка заблокирована");
		// Уцелевшая запись осталась ТОЙ ЖЕ: «висит с обеда» — это про обед.
		expect(getMessages().every((m) => m.active)).toBe(true);
	});

	it("исчезнувшее из сводки уходит в историю, остальное остаётся актуальным", () => {
		act(() => {
			reportNotices("pane-1", "k", "Карточка", [
				{ type: "info", text: "Правка заблокирована" },
				{ type: "info", text: "Не применено правок: 1" },
			]);
		});
		act(() => { reportNotices("pane-1", "k", "Карточка", [{ type: "info", text: "Не применено правок: 1" }]); });
		const byText = new Map(getMessages().map((m) => [m.text, m]));
		expect(byText.get("Правка заблокирована")!.active).toBe(false);
		expect(byText.get("Не применено правок: 1")!.active).toBe(true);
	});
});

// ── «Очистить историю»: что уходит и что обязано остаться ───────────────────
//
// ЖИВОЙ СЛУЧАЙ: кнопку нажимали, а часть сообщений оставалась. Оставались СОБЫТИЯ
// (addMessage: «нет связи», отказ команды): они заводятся активными и ждут, что их уберут
// руками, — а убирать их было некому, потому что очистка щадила всё активное. Они копились,
// и кнопка выглядела сломанной.
//
// Правило теперь одно: уходит всё, КРОМЕ сказанного живым источником. Такую запись убирать
// бессмысленно — экран сообщит её снова на следующем рендере, и «очистить» превратилось бы
// в мигание списка.

describe("Технические сообщения: очистка списка", () => {
	beforeEach(() => {
		act(() => {
			reportNotices("pane-1", "k", "s", []);
			reportNotices("pane-2", "k", "s", []);
			clearNoticeHistory(APP_SCOPE);
			getMessages().slice().forEach((m) => dismissMessage(m.id));
		});
	});

	it("событие уходит, даже если его никто не отменял", () => {
		act(() => { addMessage({ scope: APP_SCOPE, type: "error", text: "Нет связи", source: "Сеть" }); });
		expect(getMessages()).toHaveLength(1);

		act(() => { clearNoticeHistory(APP_SCOPE); });
		expect(getMessages()).toHaveLength(0);
	});

	it("сказанное живым источником остаётся: удалять его бессмысленно", () => {
		act(() => { reportNotices("pane-1", "k", "Реализация", [{ type: "error", text: "Не заполнен склад" }]); });
		act(() => { clearNoticeHistory(APP_SCOPE); });
		expect(getMessages().map((m) => m.text)).toEqual(["Не заполнен склад"]);
	});

	it("замолчавший источник уходит вместе с историей", () => {
		act(() => { reportNotices("pane-1", "k", "Реализация", [{ type: "error", text: "Не заполнен склад" }]); });
		// Источник замолчал — запись стала историей, а история и есть то, что чистят.
		act(() => { reportNotices("pane-1", "k", "Реализация", []); });
		act(() => { clearNoticeHistory(APP_SCOPE); });
		expect(getMessages()).toHaveLength(0);
	});

	it("кнопка гаснет ровно тогда, когда чистить нечего", () => {
		act(() => { reportNotices("pane-1", "k", "Реализация", [{ type: "error", text: "Не заполнен склад" }]); });
		// В списке только живое — чистить нечего, и кнопка обязана это показать.
		expect(isClearable(getMessages())).toBe(false);

		act(() => { addMessage({ scope: APP_SCOPE, type: "info", text: "Готово", source: "Команда" }); });
		expect(isClearable(getMessages())).toBe(true);
	});
});

// ── Что остаётся после очистки и почему это не мусор ────────────────────────
//
// ЖИВОЙ СЛУЧАЙ (12.09, повторно). «Очистить историю» нажимали — часть сообщений оставалась,
// а кнопка гасла: со стороны это выглядело сломанным. На деле оставались записи ОТКРЫТЫХ
// ФОРМ: форма сообщает своё состояние заново, и убрать его нельзя — вернётся через секунду.
// Проверено: скрытая такая запись возвращается на первом же докладе формы.
//
// Значит, чинить надо не очистку, а интерфейс: сказать, чьи это сообщения, и не показывать
// кнопку, которая не может сделать обещанного.

describe("Технические сообщения: живые записи и очистка", () => {
	beforeEach(() => {
		act(() => {
			reportNotices("pane-1", "k", "s", []);
			clearNoticeHistory(APP_SCOPE);
			getMessages().slice().forEach((m) => dismissMessage(m.id));
		});
	});

	it("сообщение открытой формы помечено как живое", () => {
		act(() => { reportNotices("pane-1", "k", "Пользователь базы", [{ type: "info", text: "Не применено правок: 1" }]); });
		const [m] = getMessages();
		expect(m.fromSource).toBe(true);
		expect(m.active).toBe(true);
	});

	it("скрытая запись живой формы возвращается — поэтому кнопки «Скрыть» у неё быть не должно", () => {
		act(() => { reportNotices("pane-1", "k", "Пользователь базы", [{ type: "info", text: "Не применено правок: 1" }]); });
		act(() => { dismissMessage(getMessages()[0].id); });
		expect(getMessages()).toHaveLength(0);

		// Форма доложила состояние заново — запись вернулась. Убрать её нельзя, пока форма
		// так считает: это не мусор в журнале, а то, что происходит прямо сейчас.
		act(() => { reportNotices("pane-1", "k", "Пользователь базы", [{ type: "info", text: "Не применено правок: 1" }]); });
		expect(getMessages()).toHaveLength(1);
	});

	it("после очистки остаются только живые — и кнопка честно гаснет", () => {
		act(() => {
			reportNotices("pane-1", "k", "Пользователь базы", [{ type: "info", text: "Не применено правок: 1" }]);
			addMessage({ scope: APP_SCOPE, type: "error", text: "Нет связи", source: "Сеть" });
		});
		act(() => { clearNoticeHistory(APP_SCOPE); });

		expect(getMessages().map((m) => m.text)).toEqual(["Не применено правок: 1"]);
		// Гаснет по делу: всё, что можно убрать, уже убрано.
		expect(isClearable(getMessages())).toBe(false);
	});
});
