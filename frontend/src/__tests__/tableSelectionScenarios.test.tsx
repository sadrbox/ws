/**
 * Отметки строк глазами пользователя: поиск, отбор по периоду, «выбрать все» и индикатор шапки.
 *
 * ЖИВЫЕ СЛУЧАИ (17.09), «Пользователи баз» → групповое создание, шаг «Права»:
 *  - отметил роли, нашёл поиском другие — «выбрать все» трогало невидимые роли;
 *  - галочка в шапке при поиске показывала не то, что видно в найденном;
 *  - роль, отмеченная до поиска другой, не доходила до команды: владелец строил выбор по видимым строкам,
 *    а пересев presetSelectedRows закреплял потерю.
 */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useMemo, useState } from "react";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";

const columns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const allRows: TDataItem[] = [
	{ id: 1, uuid: "r1", role: "ПолныеПрава", date: "2026-08-10" },
	{ id: 2, uuid: "r2", role: "Кассир", date: "2026-08-20" },
	{ id: 3, uuid: "r3", role: "Кладовщик", date: "2026-09-05" },
	{ id: 4, uuid: "r4", role: "Бухгалтер", date: "2026-09-15" },
	{ id: 5, uuid: "r5", role: "Аудитор", date: "2026-09-25" },
];
const SEPT = { startDate: "2026-09-01", endDate: "2026-09-30" };

/**
 * Владелец таблицы как в помощнике: выбор хранится у него (имена ролей), в таблицу возвращается пропом
 * presetSelectedRows, а из уведомления строится по второму аргументу — «строки, которые отмечены».
 */
const Owner = ({ onPicked, extra = {} }: {
	onPicked: (roles: string[]) => void;
	/** Дополнительные пропсы Table — например, удаление. */
	extra?: Record<string, unknown>;
}) => {
	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState<typeof SEPT | null>(null);
	const [roles, setRoles] = useState<Set<string>>(new Set());
	const rows = allRows
		.filter((r) => !query || String(r.role).toLowerCase().includes(query.toLowerCase()))
		.filter((r) => !period || (String(r.date) >= period.startDate && String(r.date) <= period.endDate));
	const preset = useMemo(() => new Set(allRows.filter((r) => roles.has(String(r.role))).map((r) => Number(r.id))), [roles]);
	const base = buildStaticTableProps({
		componentName: "TestSelectionScenarios", rows, columns: columns(), setColumns: () => {},
		search: { value: query, onChange: setQuery },
		selectable: true, disableActiveRow: true,
		presetSelectedRows: preset,
		onSelectionChange: (sel, all) => {
			const next = all.filter((r) => sel.has(Number(r.id))).map((r) => String(r.role));
			onPicked([...next].sort());
			setRoles(new Set(next));
		},
	});
	return (
		<>
			{["Аудитор", "Кассир", "Бух", ""].map((q) => (
				<button key={q || "clear"} type="button" data-testid={`q:${q}`} onClick={() => setQuery(q)}>{q || "сброс"}</button>
			))}
			<button type="button" data-testid="period:sept" onClick={() => setPeriod(SEPT)}>сентябрь</button>
			<button type="button" data-testid="period:none" onClick={() => setPeriod(null)}>без периода</button>
			<Table {...base} {...extra} filtering={{
				// dateRange — объект периода, а не {value, operator}: так его кладёт и useModelListState.
				filters: (period ? { dateRange: period } : undefined) as unknown as Record<string, { value: unknown; operator: string }> | undefined,
				onFilterChange: () => {}, onClearAll: () => {},
			}} />
		</>
	);
};

const setup = (extra?: Record<string, unknown>) => {
	let picked: string[] = [];
	const utils = render(<TestWrapper><Owner onPicked={(r) => { picked = r; }} extra={extra} /></TestWrapper>);
	const q = (text: string) => fireEvent.click(utils.getByTestId(`q:${text}`));
	const boxes = () => Array.from(utils.container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'));
	const head = () => utils.container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
	const headState = () => (head().indeterminate ? "частично" : head().checked ? "все" : "пусто");
	const clickRow = (role: string) => {
		const i = Array.from(utils.container.querySelectorAll("tbody tr")).findIndex((tr) => tr.textContent?.includes(role));
		fireEvent.click(boxes()[i]);
	};
	return { ...utils, q, boxes, head, headState, clickRow, picked: () => picked };
};

describe("Отметки и быстрый поиск", () => {
	it("роль, отмеченная до поиска другой, доходит до выбора владельца", () => {
		const t = setup();
		t.q("Аудитор"); t.clickRow("Аудитор");
		t.q("Кассир"); t.clickRow("Кассир");
		expect(t.picked()).toEqual(["Аудитор", "Кассир"]);
		t.q("");
		expect(t.picked()).toEqual(["Аудитор", "Кассир"]);
		expect(t.boxes().filter((b) => b.checked)).toHaveLength(2);
	});

	it("«выбрать все» при поиске не трогает отмеченное вне найденного", () => {
		const t = setup();
		t.clickRow("ПолныеПрава");
		t.q("Бух");
		t.head().click();
		expect(t.picked()).toEqual(["Бухгалтер", "ПолныеПрава"]);
		t.head().click();
		expect(t.picked()).toEqual(["ПолныеПрава"]);
	});

	it("индикатор шапки говорит о найденном, а не обо всех отметках", () => {
		const t = setup();
		t.clickRow("ПолныеПрава");
		expect(t.headState()).toBe("частично");
		t.q("Аудитор");
		expect(t.headState()).toBe("пусто");
		t.head().click();
		expect(t.headState()).toBe("все");
		t.head().click();
		expect(t.headState()).toBe("пусто");
		t.q("");
		expect(t.headState()).toBe("частично");
	});

	it("«выбрать все» без поиска, затем поиск и снятие найденного — остальное остаётся", () => {
		const t = setup();
		t.head().click();
		expect(t.picked()).toHaveLength(5);
		t.q("Кассир");
		expect(t.headState()).toBe("все");
		expect(t.picked()).toHaveLength(5);
		t.head().click();
		expect(t.headState()).toBe("пусто");
		expect(t.picked()).toEqual(["Аудитор", "Бухгалтер", "Кладовщик", "ПолныеПрава"]);
		t.q("");
		expect(t.headState()).toBe("частично");
		expect(t.boxes().filter((b) => b.checked)).toHaveLength(4);
	});

	it("снятие отметки при поиске после «выбрать все» не схлопывает выбор", () => {
		const t = setup();
		t.head().click();
		t.q("Аудитор");
		t.clickRow("Аудитор");
		expect(t.picked()).toEqual(["Бухгалтер", "Кассир", "Кладовщик", "ПолныеПрава"]);
	});
});

describe("Отметки и отбор по периоду", () => {
	it("отмеченное вне периода остаётся, шапка — по строкам периода", () => {
		const t = setup();
		t.clickRow("Кассир"); // август
		fireEvent.click(t.getByTestId("period:sept"));
		expect(t.boxes()).toHaveLength(3);
		expect(t.headState()).toBe("пусто");
		t.head().click();
		expect(t.picked()).toEqual(["Аудитор", "Бухгалтер", "Кассир", "Кладовщик"]);
		fireEvent.click(t.getByTestId("period:none"));
		expect(t.boxes().filter((b) => b.checked)).toHaveLength(4);
		expect(t.headState()).toBe("частично");
	});

	it("отметка всех строк периода по одной не выбирает весь список", () => {
		const t = setup();
		fireEvent.click(t.getByTestId("period:sept"));
		for (const role of ["Кладовщик", "Бухгалтер", "Аудитор"]) t.clickRow(role);
		expect(t.headState()).toBe("все");
		fireEvent.click(t.getByTestId("period:none"));
		expect(t.picked()).toEqual(["Аудитор", "Бухгалтер", "Кладовщик"]);
		expect(t.headState()).toBe("частично");
	});

	it("поиск внутри периода: «выбрать все» — только найденное в периоде", () => {
		const t = setup();
		fireEvent.click(t.getByTestId("period:sept"));
		t.q("Бух");
		t.head().click();
		fireEvent.click(t.getByTestId("period:none"));
		t.q("");
		expect(t.picked()).toEqual(["Бухгалтер"]);
	});
});

describe("Без поиска и отбора — прежнее поведение", () => {
	it("отметка всех строк по одной — в шапке «все»; щелчок по шапке снимает всё", () => {
		const t = setup();
		for (const r of allRows) t.clickRow(String(r.role));
		expect(t.headState()).toBe("все");
		t.head().click();
		expect(t.picked()).toEqual([]);
		expect(t.headState()).toBe("пусто");
	});
});

describe("Удаление при поиске", () => {
	it("удаляется только видимое отмеченное; скрытое поиском не трогается", async () => {
		const onDelete = vi.fn((ids: Set<number>) => Promise.resolve({ deletedIds: ids }));
		const t = setup({ onDelete, readonly: false, hideAddDelete: false });
		t.clickRow("ПолныеПрава");
		t.q("Бух");
		const del = () => Array.from(t.container.querySelectorAll("button")).find((b) => b.textContent === "Удалить")!;
		// Отмечено только скрытое — удалять нечего.
		expect(del().disabled).toBe(true);
		t.clickRow("Бухгалтер");
		expect(del().disabled).toBe(false);
		fireEvent.click(del());
		await Promise.resolve();
		expect([...(onDelete.mock.calls[0][0])]).toEqual([4]);
	});
});
