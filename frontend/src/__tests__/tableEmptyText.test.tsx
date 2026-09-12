/**
 * Пустая таблица объясняет, почему она пуста.
 *
 * ЗАЧЕМ. «Расширений у базы нет» и «их ещё никто не читал» выглядят одинаково — пустой
 * таблицей, — а требуют разного: второе требует действия человека. Раньше это объяснение
 * уходило в «Технические сообщения» и висело там, пока открыта карточка: убрать его было
 * нельзя (форма сообщала его заново), и список сообщений выглядел незакрывающимся.
 *
 * Место объяснения — там, где человек ищет данные.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";

const columns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const show = (rows: TDataItem[], emptyText?: string) => render(
	<TestWrapper>
		<Table {...buildStaticTableProps({
			componentName: "TestEmptyTable", rows, columns: columns(), setColumns: () => {},
			...(emptyText ? { emptyText } : {}),
		})} />
	</TestWrapper>,
);

describe("Table: пустое состояние", () => {
	it("объяснение видно там, где искали данные", () => {
		show([], "Расширения этой базы ещё не читались у 1С");
		expect(screen.getByText("Расширения этой базы ещё не читались у 1С")).toBeTruthy();
	});

	it("без объяснения таблица молчит, как и раньше", () => {
		const { container } = show([]);
		expect(container.querySelector("tbody")?.textContent?.trim()).toBe("");
	});

	it("при данных объяснение не показывается: оно про пустоту", () => {
		show([{ id: 1, uuid: "a", name: "Расширение" }], "Расширения ещё не читались");
		expect(screen.queryByText("Расширения ещё не читались")).toBeNull();
		expect(screen.getByText("Расширение")).toBeTruthy();
	});
});
