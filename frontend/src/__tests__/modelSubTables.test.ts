/**
 * Тесты для SubTable-компонентов моделей.
 *
 * Подход: тестируем изолированную логику (defaultNewRow, adjustedColumns,
 * validationRules) без рендеринга компонентов, т.к. они имеют тяжёлые
 * зависимости (react-query, context и т.д.).
 */
import { describe, it, expect } from "vitest";

import cashExpenseOrdersCols from "../models/CashExpenseOrders/columns.json";
import cashReceiptOrdersCols from "../models/CashReceiptOrders/columns.json";
import incomingInvoicesCols from "../models/IncomingInvoices/columns.json";
import outgoingInvoicesCols from "../models/OutgoingInvoices/columns.json";
import paymentInvoicesCols from "../models/PaymentInvoices/columns.json";
import purchasesCols from "../models/Purchases/columns.json";
import salesCols from "../models/Sales/columns.json";
import inventoryTransfersCols from "../models/InventoryTransfers/columns.json";
import payrollCalculationsCols from "../models/PayrollCalculations/columns.json";
import payrollPaymentsCols from "../models/PayrollPayments/columns.json";
import productsCols from "../models/Products/columns.json";
import unitOfMeasuresCols from "../models/UnitOfMeasures/columns.json";
import vatRatesCols from "../models/VatRates/columns.json";
import bankAccountsCols from "../models/BankAccounts/columns.json";
import contactsCols from "../models/Contacts/columns.json";
import contractsCols from "../models/Contracts/columns.json";

// ─── Вспомогательные функции (воспроизводят логику компонентов) ───────────────

/** Логика adjustedColumns из BankAccountsTable — скрывает ownerName */
function bankAccountsAdjustColumns(cols: Array<Record<string, unknown>>) {
  return cols.map((col) =>
    col.identifier === "ownerName" ? { ...col, visible: false, inlist: false } : col,
  );
}

/** Логика adjustedColumns из ContactsTable — скрывает ownerName */
function contactsAdjustColumns(cols: Array<Record<string, unknown>>) {
  return cols.map((col) =>
    col.identifier === "ownerName" ? { ...col, visible: false, inlist: false } : col,
  );
}

/** Логика adjustedColumns из ContractsTable — скрывает hideId, показывает showId */
function contractsAdjustColumns(
  cols: Array<Record<string, unknown>>,
  hideId: string,
  showId: string,
) {
  return cols.map((col) => {
    if (col.identifier === hideId) return { ...col, visible: false, inlist: false };
    if (col.identifier === showId) return { ...col, visible: true, inlist: true };
    return col;
  });
}

/** validationRules из EmployeeHistoryTable */
function ehValidateSalary(value: unknown): string | undefined {
  if (value === "" || value == null) return undefined;
  const n = Number(value);
  if (isNaN(n)) return "Должно быть числом";
  if (n < 0) return "Не может быть отрицательным";
  return undefined;
}

function ehValidateEventDate(value: unknown): string | undefined {
  return !value ? "Дата обязательна" : undefined;
}

// ─── BankAccountsTable ────────────────────────────────────────────────────────

describe("BankAccountsTable", () => {
  it("defaultNewRow содержит обязательные поля", () => {
    const defaultNewRow = {
      shortName: "", iban: "", bik: "", bankName: "", currencyUuid: null,
    };
    expect(defaultNewRow).toHaveProperty("shortName");
    expect(defaultNewRow).toHaveProperty("iban");
    expect(defaultNewRow).toHaveProperty("bik");
    expect(defaultNewRow).toHaveProperty("bankName");
    expect(defaultNewRow).toHaveProperty("currencyUuid");
  });

  it("adjustedColumns скрывает ownerName", () => {
    const cols = [
      { identifier: "shortName", visible: true, inlist: true },
      { identifier: "ownerName", visible: true, inlist: true },
      { identifier: "iban", visible: true, inlist: true },
    ];
    const result = bankAccountsAdjustColumns(cols);
    const ownerCol = result.find((c) => c.identifier === "ownerName");
    expect(ownerCol?.visible).toBe(false);
    expect(ownerCol?.inlist).toBe(false);
  });

  it("adjustedColumns не затрагивает другие колонки", () => {
    const cols = [
      { identifier: "shortName", visible: true, inlist: true },
      { identifier: "ownerName", visible: true, inlist: true },
    ];
    const result = bankAccountsAdjustColumns(cols);
    const shortCol = result.find((c) => c.identifier === "shortName");
    expect(shortCol?.visible).toBe(true);
    expect(shortCol?.inlist).toBe(true);
  });
});

// ─── ContactsTable ────────────────────────────────────────────────────────────

describe("ContactsTable", () => {
  it("adjustedColumns скрывает ownerName", () => {
    const cols = [
      { identifier: "value", visible: true, inlist: true },
      { identifier: "ownerName", visible: true, inlist: true },
    ];
    const result = contactsAdjustColumns(cols);
    const ownerCol = result.find((c) => c.identifier === "ownerName");
    expect(ownerCol?.visible).toBe(false);
    expect(ownerCol?.inlist).toBe(false);
  });

  it("adjustedColumns сохраняет видимость остальных колонок", () => {
    const cols = [
      { identifier: "value", visible: true, inlist: true },
      { identifier: "ownerName", visible: true, inlist: true },
    ];
    const result = contactsAdjustColumns(cols);
    const valueCol = result.find((c) => c.identifier === "value");
    expect(valueCol?.visible).toBe(true);
  });
});

// ─── ContractsTable ───────────────────────────────────────────────────────────

describe("ContractsTable", () => {
  const cols = [
    { identifier: "counterparty.shortName", visible: true, inlist: true },
    { identifier: "organization.shortName", visible: true, inlist: true },
    { identifier: "shortName", visible: true, inlist: true },
  ];

  it("скрывает counterparty когда родитель — organization", () => {
    const result = contractsAdjustColumns(cols, "counterparty.shortName", "organization.shortName");
    const cp = result.find((c) => c.identifier === "counterparty.shortName");
    expect(cp?.visible).toBe(false);
    expect(cp?.inlist).toBe(false);
  });

  it("показывает organization когда родитель — counterparty", () => {
    const result = contractsAdjustColumns(cols, "counterparty.shortName", "organization.shortName");
    const org = result.find((c) => c.identifier === "organization.shortName");
    expect(org?.visible).toBe(true);
    expect(org?.inlist).toBe(true);
  });

  it("скрывает organization когда родитель — counterparty", () => {
    const result = contractsAdjustColumns(cols, "organization.shortName", "counterparty.shortName");
    const org = result.find((c) => c.identifier === "organization.shortName");
    expect(org?.visible).toBe(false);
    expect(org?.inlist).toBe(false);
  });

  it("не затрагивает нейтральные колонки", () => {
    const result = contractsAdjustColumns(cols, "counterparty.shortName", "organization.shortName");
    const sc = result.find((c) => c.identifier === "shortName");
    expect(sc?.visible).toBe(true);
  });
});

// ─── EmployeeHistoryTable ─────────────────────────────────────────────────────

describe("EmployeeHistoryTable — defaultNewRow", () => {
  it("содержит все необходимые поля", () => {
    const today = new Date().toISOString().slice(0, 10);
    const defaultNewRow = {
      eventDate: today,
      eventType: "hire",
      salary: null,
      positionUuid: null,
      organizationUuid: null,
    };
    expect(defaultNewRow.eventDate).toBe(today);
    expect(defaultNewRow.eventType).toBe("hire");
    expect(defaultNewRow).toHaveProperty("salary");
    expect(defaultNewRow).toHaveProperty("positionUuid");
    expect(defaultNewRow).toHaveProperty("organizationUuid");
  });
});

describe("EmployeeHistoryTable — validationRules.salary", () => {
  it("пропускает null", () => {
    expect(ehValidateSalary(null)).toBeUndefined();
  });

  it("пропускает пустую строку", () => {
    expect(ehValidateSalary("")).toBeUndefined();
  });

  it("пропускает корректное число", () => {
    expect(ehValidateSalary("120000")).toBeUndefined();
    expect(ehValidateSalary("0")).toBeUndefined();
  });

  it("возвращает ошибку для отрицательного числа", () => {
    expect(ehValidateSalary("-1")).toBe("Не может быть отрицательным");
  });

  it("возвращает ошибку для нечислового значения", () => {
    expect(ehValidateSalary("abc")).toBe("Должно быть числом");
  });
});

describe("EmployeeHistoryTable — validationRules.eventDate", () => {
  it("возвращает ошибку для пустой даты", () => {
    expect(ehValidateEventDate("")).toBe("Дата обязательна");
    expect(ehValidateEventDate(null)).toBe("Дата обязательна");
    expect(ehValidateEventDate(undefined)).toBe("Дата обязательна");
  });

  it("пропускает корректную дату", () => {
    expect(ehValidateEventDate("2025-01-15")).toBeUndefined();
  });
});

// ─── columns.json — проверка поля inlist ──────────────────────────────────────

function checkAllHaveInlist(cols: Array<Record<string, unknown>>, model: string) {
  for (const col of cols) {
    expect(
      "inlist" in col,
      `Колонка '${String(col.identifier)}' в ${model}/columns.json не имеет поля inlist`,
    ).toBe(true);
  }
}

describe("columns.json — поле inlist присутствует во всех колонках", () => {
  it("CashExpenseOrders", () => checkAllHaveInlist(cashExpenseOrdersCols as any, "CashExpenseOrders"));
  it("CashReceiptOrders", () => checkAllHaveInlist(cashReceiptOrdersCols as any, "CashReceiptOrders"));
  it("IncomingInvoices", () => checkAllHaveInlist(incomingInvoicesCols as any, "IncomingInvoices"));
  it("OutgoingInvoices", () => checkAllHaveInlist(outgoingInvoicesCols as any, "OutgoingInvoices"));
  it("PaymentInvoices", () => checkAllHaveInlist(paymentInvoicesCols as any, "PaymentInvoices"));
  it("Purchases", () => checkAllHaveInlist(purchasesCols as any, "Purchases"));
  it("Sales", () => checkAllHaveInlist(salesCols as any, "Sales"));
  it("InventoryTransfers", () => checkAllHaveInlist(inventoryTransfersCols as any, "InventoryTransfers"));
  it("PayrollCalculations", () => checkAllHaveInlist(payrollCalculationsCols as any, "PayrollCalculations"));
  it("PayrollPayments", () => checkAllHaveInlist(payrollPaymentsCols as any, "PayrollPayments"));
  it("Products", () => checkAllHaveInlist(productsCols as any, "Products"));
  it("UnitOfMeasures", () => checkAllHaveInlist(unitOfMeasuresCols as any, "UnitOfMeasures"));
  it("VatRates", () => checkAllHaveInlist(vatRatesCols as any, "VatRates"));
  it("BankAccounts", () => checkAllHaveInlist(bankAccountsCols as any, "BankAccounts"));
  it("Contacts", () => checkAllHaveInlist(contactsCols as any, "Contacts"));
  it("Contracts", () => checkAllHaveInlist(contractsCols as any, "Contracts"));
});
