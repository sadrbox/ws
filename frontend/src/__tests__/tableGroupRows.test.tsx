/**
 * `<Table />`: групповая строка и её вложенные строки.
 *
 * Тест держит три договорённости, каждая из которых уже ломалась:
 *   1) вложенная строка — ТА ЖЕ строка таблицы (столько же ячеек, класс ExpandedRow,
 *      без data-row-id, потому что идентификаторы у потомков свои);
 *   2) отметка группы отражает вложенные: все — полная, часть — промежуточная;
 *   3) раскрытие живёт на шевроне, а не на активной строке; при disableActiveRow
 *      щелчок по строке вообще не делает её активной.
 *
 * jsdom не считает раскладку, поэтому проверяем разметку и состояние, а не пиксели.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Table from "src/components/Table";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { TestWrapper } from "./utils/TestWrapper";

const columns = (): TColumn[] => ([
  { identifier: "name", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
  { identifier: "note", type: "string", width: "200px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const rows: TDataItem[] = [
  { id: 1, uuid: "role-a", name: "Роль A", note: "" },
  { id: 2, uuid: "role-b", name: "Роль B", note: "" },
];

/** Дети роли A: две базы, отмечена одна — значит у группы промежуточное состояние. */
const childrenOf = (r: TDataItem): TDataItem[] => (
  r.uuid === "role-a"
    ? [
      { id: -1, uuid: "role-a|BASE1", name: "BASE1", note: "ТОО «Альфа»", __selected: true },
      { id: -2, uuid: "role-a|BASE2", name: "BASE2", note: "ТОО «Бета»", __selected: false },
    ]
    : []
);

function renderTable(props: Partial<Parameters<typeof buildStaticTableProps>[0]> = {}) {
  const base = buildStaticTableProps({
    componentName: "TestGroupTable",
    rows,
    columns: columns(),
    setColumns: () => { },
    selectable: true,
    childRows: childrenOf,
    expandedRowIds: new Set(["role-a"]),
    disableActiveRow: true,
    ...props,
  });
  return render(<TestWrapper><Table {...base} /></TestWrapper>);
}

const bodyRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("tbody tr")).filter((tr) => tr.querySelector("td[data-col-id]"));

describe("Table: групповая строка и вложенные", () => {
  it("вложенная строка — та же строка таблицы: столько же ячеек, класс ExpandedRow, без data-row-id", () => {
    const { container } = renderTable();
    const trs = bodyRows(container);
    const group = trs.find((tr) => tr.getAttribute("data-row-id") === "1")!;
    const child = trs.find((tr) => tr.getAttribute("data-child") === "true")!;

    expect(group).toBeTruthy();
    expect(child).toBeTruthy();
    expect(child.className).toMatch(/ExpandedRow/);
    expect(child.getAttribute("data-row-id")).toBeNull();
    expect(child.querySelectorAll("td").length).toBe(group.querySelectorAll("td").length);
  });

  it("раскрытая строка помечена как заголовок группы", () => {
    const { container } = renderTable();
    const group = bodyRows(container).find((tr) => tr.getAttribute("data-row-id") === "1")!;
    expect(group.className).toMatch(/GroupHeaderRow/);
  });

  it("отметка группы промежуточная, когда отмечена часть вложенных", () => {
    const { container } = renderTable();
    const group = bodyRows(container).find((tr) => tr.getAttribute("data-row-id") === "1")!;
    const box = group.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(true);
  });

  it("щелчок по отметке группы доводит вложенные до общего состояния", () => {
    const onChildToggle = vi.fn<(parent: TDataItem, child: TDataItem, next: boolean) => void>();
    const { container } = renderTable({ onChildToggle });
    const group = bodyRows(container).find((tr) => tr.getAttribute("data-row-id") === "1")!;
    fireEvent.click(group.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    // Трогаем только ту базу, состояние которой отличается от нового.
    expect(onChildToggle).toHaveBeenCalledTimes(1);
    expect(onChildToggle.mock.calls[0][1].uuid).toBe("role-a|BASE2");
    expect(onChildToggle.mock.calls[0][2]).toBe(true);
  });

  it("раскрытие — на шевроне, а не на строке", () => {
    const onToggleExpand = vi.fn<(row: TDataItem) => void>();
    const { container } = renderTable({ onToggleExpand, expandedRowIds: new Set<string>() });
    const group = bodyRows(container).find((tr) => tr.getAttribute("data-row-id") === "1")!;

    fireEvent.click(group);
    expect(onToggleExpand).not.toHaveBeenCalled();

    fireEvent.click(group.querySelector("button")!);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onToggleExpand.mock.calls[0][0].uuid).toBe("role-a");
  });

  it("disableActiveRow: щелчок не делает строку активной", () => {
    const { container } = renderTable();
    const group = bodyRows(container).find((tr) => tr.getAttribute("data-row-id") === "1")!;
    fireEvent.click(group);
    expect(group.getAttribute("data-active")).toBeNull();
  });

  it("без disableActiveRow активная строка работает как прежде", () => {
    const { container } = renderTable({ disableActiveRow: false });
    const group = bodyRows(container).find((tr) => tr.getAttribute("data-row-id") === "1")!;
    fireEvent.click(group);
    expect(group.getAttribute("data-active")).toBe("true");
  });
});

describe("Table: чекбокс в шапке групповой таблицы", () => {
  const headerBox = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;

  it("активен и показывает промежуточное состояние, когда отмечена часть вложенных", () => {
    // Управление отметками должно быть настоящим: без обработчика чекбоксы группы
    // декоративны, и заголовочный правильно остаётся заблокированным.
    const { container } = renderTable({ onChildToggle: () => {} });
    const box = headerBox(container);
    // Раньше он был навсегда заблокирован: выбирать «строки» в такой таблице нечего,
    // и таблица считала, что выбор ей не нужен вовсе.
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(true);
  });

  it("щелчок доводит до общего состояния все вложенные строки всех групп", () => {
    const onChildToggle = vi.fn<(parent: TDataItem, child: TDataItem, next: boolean) => void>();
    const { container } = renderTable({ onChildToggle });
    fireEvent.click(headerBox(container));
    // Трогаем только те строки, состояние которых отличается от нового.
    expect(onChildToggle).toHaveBeenCalledTimes(1);
    expect(onChildToggle.mock.calls[0][1].uuid).toBe("role-a|BASE2");
    expect(onChildToggle.mock.calls[0][2]).toBe(true);
  });
});

describe("Table: строка-заголовок группы не занимает чужое имя класса", () => {
  it("класс группы не совпадает с общим хелпером GroupRow", () => {
    const { container } = renderTable();
    const group = bodyRows(container).find((tr) => tr.getAttribute("data-row-id") === "1")!;
    // `.GroupRow` объявлен в variables.scss как display:flex и подмешивается в каждый
    // модуль: одноимённый класс превращал строку таблицы во флекс-контейнер.
    expect(group.className).not.toMatch(/(^|\s|_)GroupRow_/);
  });
});

// screen импортирован ради типов утилит testing-library; явное использование не нужно.
void screen;

// ── Раскрытие ПОЯСНЯЮЩЕЕ: отмечают саму группу, а не вложенные ──────────────
//
// Так устроены «Задания»: строка задания выбирается для отмены или повтора, а её базы
// лишь показывают, чем кончилось у каждой. Пока это не различалось, чекбокс такой группы
// считался по отметкам детей — которых нет, — и строка не отмечалась вовсе.
//
// Признак различения — наличие `__selected` в данных потомка, а не его значение:
// `__selected: false` у всех значит «отмечаемы, но не отмечены», и это ровно группа.

describe("Table: вложенные строки поясняют группу, а выбирают саму группу", () => {
  /** У потомков НЕТ `__selected`: они только рассказывают о строке-задании. */
  const explain = (r: TDataItem): TDataItem[] => (
    r.uuid === "role-a"
      ? [
        { id: -1, uuid: "role-a|BASE1", name: "BASE1", note: "Выполнено" },
        { id: -2, uuid: "role-a|BASE2", name: "BASE2", note: "В очереди" },
      ]
      : []
  );

  it("чекбокс группы отмечает саму строку", () => {
    const { container } = render(
      <TestWrapper>
        <Table {...buildStaticTableProps({
          componentName: "TestExplainTable",
          rows, columns: columns(), setColumns: () => { },
          selectable: true,
          childRows: explain,
          expandedRowIds: new Set(["role-a"]),
          disableActiveRow: true,
        })} />
      </TestWrapper>,
    );
    const first = bodyRows(container)[0];
    const box = first.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    // Отметилась СТРОКА, а не её потомки: у них отмечать нечего.
    expect(first.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  it("у поясняющего потомка чекбокса нет, но клетка под него остаётся", () => {
    const { container } = render(
      <TestWrapper>
        <Table {...buildStaticTableProps({
          componentName: "TestExplainTable2",
          rows, columns: columns(), setColumns: () => { },
          selectable: true,
          childRows: explain,
          expandedRowIds: new Set(["role-a"]),
          disableActiveRow: true,
        })} />
      </TestWrapper>,
    );
    const all = bodyRows(container);
    const child = all.find((tr) => tr.textContent?.includes("BASE1"))!;
    expect(child.querySelector('input[type="checkbox"]')).toBeNull();
    // Ячеек столько же, сколько у обычной строки: иначе колонки разъедутся.
    expect(child.querySelectorAll("td").length).toBe(all[0].querySelectorAll("td").length);
  });
});

// ── Перенос текста в ячейках (wrapCells) ───────────────────────────────────
//
// Бывают таблицы, где содержимое ячейки — ПРЕДЛОЖЕНИЕ, а не значение: текст технического
// сообщения, ответ агента, причина отказа. Обрезать их многоточием значит спрятать ровно
// то, ради чего в таблицу и смотрят.
//
// Вместе с переносом ОБЯЗАТЕЛЬНО отключается виртуализация: она считает положение строки
// как index × ROW_HEIGHT и верит, что все строки одной высоты. Строки разной высоты эту
// веру ломают — отступы-заглушки перестают совпадать с содержимым, и таблица разъезжается.

describe("Table: перенос текста в ячейках", () => {
  const long = "ibcmd extension list по базе «almaz67» не ответил за 180 с — процесс снят. "
    + "Обычно это занятый рабочий каталог или блокировка в самой базе";
  const wordy: TDataItem[] = [{ id: 1, uuid: "m1", name: long, note: "" }];

  it("без wrapCells таблица не помечена классом переноса", () => {
    const { container } = render(
      <TestWrapper>
        <Table {...buildStaticTableProps({
          componentName: "TestWrapOff", rows: wordy, columns: columns(), setColumns: () => { },
        })} />
      </TestWrapper>,
    );
    expect(container.querySelector('[class*="WrapCells"]')).toBeNull();
  });

  it("с wrapCells класс переноса стоит, а текст не обрезан", () => {
    const { container } = render(
      <TestWrapper>
        <Table {...buildStaticTableProps({
          componentName: "TestWrapOn", rows: wordy, columns: columns(), setColumns: () => { },
          wrapCells: true,
        })} />
      </TestWrapper>,
    );
    expect(container.querySelector('[class*="WrapCells"]')).toBeTruthy();
    // Текст доходит до разметки целиком: перенос — дело CSS, но прятать его нельзя.
    expect(container.textContent).toContain("блокировка в самой базе");
  });

  it("с wrapCells отрисованы ВСЕ строки: виртуализация выключена", () => {
    // Больше окна виртуализации: при включённой часть строк не дошла бы до разметки.
    const many: TDataItem[] = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1, uuid: `m${i}`, name: `Сообщение ${i}`, note: "",
    }));
    const { container } = render(
      <TestWrapper>
        <Table {...buildStaticTableProps({
          componentName: "TestWrapMany", rows: many, columns: columns(), setColumns: () => { },
          wrapCells: true,
        })} />
      </TestWrapper>,
    );
    expect(bodyRows(container).length).toBe(60);
  });
});


// ── Строка, которую отметить НЕЛЬЗЯ, не должна ломать чекбокс шапки ──────────
//
// Живой случай — «Задания»: у базы, для которой команды даже не создалось (её отсеяли при
// постановке), отмечать нечего, и `__selected` у такой строки нет вовсе. Пока она попадала
// в знаменатель «отмечено всё», состояние «всё» было недостижимо: чекбокс в шапке навсегда
// застревал промежуточным и на каждое нажатие снова отмечал всё вместо того, чтобы снять.

describe("Table: неотмечаемая вложенная строка не блокирует чекбокс шапки", () => {
  /** Две базы с командами (обе отмечены) и одна без команды — её отметить нечем. */
  const mixed = (r: TDataItem): TDataItem[] => (
    r.uuid === "role-a"
      ? [
        { id: -1, uuid: "role-a|BASE1", name: "BASE1", note: "В очереди", __selected: true },
        { id: -2, uuid: "role-a|BASE2", name: "BASE2", note: "В очереди", __selected: true },
        { id: -3, uuid: "role-a|BASE3", name: "BASE3", note: "Команда не создана" },
      ]
      : []
  );

  const renderMixed = (onChildToggle: (p: TDataItem, c: TDataItem, n: boolean) => void) => render(
    <TestWrapper>
      <Table {...buildStaticTableProps({
        componentName: "TestMixedTable",
        rows, columns: columns(), setColumns: () => { },
        selectable: true,
        childRows: mixed,
        onChildToggle,
        expandedRowIds: new Set(["role-a"]),
        disableActiveRow: true,
      })} />
    </TestWrapper>,
  );

  it("«отмечено всё» достижимо: неотмечаемая строка в счёт не идёт", () => {
    const { container } = renderMixed(() => {});
    const box = container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });

  it("щелчок по полной отметке снимает её у всех, кого можно отметить", () => {
    const onChildToggle = vi.fn<(p: TDataItem, c: TDataItem, n: boolean) => void>();
    const { container } = renderMixed(onChildToggle);
    fireEvent.click(container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!);
    // Сняли обе отмеченные; строку без отметки не трогали вовсе.
    expect(onChildToggle).toHaveBeenCalledTimes(2);
    expect(onChildToggle.mock.calls.every((c) => c[2] === false)).toBe(true);
    expect(onChildToggle.mock.calls.map((c) => c[1].uuid)).toEqual(["role-a|BASE1", "role-a|BASE2"]);
  });
});
