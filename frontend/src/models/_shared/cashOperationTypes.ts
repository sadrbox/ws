/**
 * Каталог типов кассовых операций (ПКО/РКО) для РК.
 *
 * Источник истины для фронта: список типов по направлению, требование
 * контрагента/договора/подотчётного лица и допустимые типы документа-основания.
 * Метки — через i18 (translate по labelKey) при вызове, чтобы реагировать на язык.
 * Корр-счёт проводки задаётся ПАРАЛЛЕЛЬНО на бэкенде
 * (backend/services/accountingPosting.js → CASH_OP_OFFSET) по тем же value.
 *
 * Типы основания ограничены настроенными в BASIS_SOURCE_CONFIGS
 * (src/utils/createFromBasis.ts), чтобы авто-заполнение шапки работало.
 */
import { translate } from "src/i18";
import type { BasisTypeConfig } from "src/components/Field/BasisDocumentField";

export type CashDirection = "receipt" | "expense";

export interface CashOperationType {
  value: string;
  label: string;
  /** Требуются ли контрагент и договор (false для переводов банк↔касса и подотчёта). */
  requiresCounterparty: boolean;
  /** Требуется ли подотчётное лицо (сотрудник) — операции по счёту 1250. */
  requiresEmployee?: boolean;
  /** Допустимые типы документа-основания (пусто → основание не применяется). */
  basisTypes: BasisTypeConfig[];
}

interface RawOp {
  value: string;
  labelKey: string;
  requiresCounterparty: boolean;
  requiresEmployee?: boolean;
  basisTypes: BasisTypeConfig[];
}

const RECEIPT_TYPES: RawOp[] = [
  {
    value: "payment_from_customer",
    labelKey: "cashOpPaymentFromCustomer",
    requiresCounterparty: true,
    basisTypes: [
      { type: "sale", endpoint: "sales" },
      { type: "outgoing_invoice", endpoint: "outgoing-invoices" },
      { type: "payment_invoice", endpoint: "payment-invoices" },
      { type: "sales_order", endpoint: "sales-orders" },
    ],
  },
  {
    value: "return_from_supplier",
    labelKey: "cashOpReturnFromSupplier",
    requiresCounterparty: true,
    basisTypes: [
      { type: "purchase", endpoint: "purchases" },
      { type: "incoming_invoice", endpoint: "incoming-invoices" },
    ],
  },
  { value: "return_from_accountable", labelKey: "cashOpReturnFromAccountable", requiresCounterparty: false, requiresEmployee: true, basisTypes: [] },
  { value: "cash_from_bank", labelKey: "cashOpCashFromBank", requiresCounterparty: false, basisTypes: [] },
  { value: "other_receipt", labelKey: "cashOpOtherReceipt", requiresCounterparty: true, basisTypes: [] },
];

const EXPENSE_TYPES: RawOp[] = [
  {
    value: "payment_to_supplier",
    labelKey: "cashOpPaymentToSupplier",
    requiresCounterparty: true,
    basisTypes: [
      { type: "purchase", endpoint: "purchases" },
      { type: "incoming_invoice", endpoint: "incoming-invoices" },
      { type: "purchase_order", endpoint: "purchase-orders" },
    ],
  },
  {
    value: "return_to_customer",
    labelKey: "cashOpReturnToCustomer",
    requiresCounterparty: true,
    basisTypes: [
      { type: "sale", endpoint: "sales" },
      { type: "outgoing_invoice", endpoint: "outgoing-invoices" },
    ],
  },
  { value: "issue_to_accountable", labelKey: "cashOpIssueToAccountable", requiresCounterparty: false, requiresEmployee: true, basisTypes: [] },
  { value: "cash_to_bank", labelKey: "cashOpCashToBank", requiresCounterparty: false, basisTypes: [] },
  { value: "other_expense", labelKey: "cashOpOtherExpense", requiresCounterparty: true, basisTypes: [] },
];

const withLabel = (op: RawOp): CashOperationType => ({
  value: op.value,
  label: translate(op.labelKey),
  requiresCounterparty: op.requiresCounterparty,
  requiresEmployee: op.requiresEmployee,
  basisTypes: op.basisTypes,
});

export function cashOperationTypes(direction: CashDirection): CashOperationType[] {
  return (direction === "receipt" ? RECEIPT_TYPES : EXPENSE_TYPES).map(withLabel);
}

export function defaultCashOperationType(direction: CashDirection): string {
  return direction === "receipt" ? "payment_from_customer" : "payment_to_supplier";
}

export function findCashOperationType(value: string): CashOperationType | undefined {
  const op = [...RECEIPT_TYPES, ...EXPENSE_TYPES].find((t) => t.value === value);
  return op ? withLabel(op) : undefined;
}
