import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import MessagesView from "src/components/TechMessages/MessagesView";
import TechMessages from "src/components/TechMessages/TechMessages";
import {
	APP_SCOPE, clearNoticeHistory, setTechMessagesOpen, useScopedNotices,
} from "src/components/TechMessages/store";
import {
	abandonOp, attachBatch, finishOp, getOps, mergeBatch, progressOp, startOp,
} from "src/models/OneCAdmin/progress";
import { translate } from "src/i18";
import { TestWrapper } from "./utils/TestWrapper";

// «Прогресс запросов и команд» В ОБЛАСТИ СООБЩЕНИЙ.
//
// Область отвечает на вопрос «что происходит», и до сих пор отвечала только про уже
// случившееся. Идущая работа была видна лишь на вкладке экрана «Пользователи баз»: ушёл с
// экрана — и проверка сотни баз стала невидимой, хотя она никуда не делась.
//
// Договорённости, которые тест держит:
//   1) работы нет — секции нет: пустое «операций: 0» отнимало бы место у сообщений;
//   2) известен объём работы — полоса с процентом, и процент считается от сделанного;
//   3) объём неизвестен — неопределённый индикатор, а не полоса, застывшая на нуле;
//   4) запись убирается со списка, ничего не останавливая на сервере.

describe("Технические сообщения: прогресс запросов и команд", () => {
	beforeEach(() => {
		act(() => { getOps().slice().forEach((o) => abandonOp(o.id)); });
		localStorage.setItem("tech_messages_group", "object");
	});

	const Live = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;
	const show = () => render(<TestWrapper><Live /></TestWrapper>);

	it("работы нет — секции прогресса нет", () => {
		show();
		expect(screen.queryByText(translate("techMsgProgress"))).toBeNull();
	});

	it("известен объём — полоса показывает долю сделанного", () => {
		act(() => {
			const id = startOp({ kind: "read", title: "Проверить пользователей", target: "базы: 4", total: 4 });
			progressOp(id, 1);
		});
		show();
		expect(screen.getByText(translate("techMsgProgress"))).toBeTruthy();
		expect(screen.getByText(/Проверить пользователей/)).toBeTruthy();

		const bar = screen.getByRole("progressbar");
		expect(bar.getAttribute("aria-valuenow")).toBe("25");
		// Цифры рядом с полосой: доля словами и процентом — «1 из 4 · 25%».
		expect(screen.getByText(new RegExp(`1 ${translate("onecOpOutOf")} 4`))).toBeTruthy();

		act(() => { progressOp(getOps()[0].id, 3); });
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("75");
	});

	it("работа по ОДНОЙ базе тоже показывает полосу, а не спиннер", () => {
		// Пробовали наоборот — спиннер при total=1: он отвечает только «идёт», и в одном
		// списке оказывались два разных индикатора одной и той же работы. Полоса отвечает
		// и «сколько сделано», поэтому она у любой работы с известным объёмом.
		act(() => { startOp({ kind: "update", title: "Записать права", target: "almaz67", total: 1 }); });
		show();
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");

		act(() => { progressOp(getOps()[0].id, 1); });
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
	});

	it("объём неизвестен — индикатор без процента, а не полоса на нуле", () => {
		act(() => { startOp({ kind: "update", title: "Записать права", target: "almaz67", total: 0 }); });
		show();
		// Полосы нет: доли не существует, и рисовать «0 %» значило бы врать о работе.
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.getByText(/Записать права/)).toBeTruthy();
	});

	it("завершённая операция остаётся видна и убирается по кнопке", () => {
		act(() => {
			const id = startOp({ kind: "read", title: "Проверить пользователей", target: "базы: 2", total: 2 });
			finishOp(id);
		});
		// Завершённая операция — история (T6): её строка видна с включённой «Историей».
		localStorage.setItem("tech_messages_history", "1");
		show();
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
		expect(screen.getByText(translate("onecOpDone"))).toBeTruthy();

		const hide = screen.getAllByRole("button")
			.find((b) => b.getAttribute("aria-label") === translate("hide"));
		fireEvent.click(hide!);
		expect(getOps()).toHaveLength(0);
		/*
		 * Секции больше нет: наблюдать нечего. Запись о самой работе при этом не пропадает
		 * бесследно — её итог остаётся СОБЫТИЕМ в журнале (noteOutcome), и именно поэтому
		 * здесь проверяется исчезновение полосы и секции, а не любого упоминания операции.
		 */
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.queryByText(translate("techMsgProgress"))).toBeNull();
	});

	it("итог не дублирует строку операции, пока она видна", () => {
		localStorage.setItem("tech_messages_group", "none");
		// Итог — история: без включённой «Истории» его не было бы видно и после снятия операции.
		localStorage.setItem("tech_messages_history", "1");
		let id = "";
		act(() => { id = startOp({ kind: "update", title: "Изменить пользователя", target: "Оператор — _transition", total: 1 }); finishOp(id); });
		show();
		expect(screen.getByText("Изменить пользователя")).toBeTruthy();
		expect(screen.queryByText(/^Изменить пользователя\. /)).toBeNull();
		act(() => { abandonOp(id); });
		expect(screen.getByText(/^Изменить пользователя\. /)).toBeTruthy();
	});

	it("провалившаяся команда по одной базе не выглядит выполненной", () => {
		/*
		 * ЖИВОЙ СЛУЧАЙ. «Изменить пользователя · 1 из 1 · 100% · Не удалось: 1» — строка
		 * спорила сама с собой: полоса говорила «сделано всё», подпись — «не вышло ничего».
		 * Считать надо удавшееся, а у единственной команды число отказов лишнее: это просто
		 * «Не выполнено».
		 */
		act(() => {
			const id = startOp({ kind: "update", title: "Изменить пользователя", target: "Оператор — _transition", total: 1 });
			finishOp(id, { failed: 1, note: "добавляемые роли: слишком длинный список — не больше 2000" });
		});
		show();
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
		expect(screen.getByText(translate("onecOpFinishedFailed"))).toBeTruthy();
		expect(screen.queryByText(`${translate("onecOpFailedCount")}: 1`)).toBeNull();
		// Причина видна там же, словами, а не кодом библиотеки.
		expect(screen.getByText(/слишком длинный список/)).toBeTruthy();
	});

	it("состояние задания переносится в строку: отказ виден и цифрами, и состоянием", () => {
		act(() => {
			const id = startOp({ kind: "update", title: "Записать права", target: "базы: 3", total: 3 });
			attachBatch(id, "b1", 3);
			mergeBatch({
				id: "b1", total: 3, done: 2, failed: 1, pending: 0, cancelable: 0,
				items: [{ baseKey: "almaz67", error: { message: "нет связи" } }],
			} as unknown as Parameters<typeof mergeBatch>[0]);
		});
		show();
		/*
		 * Полоса считает УДАВШЕЕСЯ: две базы из трёх — 67 %, а не «всё сделано». Раньше в
		 * счёт шли и отказавшие, и провалившаяся работа выглядела заполненной до конца:
		 * «1 из 1 · 100%» стояло рядом с «Не удалось: 1».
		 */
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("67");
		// Баз несколько — сказано, сколько именно не прошло.
		expect(screen.getByText(`${translate("onecOpFailedCount")}: 1`)).toBeTruthy();
		// Причина отказа названа поимённо: «где встало» — половина ответа.
		expect(screen.getByText(/almaz67: нет связи/)).toBeTruthy();
	});

	it("«Без группировки» — операции без заголовка секции, но видны", () => {
		// Сплошная лента не должна держать единственный заголовок — у «Прогресса».
		localStorage.setItem("tech_messages_group", "none");
		// Название своё: итоги операций прошлых проверок лежат в журнале, и в сплошной ленте
		// они раскрыты — общее название нашлось бы дважды.
		act(() => { startOp({ kind: "read", title: "Сверить ленту", target: "базы: 2", total: 2 }); });
		show();
		expect(screen.queryByText(translate("techMsgProgress"))).toBeNull();
		expect(screen.getByText(/Сверить ленту/)).toBeTruthy();
		expect(screen.getByRole("progressbar")).toBeTruthy();
	});
});

describe("Технические сообщения: очистка убирает и завершённые операции", () => {
	beforeEach(() => {
		act(() => {
			getOps().slice().forEach((o) => abandonOp(o.id));
			clearNoticeHistory(APP_SCOPE);
			setTechMessagesOpen(true);
		});
		localStorage.setItem("tech_messages_all", "1");
	});

	const clearButton = () => screen.getByRole("button", { name: new RegExp(translate("techMessagesHistoryClear")) });

	it("завершённая уходит, идущая остаётся", () => {
		act(() => {
			finishOp(startOp({ kind: "read", title: "Законченная проверка", target: "b1", total: 1 }));
			startOp({ kind: "update", title: "Идущая запись", target: "b2", total: 1 });
		});
		// Итог законченной операции уже лёг событием в журнал — его уберёт та же очистка.
		clearNoticeHistory(APP_SCOPE);
		render(<TestWrapper><TechMessages /></TestWrapper>);

		// Сообщений нет, но есть завершённая операция — чистить есть что, кнопка активна.
		expect((clearButton() as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(clearButton());

		expect(getOps().map((o) => o.title)).toEqual(["Идущая запись"]);
		expect(screen.queryByText(/Законченная проверка/)).toBeNull();
		expect(screen.getByText(/Идущая запись/)).toBeTruthy();
		// Осталась только идущая работа — убирать нечего.
		expect((clearButton() as HTMLButtonElement).disabled).toBe(true);
	});
});

// ── Завершённые операции — в истории (аудит 14.09, T6) ─────────────────────
//
// Сообщения закрытых форм уходили в историю сами, а завершённые операции висели в «Прогрессе»,
// пока их не уберут руками. Теперь без «Истории» видна только идущая работа.
describe("Технические сообщения: завершённые операции — история", () => {
	/** Подписанная витрина: хук хранилища — внутри компонента. */
	const Board = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;

	beforeEach(() => {
		act(() => { getOps().slice().forEach((o) => abandonOp(o.id)); });
		localStorage.setItem("tech_messages_group", "object");
		localStorage.removeItem("tech_messages_history");
	});

	it("без «Истории» завершённая скрыта, идущая видна; число — на кнопке «История»", () => {
		act(() => {
			finishOp(startOp({ kind: "read", title: "Завершённая проверка", target: "базы: 1", total: 1 }));
			startOp({ kind: "read", title: "Идущая проверка", target: "базы: 1", total: 1 });
		});
		render(<TestWrapper><Board /></TestWrapper>);
		expect(screen.queryByText("Завершённая проверка")).toBeNull();
		expect(screen.getByText("Идущая проверка")).toBeTruthy();
		const history = screen.getByRole("button", { name: new RegExp(`^${translate("techMsgHistory")}\\s*1$`) });
		fireEvent.click(history);
		expect(screen.getByText("Завершённая проверка")).toBeTruthy();
	});
});
