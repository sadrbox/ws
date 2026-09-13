/**
 * Утилита для перехода к форме документа по ссылке (endpoint + uuid).
 * Используется в центрах уведомлений для навигации к источнику уведомления.
 *
 * Каждый endpoint соответствует форме модели. Компоненты загружаются лениво
 * (динамический import), чтобы не тянуть весь граф зависимостей при старте.
 */
import type { TPane } from "src/app/types";
import { loadLazyComponent, type LazyComponentEntry } from "src/utils/lazyComponent";
import { getByEndpoint } from "src/registry/modelRegistry";
import { translate } from "src/i18";

type AddPane = (pane: Partial<TPane>) => void;

const FORM_REGISTRY: Record<string, LazyComponentEntry> = {
	sales: { loader: () => import("src/models/Sales"), key: "SalesForm" },
	purchases: {
		loader: () => import("src/models/Purchases"),
		key: "PurchasesForm",
	},
	contacts: {
		loader: () => import("src/models/Contacts"),
		key: "ContactsForm",
	},
	bankaccounts: {
		loader: () => import("src/models/BankAccounts"),
		key: "BankAccountsForm",
	},
	contracts: {
		loader: () => import("src/models/Contracts"),
		key: "ContractsForm",
	},
	counterparties: {
		loader: () => import("src/models/Counterparties"),
		key: "CounterpartiesForm",
	},
	organizations: {
		loader: () => import("src/models/Organizations"),
		key: "OrganizationsForm",
	},
	employees: {
		loader: () => import("src/models/Employees"),
		key: "EmployeesForm",
	},
	contactpersons: {
		loader: () => import("src/models/ContactPersons"),
		key: "ContactPersonsForm",
	},
	inventorytransfers: {
		loader: () => import("src/models/InventoryTransfers"),
		key: "InventoryTransfersForm",
	},
	cashreceiptorders: {
		loader: () => import("src/models/CashReceiptOrders"),
		key: "CashReceiptOrdersForm",
	},
};

/**
 * ОБЪЕКТЫ 1С — не записи ERP: у них нет формы в реестре моделей, а «идентификатор» — ключ базы,
 * пара «база|пользователь» или id агента. Открываются теми же карточками, что и из панели.
 */
const ONEC_OPENERS: Record<string, (uuid: string, label?: string) => Promise<Partial<TPane> | null>> = {
	"onec-bases": async (key) => {
		const m = await import("src/models/OneCBases");
		return { component: m.OneCBasesForm as never, data: { baseKey: key } as never, label: `${translate("onecBase")}: ${key}` };
	},
	"onec-base-users": async (id) => {
		const cut = id.indexOf("|");
		const baseKey = cut > 0 ? id.slice(0, cut) : "";
		const userName = cut > 0 ? id.slice(cut + 1) : "";
		if (!baseKey || !userName) return null;
		const m = await import("src/models/OneCAdmin/BaseUserForm");
		return {
			component: m.default as never, data: { userName, baseKey } as never,
			label: `${translate("onecBaseUserCard")}: ${userName} — ${baseKey}`,
		};
	},
	"onec-agents": async (agentId, label) => {
		const m = await import("src/models/OneCAdmin/AgentForm");
		return {
			component: m.AgentForm as never, data: { agentId } as never,
			label: `${translate("onecTabAgents")}: ${label || agentId.slice(0, 8)}`,
		};
	},
};

/**
 * Открывает форму объекта в новой панели по endpoint и uuid (уже открытую — активирует).
 * Порядок: объекты 1С → формы этого модуля → общий реестр форм. Неизвестный endpoint — ничего.
 */
export async function openFormByRef(
	ref: { endpoint: string; uuid: string; label?: string },
	addPane: AddPane,
	paneLabel?: string,
): Promise<void> {
	const key = ref.endpoint.toLowerCase();
	const onec = ONEC_OPENERS[key];
	if (onec) {
		const pane = await onec(ref.uuid, ref.label);
		if (pane) addPane(pane);
		return;
	}
	const entry = FORM_REGISTRY[key];
	if (!entry) {
		// Любая запись из реестра моделей: справочники, документы, настройки.
		if (getByEndpoint(ref.endpoint)) {
			const { openFormByEndpoint } = await import("src/registry/formRegistry");
			await openFormByEndpoint(ref.endpoint, ref.uuid, addPane);
		}
		return;
	}
	const Component = await loadLazyComponent(entry);
	if (!Component) return;
	addPane({
		component: Component,
		data: { uuid: ref.uuid },
		label: paneLabel ?? ref.endpoint,
	});
}

/** true если объект этого вида можно открыть по ссылке */
export function canOpenByRef(endpoint: string): boolean {
	const key = endpoint.toLowerCase();
	return key in ONEC_OPENERS || key in FORM_REGISTRY || !!getByEndpoint(endpoint);
}
