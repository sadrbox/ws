import { FC, useCallback, useEffect, useState } from "react";
import { useAppContext } from "src/app";
import type { TPane } from "src/app/types";

/**
 * SelectPaneWrapper — обёртка для отображения List-компонента
 * внутри Pane как форму выбора.
 *
 * Получает:
 *  - data.endpoint — для динамической загрузки List-компонента
 *  - data.listComponent — готовый компонент списка (опционально)
 *  - onSelectResult — callback при выборе элемента (двойной клик)
 *  - uniqId — для закрытия панели после выбора
 *
 * Логика:
 *  1. Лениво загружает List-компонент по endpoint (как LookupSelectModal)
 *  2. Рендерит его с variant="default" + onSelectItem
 *  3. При onSelectItem → вызывает onSelectResult, закрывает pane
 *  4. Кнопки Добавить/Удалить в Table работают как обычно (openModelForm через addPane)
 *  5. После закрытия дочерней формы — система вернёт фокус на эту selector-панель
 */

// Реестр загрузчиков List-компонентов (тот же, что в LookupField)
const listComponentRegistry: Record<string, () => Promise<any>> = {
  organizations: () => import("src/models/Organizations"),
  counterparties: () => import("src/models/Counterparties"),
  contacttypes: () => import("src/models/ContactTypes"),
  contactpersons: () => import("src/models/ContactPersons"),
  contacts: () => import("src/models/Contacts"),
  contracts: () => import("src/models/Contracts"),
  bankaccounts: () => import("src/models/BankAccounts"),
  users: () => import("src/models/Users"),
  activityhistories: () => import("src/models/ActivityHistories"),
  todos: () => import("src/models/Todos"),
  notifications: () => import("src/models/Notifications"),
  brands: () => import("src/models/Brands"),
  products: () => import("src/models/Products"),
  currencies: () => import("src/models/Currencies"),
  employees: () => import("src/models/Employees"),
  positions: () => import("src/models/Positions"),
  warehouses: () => import("src/models/Warehouses"),
  sales: () => import("src/models/Sales"),
  purchases: () => import("src/models/Purchases"),
  "incoming-invoices": () => import("src/models/IncomingInvoices"),
  "outgoing-invoices": () => import("src/models/OutgoingInvoices"),
  "payment-invoices": () => import("src/models/PaymentInvoices"),
  "cash-receipt-orders": () => import("src/models/CashReceiptOrders"),
  "cash-expense-orders": () => import("src/models/CashExpenseOrders"),
  "inventory-transfers": () => import("src/models/InventoryTransfers"),
  "scheduled-tasks": () => import("src/models/ScheduledTasks"),
  "access-rights": () => import("src/models/AccessRights"),
};

const listComponentNameMap: Record<string, string> = {
  organizations: "OrganizationsList",
  counterparties: "CounterpartiesList",
  contacttypes: "ContactTypesList",
  contactpersons: "ContactPersonsList",
  contacts: "ContactsList",
  contracts: "ContractsList",
  bankaccounts: "BankAccountsList",
  users: "UsersList",
  activityhistories: "ActivityHistoriesList",
  todos: "TodosList",
  notifications: "NotificationsList",
  brands: "BrandsList",
  products: "ProductsList",
  currencies: "CurrenciesList",
  employees: "EmployeesList",
  positions: "PositionsList",
  warehouses: "WarehousesList",
  sales: "SalesList",
  purchases: "PurchasesList",
  "incoming-invoices": "IncomingInvoicesList",
  "outgoing-invoices": "OutgoingInvoicesList",
  "payment-invoices": "PaymentInvoicesList",
  "cash-receipt-orders": "CashReceiptOrdersList",
  "cash-expense-orders": "CashExpenseOrdersList",
  "inventory-transfers": "InventoryTransfersList",
  "scheduled-tasks": "ScheduledTasksList",
  "access-rights": "AccessRightsList",
};

const SelectPaneWrapper: FC<Partial<TPane>> = ({ data, onSelectResult, uniqId }) => {
  const { windows: { removePane } } = useAppContext();

  const endpoint = (data as any)?.endpoint as string | undefined;
  const ListComponentProp = (data as any)?.listComponent as FC<any> | undefined;
  const extraParams = (data as any)?.extraParams as Record<string, string> | undefined;

  const [ResolvedList, setResolvedList] = useState<FC<any> | null>(ListComponentProp || null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (ListComponentProp) {
      setResolvedList(() => ListComponentProp);
      return;
    }
    if (!endpoint) {
      setLoadError("endpoint не указан");
      return;
    }
    const loader = listComponentRegistry[endpoint];
    if (!loader) {
      setLoadError(`Неизвестный endpoint: ${endpoint}`);
      return;
    }
    let cancelled = false;
    loader().then((mod) => {
      if (cancelled) return;
      const listName = listComponentNameMap[endpoint];
      const ListComp = mod[listName] || mod.default;
      if (ListComp) {
        setResolvedList(() => ListComp);
      } else {
        setLoadError(`Компонент ${listName} не найден в модуле`);
      }
    }).catch((err) => {
      if (!cancelled) setLoadError(err?.message || "Ошибка загрузки модуля");
    });
    return () => { cancelled = true; };
  }, [endpoint, ListComponentProp]);

  const handleSelectItem = useCallback((item: Record<string, any>) => {
    onSelectResult?.(item);
    if (uniqId) removePane(uniqId);
  }, [onSelectResult, uniqId, removePane]);

  const handleCancel = useCallback(() => {
    if (uniqId) removePane(uniqId);
  }, [uniqId, removePane]);

  if (loadError) {
    return (
      <div style={{ padding: "24px" }}>
        <div style={{ color: "red", padding: "16px", background: "#ffebee", borderRadius: 4 }}>{loadError}</div>
        <button onClick={handleCancel} style={{ marginTop: 12, padding: "6px 16px", cursor: "pointer" }}>Закрыть</button>
      </div>
    );
  }

  if (!ResolvedList) {
    return <div style={{ padding: "24px", textAlign: "center", color: "#888" }}>Загрузка...</div>;
  }

  return <ResolvedList variant="default" onSelectItem={handleSelectItem} extraParams={extraParams} />;
};

SelectPaneWrapper.displayName = "SelectPaneWrapper";
export default SelectPaneWrapper;
