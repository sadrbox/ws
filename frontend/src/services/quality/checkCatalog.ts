// Каталог проверок учёта в базах 1С (E17 СК2) — зеркало CHECK_CATALOG из
// backend/services/quality/findingRules.js: код проверки, участок панели главбуха, пункт стандарта.
//
// ЗАЧЕМ ЗЕРКАЛО. Сервер отдаёт подпись проверки (checkTitle) только по-русски, а экранам нужна
// подпись на языке интерфейса и список проверок ДО того, как пришла первая находка (выбор
// привязки пункта чек-листа, отбор списка находок). Коды и участки обязаны совпадать с сервером —
// это сторожит тест qualityCheckCatalog.test.ts (сверяет с backend-файлом).
//
// Проверка, которой здесь нет (1С добавила новую), показывается подписью сервера или кодом и
// попадает на участок по префиксу кода — так же, как у сервера (areaOf).
import { translate } from "src/i18";

/** Участки панели главбуха (п. 29) — в порядке колонок панели. */
export const QUALITY_AREAS = ["reconciliation", "debts", "bank", "documents", "catalogs", "taxes", "stock", "fixedAssets"] as const;
export type QualityArea = (typeof QUALITY_AREAS)[number];

/** Ключи перевода подписей участков. */
export const AREA_LABEL_KEYS: Record<QualityArea, string> = {
	reconciliation: "qualityAreaReconciliation",
	debts: "qualityAreaDebts",
	bank: "qualityAreaBank",
	documents: "qualityAreaDocuments",
	catalogs: "qualityAreaCatalogs",
	taxes: "qualityAreaTaxes",
	stock: "qualityAreaStock",
	fixedAssets: "qualityAreaFixedAssets",
};

export interface CheckCatalogEntry {
	/** Код проверки из контракта с 1С (docs/TASK_EXTENSION_ACCOUNTING_CHECKS_2026-09-25.md). */
	code: string;
	/** Ключ перевода подписи. */
	titleKey: string;
	/** Участок панели главбуха. */
	area: QualityArea;
	/** Пункт стандарта (null — подсказка, а не нарушение). */
	item: number | null;
}

export const CHECK_CATALOG: readonly CheckCatalogEntry[] = [
	{ code: "documents.unposted", titleKey: "checkDocumentsUnposted", area: "documents", item: 14 },
	{ code: "documents.deletion_marked", titleKey: "checkDocumentsDeletionMarked", area: "documents", item: 14 },
	{ code: "documents.duplicates", titleKey: "checkDocumentsDuplicates", area: "documents", item: 14 },
	{ code: "documents.anomalies", titleKey: "checkDocumentsAnomalies", area: "documents", item: 14 },
	{ code: "stock.negative", titleKey: "checkStockNegative", area: "stock", item: 12 },
	{ code: "stock.chronology", titleKey: "checkStockChronology", area: "stock", item: 12 },
	{ code: "stock.stale", titleKey: "checkStockStale", area: "stock", item: 16 },
	{ code: "cash.negative", titleKey: "checkCashNegative", area: "bank", item: 12 },
	{ code: "accounts.unnatural_balance", titleKey: "checkAccountsUnnaturalBalance", area: "documents", item: 12 },
	{ code: "settlements.aging", titleKey: "checkSettlementsAging", area: "debts", item: 9 },
	{ code: "settlements.advances_offset", titleKey: "checkSettlementsAdvancesOffset", area: "debts", item: 9 },
	{ code: "catalogs.duplicate_counterparties", titleKey: "checkCatalogsDuplicateCounterparties", area: "catalogs", item: 13 },
	{ code: "catalogs.counterparty_requisites", titleKey: "checkCatalogsCounterpartyRequisites", area: "catalogs", item: 13 },
	{ code: "catalogs.duplicate_contracts", titleKey: "checkCatalogsDuplicateContracts", area: "catalogs", item: 13 },
	{ code: "catalogs.duplicate_products", titleKey: "checkCatalogsDuplicateProducts", area: "catalogs", item: 13 },
	{ code: "ledger.empty_analytics", titleKey: "checkLedgerEmptyAnalytics", area: "catalogs", item: 13 },
	{ code: "counterparties.contacts", titleKey: "checkCounterpartiesContacts", area: "catalogs", item: 10 },
	{ code: "fixed_assets.zero_residual", titleKey: "checkFixedAssetsZeroResidual", area: "fixedAssets", item: 17 },
	{ code: "fixed_assets.not_depreciating", titleKey: "checkFixedAssetsNotDepreciating", area: "fixedAssets", item: 17 },
	{ code: "bank.stale_accounts", titleKey: "checkBankStaleAccounts", area: "bank", item: 18 },
	{ code: "reconciliation.status", titleKey: "checkReconciliationStatus", area: "reconciliation", item: 7 },
	{ code: "esf.sales_without_esf", titleKey: "checkEsfSalesWithoutEsf", area: "taxes", item: 15 },
	{ code: "esf.mismatch", titleKey: "checkEsfMismatch", area: "taxes", item: 15 },
	{ code: "classification.hints", titleKey: "checkClassificationHints", area: "documents", item: null },
	// Служебная запись: база не проверена (агент не ответил, нет каталога, проверки недоступны). Находок у
	// неё нет — только прогон с ошибкой; в выбор проверки не попадает.
	{ code: "_catalog", titleKey: "checkCatalog", area: "documents", item: null },
];

const BY_CODE = new Map(CHECK_CATALOG.map((c) => [c.code, c]));

/** Участок по префиксу кода — для проверок вне каталога (как areaOf на сервере). */
const AREA_BY_PREFIX: Record<string, QualityArea> = {
	documents: "documents", stock: "stock", cash: "bank", bank: "bank", settlements: "debts",
	catalogs: "catalogs", fixed_assets: "fixedAssets", esf: "taxes", reconciliation: "reconciliation",
};

export function findCheck(code: string | null | undefined): CheckCatalogEntry | undefined {
	return code ? BY_CODE.get(code) : undefined;
}

/** Участок проверки: из каталога, иначе по префиксу кода, иначе «документы». */
export function areaOfCheck(code: string | null | undefined): QualityArea {
	const known = findCheck(code);
	if (known) return known.area;
	return AREA_BY_PREFIX[String(code ?? "").split(".")[0]] ?? "documents";
}

/** Коды проверок участка — для отбора списка находок по участку (filter[checkCode][in]). */
export function checkCodesOfArea(area: QualityArea): string[] {
	return CHECK_CATALOG.filter((c) => c.area === area).map((c) => c.code);
}

/**
 * Подпись проверки на языке интерфейса. Нет перевода (новая проверка 1С) — подпись сервера,
 * нет и её — сам код: пустая ячейка хуже кода.
 */
export function checkLabel(code: string | null | undefined, serverTitle?: string | null): string {
	const entry = findCheck(code);
	if (entry) {
		const t = translate(entry.titleKey);
		if (t && t !== entry.titleKey) return t;
	}
	return (serverTitle && serverTitle.trim()) || String(code ?? "");
}

/** Подпись участка на языке интерфейса. */
export function areaLabel(area: QualityArea): string {
	return translate(AREA_LABEL_KEYS[area]);
}

/** Варианты выбора проверки (FieldSelect): пустой вариант — первым. */
export function checkOptions(emptyLabel: string, area?: QualityArea | ""): { value: string; label: string }[] {
	const list = CHECK_CATALOG.filter((c) => !c.code.startsWith("_") && (!area || c.area === area));
	return [{ value: "", label: emptyLabel }, ...list.map((c) => ({ value: c.code, label: checkLabel(c.code) }))];
}
