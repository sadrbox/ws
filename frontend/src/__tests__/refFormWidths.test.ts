import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Единый паттерн ширин в формах справочников: ширины полей берутся ТОЛЬКО из
// FIELD_WIDTH — без «…px» и inline-style. Тест — страж от регресса: новая форма
// или правка со старым хардкодом уронит сборку тестов.
const REFERENCE_FORMS = [
  "Organizations", "Counterparties", "Products", "Employees", "Warehouses",
  "Cashboxes", "BankAccounts", "Contracts", "Contacts", "ContactPersons",
  "Users", "ChartOfAccounts", "SubkontoTypes", "Taxes", "Classifiers",
  "OrganizationAccountingSettings",
];

const read = (m: string) =>
  readFileSync(resolve(__dirname, `../models/${m}/index.tsx`), "utf-8");

describe("Справочники: единый паттерн ширин полей (FIELD_WIDTH)", () => {
  it.each(REFERENCE_FORMS)("%s не хардкодит width/minWidth в px", (model) => {
    const src = read(model);
    // width="120px" / minWidth="200px" / maxWidth="…px" — запрещены.
    const pxWidth = src.match(/(?:min|max)?[Ww]idth="\d+px"/g) ?? [];
    expect(pxWidth, `хардкод-ширины: ${pxWidth.join(", ")}`).toHaveLength(0);
    // inline style с числовой шириной — тоже (напр. style={{ minWidth: 240 }}).
    const inlineWidth = src.match(/style=\{\{\s*(?:min|max)?[Ww]idth:\s*\d+/g) ?? [];
    expect(inlineWidth, `инлайн-ширины: ${inlineWidth.join(", ")}`).toHaveLength(0);
  });

  it("формы, использующие FIELD_WIDTH, импортируют его", () => {
    for (const model of REFERENCE_FORMS) {
      const src = read(model);
      if (src.includes("FIELD_WIDTH.")) {
        expect(src, `${model}: FIELD_WIDTH без импорта`).toContain(
          'from "src/components/Field/fieldWidths"',
        );
      }
    }
  });
});
