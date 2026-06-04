/**
 * Утилита для открытия отчёта по строковому ключу.
 *
 * Отчёт — это компонент-панель без записи (нет uuid/id), поэтому, в отличие от
 * openFormByRef, здесь ничего не загружается с сервера: компонент просто
 * монтируется как новая панель через addPane. Компоненты импортируются лениво
 * (динамический import), чтобы не тянуть граф отчётов при старте приложения.
 *
 * Использование:
 *   await openReport("material-statement", addPane);
 *   await openReport("product-detail", addPane, undefined, { productUuid, productName });
 */
import type { TPane } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import { translate } from "src/i18";
import { loadLazyComponent, type LazyComponentEntry } from "src/utils/lazyComponent";

type AddPane = (pane: Partial<TPane>) => void;

interface ReportEntry extends LazyComponentEntry {
	/** Ключ перевода для заголовка панели по умолчанию. */
	labelKey: string;
}

const REPORT_REGISTRY: Record<string, ReportEntry> = {
	"sales-report": {
		loader: () => import("src/models/Reports/SalesReport"),
		key: "SalesReport",
		labelKey: "SalesReportList",
	},
	"material-statement": {
		loader: () => import("src/models/Reports/MaterialStatement"),
		key: "MaterialStatement",
		labelKey: "MaterialStatementList",
	},
	"cash-report": {
		loader: () => import("src/models/Reports/CashReport"),
		key: "CashReport",
		labelKey: "CashReportList",
	},
	"manager-report": {
		loader: () => import("src/models/Reports/ManagerReport"),
		key: "ManagerReport",
		labelKey: "managerReport",
	},
	"product-register": {
		loader: () => import("src/models/Reports/ProductRegisterReport"),
		key: "ProductRegisterReport",
		labelKey: "ProductRegisterList",
	},
	"product-detail": {
		loader: () => import("src/models/Reports/ProductDetailReport"),
		key: "ProductDetailReport",
		labelKey: "reportProductMovements",
	},
	"accounting-journal": {
		loader: () => import("src/models/Reports/AccountingJournal"),
		key: "AccountingJournal",
		labelKey: "accountingJournalTitle",
	},
	"accounting-osv": {
		loader: () => import("src/models/Reports/TurnoverBalanceSheet"),
		key: "TurnoverBalanceSheet",
		labelKey: "osvTitle",
	},
	"account-card": {
		loader: () => import("src/models/Reports/AccountCard"),
		key: "AccountCard",
		labelKey: "accountCardTitle",
	},
	"settlements": {
		loader: () => import("src/models/Reports/SettlementsReport"),
		key: "SettlementsReport",
		labelKey: "settlementsReport",
	},
	"inventory-turnover": {
		loader: () => import("src/models/Reports/InventoryTurnoverReport"),
		key: "InventoryTurnoverReport",
		labelKey: "inventoryTurnover",
	},
	"abc-analysis": {
		loader: () => import("src/models/Reports/ABCReport"),
		key: "ABCReport",
		labelKey: "abcAnalysis",
	},
};

/**
 * Открывает отчёт в новой панели по ключу. Если ключ неизвестен — ничего не делает.
 *
 * @param key       — ключ отчёта (см. REPORT_REGISTRY)
 * @param addPane   — функция добавления панели из AppContext
 * @param paneLabel — необязательный заголовок панели (по умолчанию — перевод из реестра)
 * @param data      — необязательный сид параметров (например { productUuid } для product-detail)
 */
export async function openReport(
	key: string,
	addPane: AddPane,
	paneLabel?: string,
	data?: Partial<TDataItem>,
): Promise<void> {
	const entry = REPORT_REGISTRY[key.toLowerCase()];
	if (!entry) return;
	const Component = await loadLazyComponent(entry);
	if (!Component) return;
	addPane({
		component: Component,
		label: paneLabel ?? translate(entry.labelKey),
		...(data ? { data } : {}),
		restore: { kind: "report", key: key.toLowerCase(), ...(data ? { data } : {}) },
	});
}

/** true, если для ключа зарегистрирован отчёт. */
export function canOpenReport(key: string): boolean {
	return key.toLowerCase() in REPORT_REGISTRY;
}

/** Список доступных ключей отчётов (для меню/навигации). */
export function getReportKeys(): string[] {
	return Object.keys(REPORT_REGISTRY);
}
