import { FC, useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Button, ButtonImage } from "src/components/Button";
import { Divider } from "src/components/Field";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
import {
  getAllFormStoreEntries,
  removeFormStoreEntry,
  type FormStoreEntry,
} from "src/hooks/useFormSessionStore";

// Импорты всех *Form компонентов
import { UsersForm } from "src/models/Users";
import { OrganizationsForm } from "src/models/Organizations";
import { CounterpartiesForm } from "src/models/Counterparties";
import { ContractsForm } from "src/models/Contracts";
import { BankAccountsForm } from "src/models/BankAccounts";
import { ContactsForm } from "src/models/Contacts";
import { ContactPersonsForm } from "src/models/ContactPersons";
import { ContactTypesForm } from "src/models/ContactTypes";
import { EmployeesForm } from "src/models/Employees";
import { PositionsForm } from "src/models/Positions";
import { ProductsForm } from "src/models/Products";
import { BrandsForm } from "src/models/Brands";
import { CurrenciesForm } from "src/models/Currencies";
import { TodosForm } from "src/models/Todos";
import { SalesForm } from "src/models/Sales";
import { PurchasesForm } from "src/models/Purchases";
import { OutgoingInvoicesForm } from "src/models/OutgoingInvoices";
import { IncomingInvoicesForm } from "src/models/IncomingInvoices";
import { PaymentInvoicesForm } from "src/models/PaymentInvoices";
import { CashReceiptOrdersForm } from "src/models/CashReceiptOrders";
import { CashExpenseOrdersForm } from "src/models/CashExpenseOrders";
import { InventoryTransfersForm } from "src/models/InventoryTransfers";
import { WarehousesForm } from "src/models/Warehouses";
import { AccessRightsForm } from "src/models/AccessRights";

// ═══════════════════════════════════════════════════════════════════════════
// Маппинг formName → { label (русское название), FormComponent }
// formName соответствует первому аргументу useFormSessionStore
// Пример ключа sessionStorage: "formStore:users-form:some-uuid"
// ═══════════════════════════════════════════════════════════════════════════

interface FormMapping {
  label: string;
  FormComponent: FC<any>;
}

const FORM_REGISTRY: Record<string, FormMapping> = {
  "users-form":              { label: "Пользователи",       FormComponent: UsersForm },
  "organizations-form":      { label: "Организации",         FormComponent: OrganizationsForm },
  "counterparties-form":     { label: "Контрагенты",         FormComponent: CounterpartiesForm },
  "contracts-form":          { label: "Договора",            FormComponent: ContractsForm },
  "bank-accounts-form":      { label: "Банковские счета",    FormComponent: BankAccountsForm },
  "contacts-form":           { label: "Контакты",            FormComponent: ContactsForm },
  "contact-persons-form":    { label: "Контактные лица",     FormComponent: ContactPersonsForm },
  "contact-types-form":      { label: "Типы контактов",      FormComponent: ContactTypesForm },
  "employees-form":          { label: "Сотрудники",          FormComponent: EmployeesForm },
  "positions-form":          { label: "Должности",           FormComponent: PositionsForm },
  "products-form":           { label: "Номенклатура",        FormComponent: ProductsForm },
  "brands-form":             { label: "Бренды",              FormComponent: BrandsForm },
  "currencies-form":         { label: "Валюты",              FormComponent: CurrenciesForm },
  "todos-form":              { label: "Задачи",              FormComponent: TodosForm },
  "sales-form":              { label: "Реализация",          FormComponent: SalesForm },
  "purchases-form":          { label: "Поступления",         FormComponent: PurchasesForm },
  "outgoing-invoices-form":  { label: "СФ исходящие",        FormComponent: OutgoingInvoicesForm },
  "incoming-invoices-form":  { label: "СФ входящие",         FormComponent: IncomingInvoicesForm },
  "payment-invoices-form":   { label: "Счета на оплату",     FormComponent: PaymentInvoicesForm },
  "cash-receipt-orders-form":{ label: "ПКО",                 FormComponent: CashReceiptOrdersForm },
  "cash-expense-orders-form":{ label: "РКО",                 FormComponent: CashExpenseOrdersForm },
  "inventory-transfers-form":{ label: "Перемещение ТМЗ",     FormComponent: InventoryTransfersForm },
  "warehouses-form":         { label: "Склады",              FormComponent: WarehousesForm },
  "access-rights-form":      { label: "Права доступа",       FormComponent: AccessRightsForm },
};

// ═══════════════════════════════════════════════════════════════════════════
// Хелперы
// ═══════════════════════════════════════════════════════════════════════════

/** Попытка получить краткое описание из данных формы */
function getDescription(data: Record<string, unknown>): string {
  // Пробуем стандартные поля
  const candidates = [
    "shortName", "displayName", "username", "fullName", "bin",
    "modelName", "documentNumber", "name", "title",
  ];
  const parts: string[] = [];
  for (const field of candidates) {
    const val = data[field];
    if (typeof val === "string" && val.trim()) {
      parts.push(val.trim());
      if (parts.length >= 2) break;
    }
  }
  if (parts.length > 0) return parts.join(" · ");
  // Fallback — количество заполненных полей
  const filled = Object.entries(data).filter(
    ([k, v]) => v !== "" && v !== null && v !== undefined && k !== "id" && k !== "uuid"
  ).length;
  return filled > 0 ? `${filled} полей заполнено` : "Пустая форма";
}

// ═══════════════════════════════════════════════════════════════════════════
// Строка таблицы (виртуальная TDataItem)
// ═══════════════════════════════════════════════════════════════════════════

interface UnsavedRow extends TDataItem {
  id: number;
  uuid: string;
  storageKey: string;
  formName: string;
  formLabel: string;
  entityId: string;
  description: string;
  _entry: FormStoreEntry;
}

function entriesToRows(entries: FormStoreEntry[]): UnsavedRow[] {
  return entries.map((entry, idx) => {
    const mapping = FORM_REGISTRY[entry.formName];
    return {
      id: idx + 1,
      uuid: entry.storageKey, // используем storageKey как uuid
      storageKey: entry.storageKey,
      formName: entry.formName,
      formLabel: mapping?.label ?? entry.formName,
      entityId: entry.entityId,
      description: getDescription(entry.data),
      _entry: entry,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const componentName = "UnsavedFormsList";

const UnsavedFormsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({
  variant = "default",
  onSelectItem,
}) => {
  const appCtx = useAppContext();
  const { addPane } = appCtx.windows;
  const { confirm } = appCtx.actions;
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName));
  const [version, setVersion] = useState(0);

  const rowsRef = useRef<UnsavedRow[]>([]);

  // Загрузка записей из sessionStorage
  const loadEntries = useCallback(() => {
    const entries = getAllFormStoreEntries();
    rowsRef.current = entriesToRows(entries);
    setVersion(v => v + 1);
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const rows = useMemo(() => rowsRef.current, [version]);
  const total = rows.length;

  // Открыть форму с данными из sessionStorage
  const openUnsavedForm = useCallback((row: UnsavedRow) => {
    const mapping = FORM_REGISTRY[row.formName];
    if (!mapping) {
      alert(`Неизвестный тип формы: ${row.formName}`);
      return;
    }

    const { FormComponent, label } = mapping;
    const entryData = row._entry.data;

    // Передаём uuid если это существующая запись (не "new")
    const isNew = row.entityId === "new";
    const paneData = isNew
      ? { ...entryData } as unknown as TDataItem
      : { ...entryData, uuid: row.entityId } as unknown as TDataItem;

    addPane({
      label: `${label}: ${row.description || (isNew ? t("new") : row.entityId)}`,
      component: FormComponent,
      data: paneData,
      onSave: () => loadEntries(),
      onClose: () => loadEntries(),
    });
  }, [addPane, t, loadEntries]);

  // Удалить запись из sessionStorage
  const handleDeleteEntries = useCallback((selectedRows: Set<number>, allRows: TDataItem[]) => {
    const rowsToDelete = allRows.filter((_, idx) => selectedRows.has(idx)) as UnsavedRow[];
    if (rowsToDelete.length === 0) return;
    rowsToDelete.forEach(row => {
      if (row.storageKey) removeFormStoreEntry(row.storageKey);
    });
    loadEntries();
  }, [loadEntries]);

  // Очистить всё
  const handleClearAll = useCallback(async () => {
    if (!(await confirm("Удалить все несохранённые данные форм?"))) return;
    const entries = getAllFormStoreEntries();
    entries.forEach(e => removeFormStoreEntry(e.storageKey));
    loadEntries();
  }, [loadEntries, confirm]);

  // Рендер ячейки "Тип объекта" — как кликабельную ссылку
  const renderCell = useCallback((row: TDataItem, col: TColumn): React.ReactNode | undefined => {
    const unsavedRow = row as UnsavedRow;
    if (col.identifier === "formLabel") {
      return (
        <span
          style={{ color: "var(--color-link, #1976d2)", cursor: "pointer", textDecoration: "underline" }}
          onClick={(e) => { e.stopPropagation(); openUnsavedForm(unsavedRow); }}
          title="Открыть форму с несохранёнными данными"
        >
          {unsavedRow.formLabel}
        </span>
      );
    }
    if (col.identifier === "description") {
      return (
        <span
          style={{ color: "var(--color-link, #1976d2)", cursor: "pointer", textDecoration: "underline" }}
          onClick={(e) => { e.stopPropagation(); openUnsavedForm(unsavedRow); }}
          title="Открыть форму с несохранёнными данными"
        >
          {unsavedRow.description}
        </span>
      );
    }
    return undefined;
  }, [openUnsavedForm]);

  const tableProps = useMemo(() => ({
    variant,
    onSelectItem,
    enableDateRange: false,
    componentName,
    rows,
    columns,
    total,
    totalPages: 1,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    hasNextPage: false,
    isFetchingNextPage: false,
    pagination: { page: 1, limit: 500, onPageChange: () => {}, onLimitChange: () => {} },
    sorting: { sort: { id: "asc" as const }, onSortChange: () => {} },
    filtering: { filters: undefined, onFilterChange: () => {}, onClearAll: () => {} },
    search: { value: "", onChange: () => {} },
    actions: {
      openModelForm: ({ data }: { data?: TDataItem }) => {
        if (data) openUnsavedForm(data as UnsavedRow);
      },
      refetch: loadEntries,
      setColumns,
      fetchNextPage: () => {},
      setAdaptiveLimit: () => {},
    },
    onDelete: handleDeleteEntries,
    renderCell,
  }), [variant, onSelectItem, rows, columns, total, openUnsavedForm, loadEntries, renderCell, handleDeleteEntries]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Доп. панель */}
      <div className={styles.FormPanel} style={{ padding: "4px 8px" }}>
        <div className={styles.TablePanelLeft}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
            <ButtonImage onClick={loadEntries} title="Обновить">
              <img src={reload_16} alt="Reload" height={16} width={16} />
            </ButtonImage>
            <Divider />
            {total > 0 && (
              <Button variant="danger" onClick={handleClearAll}>
                <span>Очистить всё ({total})</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center", color: "#999", fontSize: "14px" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>✓</div>
          <div>Нет несохранённых данных форм</div>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#bbb" }}>
            Здесь появятся формы, данные которых не были сохранены (например, после обновления страницы)
          </div>
        </div>
      ) : (
        <Table {...tableProps} />
      )}
    </div>
  );
};

UnsavedFormsList.displayName = "UnsavedFormsList";
export { UnsavedFormsList };
