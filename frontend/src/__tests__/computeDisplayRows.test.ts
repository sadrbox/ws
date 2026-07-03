import { describe, it, expect } from "vitest";
import { computeDisplayRows } from "src/components/SubTable/rowModel";
import type { TColumn, TDataItem } from "src/components/Table/types";

// ── Хелперы ────────────────────────────────────────────────────────────────
const col = (identifier: string, over: Partial<TColumn> = {}): TColumn => ({
  identifier,
  type: "string",
  visible: true,
  inlist: true,
  ...over,
});

// Базовый набор параметров — переопределяем только то, что нужно тесту.
const base = (over: Partial<Parameters<typeof computeDisplayRows>[0]>) =>
  computeDisplayRows({
    rows: [],
    deferRemoteChanges: false,
    parentUuid: "",
    parentKey: "",
    computeRow: undefined,
    clientSort: false,
    sort: {},
    search: "",
    filterRows: undefined,
    columns: [col("name")],
    ...over,
  });

const row = (over: Record<string, unknown>): TDataItem => over as unknown as TDataItem;

// ── Тесты ────────────────────────────────────────────────────────────────────
describe("computeDisplayRows — конвейер отображаемых строк SubTable", () => {
  it("deferRemoteChanges скрывает строки, помеченные на удаление", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "Альфа" }),
      row({ id: 2, uuid: "b", name: "Бета", _pendingAction: "delete" }),
      row({ id: 3, uuid: "c", name: "Гамма" }),
    ];
    const kept = base({ rows, deferRemoteChanges: true });
    expect(kept.map(r => r.uuid)).toEqual(["a", "c"]);
  });

  it("без deferRemoteChanges строки с delete-маркером не скрываются", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "Альфа" }),
      row({ id: 2, uuid: "b", name: "Бета", _pendingAction: "delete" }),
    ];
    const kept = base({ rows, deferRemoteChanges: false });
    expect(kept.map(r => r.uuid)).toEqual(["a", "b"]);
  });

  it("parentUuid/parentKey: оставляет строки своего владельца, но всегда — temp (id<0)", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "Своя", saleUuid: "doc-1" }),
      row({ id: 2, uuid: "b", name: "Чужая", saleUuid: "doc-2" }),
      row({ id: -1, uuid: "tmp-1", name: "Новая", saleUuid: "" }), // temp — без владельца
    ];
    const kept = base({ rows, parentUuid: "doc-1", parentKey: "saleUuid" });
    expect(kept.map(r => r.uuid).sort()).toEqual(["a", "tmp-1"]);
  });

  it("сортировка: pending-create строки приклеиваются В КОНЕЦ независимо от направления", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "Бета" }),
      row({ id: 2, uuid: "b", name: "Альфа" }),
      row({ id: -1, uuid: "tmp-1", name: "Яблоко", _pendingAction: "create" }),
    ];
    // asc: существующие сортируются (Альфа, Бета), новая — в конце
    const asc = base({ rows, sort: { name: "asc" } });
    expect(asc.map(r => r.uuid)).toEqual(["b", "a", "tmp-1"]);
    // desc: существующие (Бета, Альфа), новая всё равно в конце
    const desc = base({ rows, sort: { name: "desc" } });
    expect(desc.map(r => r.uuid)).toEqual(["a", "b", "tmp-1"]);
  });

  it("clientSort=true: temp-строки участвуют в сортировке вместе со всеми", () => {
    const rows = [
      row({ id: -2, uuid: "tmp-2", name: "Бета", _pendingAction: "create" }),
      row({ id: -1, uuid: "tmp-1", name: "Альфа", _pendingAction: "create" }),
      row({ id: -3, uuid: "tmp-3", name: "Гамма", _pendingAction: "create" }),
    ];
    const sorted = base({ rows, clientSort: true, sort: { name: "asc" } });
    expect(sorted.map(r => r.name)).toEqual(["Альфа", "Бета", "Гамма"]);
  });

  it("поиск по видимым колонкам (matchRowBySearch по умолчанию)", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "Молоко" }),
      row({ id: 2, uuid: "b", name: "Хлеб" }),
      row({ id: 3, uuid: "c", name: "Сухое молоко" }),
    ];
    const found = base({ rows, search: "молок", columns: [col("name")] });
    expect(found.map(r => r.uuid)).toEqual(["a", "c"]);
  });

  it("поиск игнорирует невидимые колонки", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "Молоко", hidden: "секрет" }),
      row({ id: 2, uuid: "b", name: "Хлеб", hidden: "молоко-тоже" }),
    ];
    const found = base({
      rows,
      search: "молок",
      columns: [col("name"), col("hidden", { visible: false })],
    });
    expect(found.map(r => r.uuid)).toEqual(["a"]); // строка b совпала бы только по скрытой колонке
  });

  it("кастомный filterRows используется вместо matchRowBySearch", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "X" }),
      row({ id: 2, uuid: "b", name: "Y" }),
    ];
    const found = base({
      rows,
      search: "что угодно",
      filterRows: (rs) => rs.filter(r => r.uuid === "b"),
    });
    expect(found.map(r => r.uuid)).toEqual(["b"]);
  });

  it("computeRow обогащает строки и влияет на сортировку по вычисляемому полю", () => {
    const rows = [
      row({ id: 1, uuid: "a", qty: 2, price: 50 }),  // amount 100
      row({ id: 2, uuid: "b", qty: 3, price: 10 }),  // amount 30
      row({ id: 3, uuid: "c", qty: 1, price: 70 }),  // amount 70
    ];
    const sorted = base({
      rows,
      computeRow: (r) => ({ amount: (r.qty as number) * (r.price as number) }),
      sort: { amount: "asc" },
      columns: [col("amount", { type: "number" })],
    });
    expect(sorted.map(r => r.uuid)).toEqual(["b", "c", "a"]);
  });

  it("пустой поиск возвращает все строки (после фильтров/сортировки)", () => {
    const rows = [
      row({ id: 1, uuid: "a", name: "A" }),
      row({ id: 2, uuid: "b", name: "B" }),
    ];
    expect(base({ rows, search: "" })).toHaveLength(2);
  });
});
