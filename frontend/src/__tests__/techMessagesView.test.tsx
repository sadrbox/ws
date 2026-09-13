import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import MessagesView from "src/components/TechMessages/MessagesView";
import {
	APP_SCOPE, addMessage, clearNoticeHistory, clearScope, getMessages, useScopedNotices,
} from "src/components/TechMessages/store";
import { groupMessages } from "src/components/TechMessages/grouping";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";

// Вид «Технических сообщений»: ЖУРНАЛ СО ШКАЛОЙ ВРЕМЕНИ (вариант «B», выбран 2026-09-12).
//
// Колонка времени слева, линия с точкой палитры, текст во всю оставшуюся ширину. Полной
// колоночной сетки нет: дата, состояние и источник отдельными колонками отнимали ширину у
// главного — у самого текста, — и он всё равно не помещался.
//
// Договорённости, которые тест держит:
//   1) заголовок группы — ОДИН на группу, сообщения раскрываются под ним и сворачиваются;
//   2) уточнения (тип, объект, источник, актуальность) стоят ПОД текстом, в его же строке,
//      а не в соседних колонках;
//   3) действия — внутри самого сообщения, а не в общей панели «по выбранной строке»;
//   4) текст сообщения доходит до разметки ЦЕЛИКОМ: обрезанное прячет то, ради чего смотрят;
//   5) группировка переключается: по объекту, по дате, без группировки — и запоминается.

const long = "ibcmd extension list по базе «almaz67» не ответил за 180 с — процесс снят. "
	+ "Обычно это занятый рабочий каталог или блокировка в самой базе";

describe("Технические сообщения: журнал со шкалой времени", () => {
	beforeEach(() => {
		act(() => { clearScope("pane-1"); clearScope("pane-2"); clearNoticeHistory(APP_SCOPE); });
		// Режим группировки — настройка рабочего места и переживает перезагрузку: между
		// тестами её нужно возвращать к умолчанию, иначе они зависели бы от порядка.
		localStorage.setItem("tech_messages_group", "object");
	});

	/**
	 * Подписанная витрина — как в приложении. Снимок `getMessages()` показал бы вид один
	 * раз и не заметил бы изменений хранилища: тест проверял бы не то, что работает.
	 */
	const Live = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;
	const show = () => render(<TestWrapper><Live /></TestWrapper>);

	it("сообщения одного объекта собраны под одним заголовком", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Первое", source: "Базы 1С" });
			addMessage({ scope: "pane-1", type: "warning", text: "Второе", source: "Базы 1С" });
		});
		show();
		// Заголовок объекта один, а сообщений под ним два.
		expect(screen.getAllByRole("button", { name: /Базы 1С/ })).toHaveLength(1);
		expect(screen.getByText("Первое")).toBeTruthy();
		expect(screen.getByText("Второе")).toBeTruthy();
	});

	it("текст сообщения не обрезан, а уточнения стоят под ним в той же строке", () => {
		act(() => {
			// Со ссылкой на объект: группа называется видом объекта («База»), источник —
			// заголовком пейна, и в строке они говорят разное.
			addMessage({
				scope: "pane-1", type: "error", text: long, source: "Базы 1С",
				ref: { endpoint: "onec-bases", uuid: "b1", label: "almaz67" },
			});
		});
		const { container } = show();
		const text = screen.getByText(long);
		expect(text.textContent).toContain("блокировка в самой базе");

		// Уточнения — в той же строке, а не в другой колонке таблицы.
		const row = text.closest("article")!;
		expect(row.textContent).toContain("Базы 1С");
		// Род сообщения назван словом — под датой и временем, в левой колонке: цвет точки
		// подсказывает то же самое, но читают всё-таки текст.
		expect(row.textContent).toContain("Ошибка");
		// Полоса палитры — на самом сообщении: цвет виден и когда текста много.
		expect(container.querySelector('[data-type="error"]')).toBeTruthy();
	});

	it("объект и источник не повторяют друг друга", () => {
		// У записи без ссылки на объект заголовком объекта служит сам источник, и строка
		// показывала одну и ту же подпись дважды подряд — заметнее всего без группировки.
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Сбой", source: "Пользователь базы: Иванов" });
		});
		show();
		fireEvent.click(screen.getByRole("button", { name: translate("techMsgGroupNone") }));
		expect(screen.getAllByText("Пользователь базы: Иванов")).toHaveLength(1);
	});

	it("действия живут внутри сообщения", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Сбой", source: "Базы 1С" });
		});
		show();
		const row = screen.getByText("Сбой").closest("article")!;
		// «Скрыть» — у самого сообщения, а не в панели «по выбранной строке». Ищем по имени
		// кнопки, а не по её тексту: подпись повторялась бы в каждой строке и отнимала место
		// у сообщения, поэтому кнопка стала иконкой — имя осталось в aria-label и подсказке.
		const hide = Array.from(row.querySelectorAll("button"))
			.find((b) => /Скрыть/.test(b.getAttribute("aria-label") ?? ""));
		expect(hide).toBeTruthy();

		fireEvent.click(hide!);
		expect(screen.queryByText("Сбой")).toBeNull();
	});

	it("представление объекта — само по себе ссылка, отдельной кнопки нет", () => {
		/*
		 * Раньше строка называла объект трижды: видом («Реализация»), представлением
		 * («Реализация ТМЗ и услуг: № 3 - 05.03.2026») и подписью кнопки «Открыть». Вид
		 * ничего не добавляет к представлению, с которого он и начинается, а кнопка
		 * повторяла написанное рядом и занимала целый ряд под текстом.
		 */
		act(() => {
			addMessage({
				scope: "pane-1", type: "error", text: "Недостаточно остатка для проведения",
				source: "Реализация ТМЗ и услуг: № 3 - 05.03.2026",
				ref: { endpoint: "sales", uuid: "s1", label: "№ 3" },
			});
		});
		show();
		fireEvent.click(screen.getByRole("button", { name: translate("techMsgGroupNone") }));

		// Открывают по самому представлению: оно и есть ссылка.
		const link = screen.getByRole("button", { name: "Реализация ТМЗ и услуг: № 3 - 05.03.2026" });
		expect(link.getAttribute("title")).toContain(translate("open"));
		// Вид объекта отдельной подписью не повторяется.
		expect(screen.queryByText(translate("sale"))).toBeNull();
		// И отдельной кнопки «Открыть» больше нет.
		expect(screen.queryByRole("button", { name: translate("open") })).toBeNull();
	});

	it("«Скрыть» стоит в углу строки, а род сообщения — под временем", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Сбой", source: "Базы 1С" });
		});
		show();
		const text = screen.getByText("Сбой");
		const row = text.closest("article")!;

		// Уборка строки — НЕ в теле сообщения: она закрывает строку целиком, а не относится
		// к тексту, и у длинного сообщения не должна уезжать вниз вместе с ним.
		expect(text.parentElement!.querySelector("button")).toBeNull();
		const hide = Array.from(row.querySelectorAll("button"))
			.find((b) => b.getAttribute("aria-label") === translate("hide"));
		expect(hide).toBeTruthy();

		// Род сообщения — в колонке времени, рядом с «чч:мм», и обычным словом, не капителью.
		const type = screen.getByText(translate("techMsgError"));
		expect(type.parentElement!.textContent).toMatch(/\d{2}:\d{2}/);
	});

	it("группа без актуальных сообщений свёрнута, пока её не откроют", () => {
		act(() => {
			const id = addMessage({ scope: "pane-1", type: "info", text: "Прошлое", source: "Базы 1С" });
			// Переводим в историю тем же путём, что и жизнь: запись остаётся, но не активна.
			void id;
		});
		// Делаем запись неактуальной: очистка истории её не тронет, а вид — свернёт.
		act(() => { getMessages().forEach((m) => { (m as { active: boolean }).active = false; }); });
		// Неактуальное видно только в «Истории»; в ней группа из одной истории — свёрнута.
		localStorage.setItem("tech_messages_history", "1");

		show();
		expect(screen.queryByText("Прошлое")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Базы 1С/ }));
		expect(screen.getByText("Прошлое")).toBeTruthy();
	});

	it("группировку переключают: по дате записи разных дней расходятся", () => {
		localStorage.removeItem("tech_messages_history");
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Сегодняшнее", source: "Базы 1С" });
			addMessage({ scope: "pane-1", type: "error", text: "Вчерашнее", source: "Базы 1С" });
		});
		// Состарим одну запись на сутки — так же, как её состарила бы сама жизнь.
		act(() => {
			const old = getMessages().find((m) => m.text === "Вчерашнее")!;
			(old as { firstAt: number }).firstAt = Date.now() - 24 * 60 * 60 * 1000;
		});

		// По объекту обе записи в одной группе, по дате — в двух.
		expect(groupMessages(getMessages(), "object")).toHaveLength(1);
		const byDate = groupMessages(getMessages(), "date");
		expect(byDate).toHaveLength(2);
		// Дни идут от свежего к старому: здесь спрашивают о ходе событий.
		expect(byDate[0].items[0].text).toBe("Сегодняшнее");
		// Без группировки — одна пачка: сплошная лента, свежие сверху.
		expect(groupMessages(getMessages(), "none")).toHaveLength(1);
	});

	it("«Без группировки» показывает сообщения без заголовка группы", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Сбой", source: "Базы 1С" });
		});
		show();
		expect(screen.getAllByRole("button", { name: /Базы 1С/ })).toHaveLength(1);

		fireEvent.click(screen.getByRole("button", { name: translate("techMsgGroupNone") }));
		// Заголовка больше нет — одна пачка не нуждается в имени, а текст на месте.
		expect(screen.queryByRole("button", { name: /Базы 1С/ })).toBeNull();
		expect(screen.getByText("Сбой")).toBeTruthy();
	});

	it("группа сворачивается и разворачивается по своему заголовку", () => {
		act(() => {
			addMessage({ scope: "pane-1", type: "error", text: "Агент не на связи", source: "Базы 1С" });
		});
		show();
		// Группа с актуальным сообщением раскрыта сразу: она про «сейчас».
		const head = screen.getByRole("button", { name: /Базы 1С/ });
		expect(head.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Агент не на связи")).toBeTruthy();

		fireEvent.click(head);
		expect(head.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("Агент не на связи")).toBeNull();

		fireEvent.click(head);
		expect(screen.getByText("Агент не на связи")).toBeTruthy();
	});
});

// ── Поиск и отбор по журналу ────────────────────────────────────────────────
//
// Предел журнала — 200 записей, и при десятке объектов нужное сообщение искалось глазами:
// группировка отвечает «чьё это», но не «где то, про lock-файл». Отбор «только ошибки» —
// второй частый вопрос: в момент разбора остальное мешает.

describe("Технические сообщения: поиск и отбор", () => {
	/** Подписанная витрина — как в приложении: снимок не заметил бы изменений хранилища. */
	const Live = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;
	const show = () => render(<TestWrapper><Live /></TestWrapper>);

	beforeEach(() => {
		act(() => { clearScope("pane-1"); clearNoticeHistory(APP_SCOPE); getMessages().length = 0; });
	});

	const fill = () => act(() => {
		addMessage({ scope: "pane-1", type: "error", text: "Занят рабочий каталог: lock-файл", source: "Базы 1С" });
		addMessage({ scope: "pane-1", type: "info", text: "Публикация выполнена", source: "Публикация" });
	});

	it("поиск идёт и по тексту, и по источнику", () => {
		fill();
		show();
		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lock" } });
		expect(screen.getByText(/Занят рабочий каталог/)).toBeTruthy();
		expect(screen.queryByText("Публикация выполнена")).toBeNull();

		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "публикац" } });
		expect(screen.getByText("Публикация выполнена")).toBeTruthy();
	});

	it("«только ошибки» убирает всё остальное", () => {
		fill();
		show();
		fireEvent.click(screen.getByRole("button", { name: /Только ошибки/ }));
		expect(screen.getByText(/Занят рабочий каталог/)).toBeTruthy();
		expect(screen.queryByText("Публикация выполнена")).toBeNull();
	});

	it("пустой результат отбора — это не «сообщений нет»", () => {
		// Разные ответы: один значит «сними отбор», другой — «всё в порядке».
		fill();
		show();
		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "чего-то, чего нет" } });
		expect(screen.getByText(/Ничего не нашлось/)).toBeTruthy();
	});
});
