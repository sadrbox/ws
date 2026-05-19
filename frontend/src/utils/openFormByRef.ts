/**
 * Утилита для перехода к форме документа по ссылке (endpoint + uuid).
 * Используется в центрах уведомлений для навигации к источнику уведомления.
 *
 * Каждый endpoint соответствует форме модели. Компоненты загружаются лениво
 * (динамический import), чтобы не тянуть весь граф зависимостей при старте.
 */
import type { FC } from "react";
import type { TPane } from "src/app/types";

type AddPane = (pane: Partial<TPane>) => void;

interface FormEntry {
	loader: () => Promise<Record<string, FC<any>>>;
	key: string;
}

const FORM_REGISTRY: Record<string, FormEntry> = {
	sales:          { loader: () => import("src/models/Sales"), key: "SalesForm" },
	purchases:      { loader: () => import("src/models/Purchases"), key: "PurchasesForm" },
	contacts:       { loader: () => import("src/models/Contacts"), key: "ContactsForm" },
	bankaccounts:   { loader: () => import("src/models/BankAccounts"), key: "BankAccountsForm" },
	contracts:      { loader: () => import("src/models/Contracts"), key: "ContractsForm" },
	counterparties: { loader: () => import("src/models/Counterparties"), key: "CounterpartiesForm" },
	organizations:  { loader: () => import("src/models/Organizations"), key: "OrganizationsForm" },
	employees:      { loader: () => import("src/models/Employees"), key: "EmployeesForm" },
	contactpersons: { loader: () => import("src/models/ContactPersons"), key: "ContactPersonsForm" },
	inventorytransfers: { loader: () => import("src/models/InventoryTransfers"), key: "InventoryTransfersForm" },
	cashreceiptorders: { loader: () => import("src/models/CashReceiptOrders"), key: "CashReceiptOrdersForm" },
};

/**
 * Открывает форму документа в новой панели по endpoint и uuid.
 * Если endpoint неизвестен — ничего не делает.
 */
export async function openFormByRef(
	ref: { endpoint: string; uuid: string },
	addPane: AddPane,
	paneLabel?: string,
): Promise<void> {
	const entry = FORM_REGISTRY[ref.endpoint.toLowerCase()];
	if (!entry) return;
	try {
		const mod = await entry.loader();
		const Component = mod[entry.key] as FC<any> | undefined;
		if (!Component) return;
		addPane({
			component: Component,
			data: { uuid: ref.uuid },
			label: paneLabel ?? ref.endpoint,
		});
	} catch {
		// Если модуль не загрузился — игнорируем
	}
}

/** true если для endpoint зарегистрирована форма */
export function canOpenByRef(endpoint: string): boolean {
	return endpoint.toLowerCase() in FORM_REGISTRY;
}
