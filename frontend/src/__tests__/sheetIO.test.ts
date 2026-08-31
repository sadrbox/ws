import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { mapRowsByHeader, recordsToAoa, readWorkbookAoa } from "src/utils/sheetIO";

// T2.4 — переиспользуемое ядро импорта/экспорта таблиц: маппинг колонок по
// синонимам, сборка листа из записей, чтение книги (round-trip).

describe("mapRowsByHeader", () => {
  const aliases = { name: ["наименование", "name", "название"], bin: ["бин", "bin", "иин"] };

  it("маппит колонки по синонимам (регистр/пробелы не важны)", () => {
    const aoa = [
      ["Наименование", "БИН"],
      ["ТОО Ромашка", "123456789012"],
      ["ИП Иванов", "980101300123"],
    ];
    expect(mapRowsByHeader(aoa, aliases)).toEqual([
      { name: "ТОО Ромашка", bin: "123456789012" },
      { name: "ИП Иванов", bin: "980101300123" },
    ]);
  });

  it("порядок и незнакомые колонки не мешают; пустые строки пропускаются", () => {
    const aoa = [
      ["BIN", "Лишнее", "name"],
      ["111", "x", "А"],
      ["", "", ""], // пустая
      ["222", "y", "Б"],
    ];
    expect(mapRowsByHeader(aoa, aliases)).toEqual([
      { bin: "111", name: "А" },
      { bin: "222", name: "Б" },
    ]);
  });

  it("пустой лист → []", () => {
    expect(mapRowsByHeader([], aliases)).toEqual([]);
  });
});

describe("recordsToAoa", () => {
  it("записи → заголовок + строки по порядку колонок", () => {
    const cols = [{ key: "name", label: "Наименование" }, { key: "bin", label: "БИН" }];
    const aoa = recordsToAoa([{ name: "ТОО А", bin: "111" }, { name: "ТОО Б" }], cols);
    expect(aoa).toEqual([
      ["Наименование", "БИН"],
      ["ТОО А", "111"],
      ["ТОО Б", ""], // отсутствующее поле → пусто
    ]);
  });
});

describe("readWorkbookAoa (round-trip через xlsx)", () => {
  it("собранная книга читается обратно в массив-строк", () => {
    const aoa = [["name", "bin"], ["ТОО А", "111"]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "s");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const back = readWorkbookAoa(buf);
    expect(back[0]).toEqual(["name", "bin"]);
    expect(back[1]).toEqual(["ТОО А", "111"]);
  });
});
