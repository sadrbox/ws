// Сырые <table> экранов — на SubTableSheets (28.09): «Обслуживание» базы 1С (итоги шагов), «Контроль удалённых ссылок»,
// протокол «Поиска и замены ссылок», табличный вид дашборда показателей. Держим то, ради чего переводили: заголовки
// из словаря, текст ячейки — единственным <span> в TableBodyCell (на нём отступ и многоточие), и поведение экранов —
// «Открыть»/«н/д», «—» вместо отказа, числа как числа (сортировка) в прежнем виде.
import { render, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, afterEach, vi } from "vitest";
import SubTableSheets from "src/components/SubTableSheets";
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import { apiClient } from "src/services/api/client";
import { SELF_CHECK_COLUMNS, SELFTEST_COLUMNS, selfCheckRows, selftestRows } from "src/models/OneCBases/stepResultsView";
import { StepResultsSheet } from "src/models/OneCBases/StepResultsSheet";
import { OrphanGroupBlock } from "src/models/OrphanRefs";
import { ProtocolBlock } from "src/models/SearchReplaceRefs";
import { UserPerformanceList } from "src/models/UserPerformance";
import { managerColumns, managerTableRows, perfCellText, userColumns, userTableRows } from "src/models/UserPerformance/tables";
import { fmtValue } from "src/models/UserPerformance/format";
import onecStyles from "src/models/OneCAdmin/OneCAdmin.module.scss";

// Все блоки дашборда доступны: проверяется таблица, а не права.
vi.mock("src/hooks/useAccessPermission", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/hooks/useAccessPermission")>()),
	useAccessPermission: () => ({ accessLevel: "full", canRead: true, canWrite: true }),
}));
// Графики (Recharts) в jsdom не нужны: дашборд тут же переключается в табличный вид.
vi.mock("src/models/UserPerformance/charts", () => ({ CategoryBars: () => null, TaskStackBars: () => null }));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** Заголовки таблицы — как их видит пользователь. */
const headers = (root: HTMLElement) => [...root.querySelectorAll("thead th")].map((th) => th.textContent ?? "");

/** Содержимое ячеек тела без пустых текстовых узлов; строка-заполнитель пропускается. */
const bodyCells = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>('tbody td > [class*="TableBodyCell"]')];

/** Ячейка с этим текстом: единственный дочерний узел — span, и текст целиком в нём. */
const expectSingleSpan = (root: HTMLElement, text: string) => {
	const cell = bodyCells(root).find((c) => c.textContent === text);
	expect(cell, `ячейка «${text}»`).toBeTruthy();
	const kids = [...cell!.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
	expect(kids).toHaveLength(1);
	expect((kids[0] as HTMLElement).tagName).toBe("SPAN");
	return kids[0] as HTMLElement;
};

/** Текст ячеек колонки по порядку строк. */
const columnTexts = (root: HTMLElement, colIndex: number) =>
	[...root.querySelectorAll("tbody tr")]
		.filter((tr) => tr.children.length > 1)
		.map((tr) => tr.children[colIndex]?.textContent ?? "");

describe("«Обслуживание» базы 1С: итоги шагов", () => {
	it("проверка BuhProf: ok → «успешно», отказ → «не удалось», без признака → «—»; подробность с подсказкой", () => {
		const rows = selfCheckRows({
			checks: [
				{ title: "Токен сервиса", ok: true },
				{ title: "Права", ok: false, detail: "нет роли", hint: "выдайте роль" },
				{ title: "Версия расширения" },
			],
		});
		expect(rows.map((r) => [r.onecSelfCheckStep, r.onecSelftestResult, r.__ok])).toEqual([
			["Токен сервиса", translate("onecSelftestOk"), true],
			["Права", translate("onecSelftestFail"), false],
			["Версия расширения", "—", null],
		]);
		expect(rows[1].onecSelfCheckDetail).toBe("нет роли · выдайте роль");
		// Устойчивые и разные номера строк: на них держатся ключи и активная строка таблицы.
		expect(new Set(rows.map((r) => r.id)).size).toBe(3);
		expect(selfCheckRows(null)).toEqual([]);
	});

	it("самопроверка агента: шаг без признака — неудача, как и в тосте", () => {
		const rows = selftestRows({ ok: false, steps: [{ name: "Вход", ok: true }, { name: "Запись", ok: false, note: "нет прав" }] });
		expect(rows.map((r) => [r.onecSelftestStep, r.onecSelftestResult, r.onecSelftestNote])).toEqual([
			["Вход", translate("onecSelftestOk"), ""],
			["Запись", translate("onecSelftestFail"), "нет прав"],
		]);
		expect(selftestRows(null)).toEqual([]);
	});

	it("таблица: заголовки из словаря, отказ — тоном ошибки, «—» и успех — без тона, текст — одним span", () => {
		const rows = selfCheckRows({ checks: [{ title: "Токен", ok: true }, { title: "Права", ok: false, detail: "нет роли" }, { title: "Версия" }] });
		const { container } = render(<StepResultsSheet columns={SELF_CHECK_COLUMNS} rows={rows} />);
		expect(headers(container)).toEqual([translate("onecSelfCheckStep"), translate("onecSelftestResult"), translate("onecSelfCheckDetail")]);
		expect(expectSingleSpan(container, translate("onecSelftestFail"))).toHaveClass(onecStyles.ReqBad);
		expect(expectSingleSpan(container, translate("onecSelftestOk"))).not.toHaveClass(onecStyles.ReqBad);
		expect(expectSingleSpan(container, "—")).not.toHaveClass(onecStyles.ReqBad);
		expectSingleSpan(container, "Токен");
		expectSingleSpan(container, "нет роли");
	});

	it("самопроверка агента: свои заголовки; без шагов — «Нет данных», а не пустая шапка", () => {
		const { container } = render(<StepResultsSheet columns={SELFTEST_COLUMNS} rows={selftestRows({ ok: true, steps: [{ name: "Вход", ok: true }] })} />);
		expect(headers(container)).toEqual([translate("onecSelftestStep"), translate("onecSelftestResult"), translate("onecSelftestNote")]);
		cleanup();
		render(<StepResultsSheet columns={SELFTEST_COLUMNS} rows={selftestRows({ ok: true, steps: [] })} />);
		expect(screen.getByText(translate("noData"))).toBeInTheDocument();
	});
});

describe("«Контроль удалённых ссылок»: записи группы", () => {
	const group = (table: string) => ({
		table, column: "counterpartyUuid", columnLabel: "Контрагент", tableLabel: "Продажи",
		refTable: "counterparties", refTableLabel: "Контрагенты", totalFound: 2, hasMore: false,
		records: [
			{ uuid: "u-1", id: 17, label: "Реализация № 5", refUuid: "r-1", refLabel: "ТОО Ромашка", refDeletedAt: "2026-09-20T10:00:00.000Z" },
			{ uuid: "u-2", id: 18, label: "", refUuid: "r-2", refLabel: "", refDeletedAt: "" },
		],
	});

	it("статичные заголовки из словаря, пустой — у кнопки; дата — общим форматом, без даты — «—»", () => {
		const { container } = render(<OrphanGroupBlock group={group("sales")} onOpen={() => { }} opening={null} />);
		expect(headers(container)).toEqual([translate("orphanRecord"), translate("orphanDeletedValue"), translate("deleted"), ""]);
		expect(columnTexts(container, 2)).toEqual([getFormatDateOnly("2026-09-20T10:00:00.000Z"), "—"]);
		expectSingleSpan(container, getFormatDateOnly("2026-09-20T10:00:00.000Z"));
		expectSingleSpan(container, "—");
		// Запись с номером — одним span; без подписи — uuid. Удалённое значение зачёркнуто.
		expectSingleSpan(container, "Реализация № 5#17");
		expectSingleSpan(container, "u-2#18");
		expect(expectSingleSpan(container, "ТОО Ромашка").style.textDecoration).toBe("line-through");
		expectSingleSpan(container, "r-2");
	});

	it("«Открыть» отдаёт таблицу, uuid и подпись записи", () => {
		const onOpen = vi.fn();
		render(<OrphanGroupBlock group={group("sales")} onOpen={onOpen} opening={null} />);
		const buttons = screen.getAllByRole("button", { name: translate("open") });
		expect(buttons).toHaveLength(2);
		fireEvent.click(buttons[0]);
		expect(onOpen).toHaveBeenCalledWith("sales", "u-1", "Реализация № 5");
	});

	it("открываемая запись — «…» и кнопка недоступна; таблица без формы — «н/д» без кнопки", () => {
		const { unmount } = render(<OrphanGroupBlock group={group("sales")} onOpen={() => { }} opening="u-2" />);
		expect(screen.getByRole("button", { name: "…" })).toBeDisabled();
		unmount();
		const { container } = render(<OrphanGroupBlock group={group("no_form_table")} onOpen={() => { }} opening={null} />);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(columnTexts(container, 3)).toEqual(["н/д", "н/д"]);
		expect(bodyCells(container).filter((c) => c.textContent === "н/д").every((c) => c.firstElementChild?.tagName === "SPAN")).toBe(true);
	});
});

describe("«Поиск и замена ссылок»: протокол", () => {
	const summary = {
		modelLabel: "Контрагенты", sourceLabel: "Старый", sourceIsDeleted: false,
		targetLabel: "Новый", totalAffected: 7, executedAt: "2026-09-28T09:00:00.000Z",
	};

	it("заголовки из словаря; строки без обновлений не показываются; «+N» — одним span", () => {
		const { container } = render(<ProtocolBlock summary={summary} entries={[
			{ table: "sales", column: "counterpartyUuid", label: "Продажи", affected: 5 },
			{ table: "contracts", column: "counterpartyUuid", label: "Договоры", affected: 0 },
			{ table: "purchases", column: "counterpartyUuid", label: "Покупки", affected: 2 },
		]} />);
		expect(headers(container)).toEqual([translate("where"), translate("tableCol"), translate("refReplaceAffected")]);
		expect(columnTexts(container, 0)).toEqual(["Продажи", "Покупки"]);
		expectSingleSpan(container, "Продажи");
		expectSingleSpan(container, "sales.counterpartyUuid");
		expectSingleSpan(container, "+5");
		expectSingleSpan(container, "+2");
	});

	it("сортировка по «Обновлено» — по числу", () => {
		const { container } = render(<ProtocolBlock summary={summary} entries={[
			{ table: "a", column: "x", label: "Десять", affected: 10 },
			{ table: "b", column: "x", label: "Девять", affected: 9 },
		]} />);
		fireEvent.click(screen.getByText(translate("refReplaceAffected")));
		expect(columnTexts(container, 2)).toEqual(["+9", "+10"]);
	});

	it("ни одной обновлённой таблицы — только сводка, без таблицы", () => {
		const { container } = render(<ProtocolBlock summary={{ ...summary, totalAffected: 0 }} entries={[
			{ table: "a", column: "x", label: "Пусто", affected: 0 },
		]} />);
		expect(container.querySelector("table")).toBeNull();
	});
});

describe("Дашборд показателей: табличный вид", () => {
	const managers = [
		{ managerUuid: "m1", managerName: "Айгуль", salesCount: 12, netRevenue: 950, grossProfit: 300 },
		{ managerUuid: "m2", managerName: "Бахыт", salesCount: 3, netRevenue: 1_500_000, grossProfit: 12_000 },
	];
	const users = [
		{ userUuid: "u1", userName: "Иван", docs: 4, tasksTotal: 5, tasksDone: 3, tasksActive: 1, tasksOverdue: 1, requests: 2, reminders: 0, returned: 1, resultShare: 50, reactionMinutesAvg: 125, ratingAvg: 4.5 },
		{ userUuid: "u2", userName: "Мария", docs: 1, tasksTotal: 0, tasksDone: 0, tasksActive: 0, tasksOverdue: 0, resultShare: null, reactionMinutesAvg: null, ratingAvg: null },
	];

	it("значения — числами, вид — прежними fmtValue/fmtMaybe; нет данных — «—», а не ноль", () => {
		const mRows = managerTableRows(managers);
		expect(mRows[1]).toMatchObject({ perfManager: "Бахыт", perfRevenue: 1_500_000, perfGrossProfit: 12_000, perfSalesCount: 3 });
		const cols = Object.fromEntries(managerColumns().map((c) => [c.identifier, c]));
		expect(perfCellText(mRows[1], cols.perfRevenue)).toBe(fmtValue(1_500_000, "money"));
		expect(perfCellText(mRows[1], cols.perfSalesCount)).toBe(3);
		expect(perfCellText(mRows[1], cols.perfManager)).toBeUndefined();

		const uRows = userTableRows(users);
		const ucols = Object.fromEntries(userColumns().map((c) => [c.identifier, c]));
		expect(uRows[1].perfResultShare).toBeNull();
		expect(perfCellText(uRows[0], ucols.perfResultShare)).toBe(fmtValue(50, "percent"));
		expect(perfCellText(uRows[0], ucols.perfReaction)).toBe(fmtValue(125, "minutes"));
		expect(perfCellText(uRows[0], ucols.perfRating)).toBe(fmtValue(4.5, "rating"));
		expect(perfCellText(uRows[1], ucols.perfResultShare)).toBe("—");
		expect(perfCellText(uRows[1], ucols.perfRequests)).toBe(0);
	});

	it("подсказки колонок качества — в title заголовка, готовым текстом", () => {
		const { container } = render(<SubTableSheets columns={userColumns()} rows={userTableRows(users)} renderCell={perfCellText} />);
		const th = [...container.querySelectorAll("thead th")].find((t) => t.textContent === translate("perfResultShare"));
		expect(th).toHaveAttribute("title", translate("perfBlockResultShareSub"));
		const plain = [...container.querySelectorAll("thead th")].find((t) => t.textContent === translate("perfUser"));
		expect(plain).not.toHaveAttribute("title");
	});

	it("экран: две таблицы с подписями, заголовки из словаря, числа — одним span справа, сортировка по числу", async () => {
		vi.spyOn(apiClient, "get").mockImplementation((url: string) => Promise.resolve({
			data: url.includes("sales-by-manager")
				? { items: managers, totals: { netRevenue: 1_500_950, grossProfit: 12_300, salesCount: 15 } }
				: { items: users },
		}) as never);
		const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(<QueryClientProvider client={qc}><UserPerformanceList /></QueryClientProvider>);
		fireEvent.click(screen.getByRole("button", { name: /Таблица/ }));

		const managersCard = (await screen.findByRole("heading", { name: translate("perfByManagers") })).closest("section")!;
		const usersCard = screen.getByRole("heading", { name: translate("perfByUsers") }).closest("section")!;
		await waitFor(() => expect(within(managersCard).getByText("Бахыт")).toBeInTheDocument());
		await waitFor(() => expect(within(usersCard).getByText("Мария")).toBeInTheDocument());

		expect(headers(managersCard)).toEqual([translate("perfManager"), translate("perfRevenue"), translate("perfGrossProfit"), translate("perfSalesCount")]);
		expect(headers(usersCard)).toContain(translate("perfReaction"));
		expect(headers(usersCard)).toHaveLength(11);

		const revenue = expectSingleSpan(managersCard, fmtValue(1_500_000, "money"));
		expect(revenue.parentElement?.className).toMatch(/JustifyRight/);
		expectSingleSpan(managersCard, "12");
		expectSingleSpan(usersCard, fmtValue(125, "minutes"));

		// По выручке: 950 ₸ меньше 1,5 млн ₸ — сравниваются числа, а не подписи.
		fireEvent.click(within(managersCard).getByText(translate("perfRevenue")));
		expect(columnTexts(managersCard, 0)).toEqual(["Айгуль", "Бахыт"]);
		fireEvent.click(within(managersCard).getByText(translate("perfRevenue")));
		expect(columnTexts(managersCard, 0)).toEqual(["Бахыт", "Айгуль"]);
	});
});
