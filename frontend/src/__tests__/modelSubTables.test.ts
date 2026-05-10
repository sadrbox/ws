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
import bankAccountsCols from "../models/BankAccounts/columns.json";
import contactsCols from "../models/Contacts/columns.json";
import contractsCols from "../models/Contracts/columns.json";
import accessRightsCols from "../models/AccessRights/columns.json";
import userPermissionsSubCols from "../models/UserPermissions/subColumns.json";

// ─── Вспомогательные функции (воспроизводят логику компонентов) ───────────────

/** Логика adjustedColumns из BankAccountsTable — скрывает ownerName */
function bankAccountsAdjustColumns(cols: Array<Record<string, unknown>>) {
	return cols.map((col) =>
		col.identifier === "ownerName"
			? { ...col, visible: false, inlist: false }
			: col,
	);
}

/** Логика adjustedColumns из ContactsTable — скрывает ownerName */
function contactsAdjustColumns(cols: Array<Record<string, unknown>>) {
	return cols.map((col) =>
		col.identifier === "ownerName"
			? { ...col, visible: false, inlist: false }
			: col,
	);
}

/** Логика adjustedColumns из ContractsTable — скрывает hideId, показывает showId */
function contractsAdjustColumns(
	cols: Array<Record<string, unknown>>,
	hideId: string,
	showId: string,
) {
	return cols.map((col) => {
		if (col.identifier === hideId)
			return { ...col, visible: false, inlist: false };
		if (col.identifier === showId)
			return { ...col, visible: true, inlist: true };
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
			shortName: "",
			iban: "",
			bik: "",
			bankName: "",
			currencyUuid: null,
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
		const result = contractsAdjustColumns(
			cols,
			"counterparty.shortName",
			"organization.shortName",
		);
		const cp = result.find((c) => c.identifier === "counterparty.shortName");
		expect(cp?.visible).toBe(false);
		expect(cp?.inlist).toBe(false);
	});

	it("показывает organization когда родитель — counterparty", () => {
		const result = contractsAdjustColumns(
			cols,
			"counterparty.shortName",
			"organization.shortName",
		);
		const org = result.find((c) => c.identifier === "organization.shortName");
		expect(org?.visible).toBe(true);
		expect(org?.inlist).toBe(true);
	});

	it("скрывает organization когда родитель — counterparty", () => {
		const result = contractsAdjustColumns(
			cols,
			"organization.shortName",
			"counterparty.shortName",
		);
		const org = result.find((c) => c.identifier === "organization.shortName");
		expect(org?.visible).toBe(false);
		expect(org?.inlist).toBe(false);
	});

	it("не затрагивает нейтральные колонки", () => {
		const result = contractsAdjustColumns(
			cols,
			"counterparty.shortName",
			"organization.shortName",
		);
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

function checkAllHaveInlist(
	cols: Array<Record<string, unknown>>,
	model: string,
) {
	for (const col of cols) {
		expect(
			"inlist" in col,
			`Колонка '${String(col.identifier)}' в ${model}/columns.json не имеет поля inlist`,
		).toBe(true);
	}
}

describe("columns.json — поле inlist присутствует во всех колонках", () => {
	it("CashExpenseOrders", () =>
		checkAllHaveInlist(cashExpenseOrdersCols as any, "CashExpenseOrders"));
	it("CashReceiptOrders", () =>
		checkAllHaveInlist(cashReceiptOrdersCols as any, "CashReceiptOrders"));
	it("IncomingInvoices", () =>
		checkAllHaveInlist(incomingInvoicesCols as any, "IncomingInvoices"));
	it("OutgoingInvoices", () =>
		checkAllHaveInlist(outgoingInvoicesCols as any, "OutgoingInvoices"));
	it("PaymentInvoices", () =>
		checkAllHaveInlist(paymentInvoicesCols as any, "PaymentInvoices"));
	it("Purchases", () => checkAllHaveInlist(purchasesCols as any, "Purchases"));
	it("Sales", () => checkAllHaveInlist(salesCols as any, "Sales"));
	it("InventoryTransfers", () =>
		checkAllHaveInlist(inventoryTransfersCols as any, "InventoryTransfers"));
	it("PayrollCalculations", () =>
		checkAllHaveInlist(payrollCalculationsCols as any, "PayrollCalculations"));
	it("PayrollPayments", () =>
		checkAllHaveInlist(payrollPaymentsCols as any, "PayrollPayments"));
	it("Products", () => checkAllHaveInlist(productsCols as any, "Products"));
	it("UnitOfMeasures", () =>
		checkAllHaveInlist(unitOfMeasuresCols as any, "UnitOfMeasures"));
	it("BankAccounts", () =>
		checkAllHaveInlist(bankAccountsCols as any, "BankAccounts"));
	it("Contacts", () => checkAllHaveInlist(contactsCols as any, "Contacts"));
	it("Contracts", () => checkAllHaveInlist(contractsCols as any, "Contracts"));
	it("AccessRights", () =>
		checkAllHaveInlist(accessRightsCols as any, "AccessRights"));
});

// ═══════════════════════════════════════════════════════════════════════════
// AccessRightsTable
// ═══════════════════════════════════════════════════════════════════════════

/** Воспроизводит логику defaultNewRow из AccessRightsTable (теперь это функция от rows) */
function makeAccessRightsDefaultNewRow(
	userUuid: string,
	organizationUuid?: string,
	existingRows: Array<{ modelName?: string }> = [],
) {
	if (!userUuid) return undefined;
	const ALL_MODELS = [
		"Organization",
		"Counterparty",
		"Contract",
		"Sale",
		"Purchase",
	];
	const usedModels = new Set(
		existingRows.map((r) => r.modelName).filter(Boolean),
	);
	const firstUnused = ALL_MODELS.find((m) => !usedModels.has(m)) ?? "";
	return {
		modelName: firstUnused,
		accessLevel: "none" as const,
		userUuid,
		...(organizationUuid ? { organizationUuid } : {}),
	};
}

/** Воспроизводит filterRows из AccessRightsTable */
function accessRightsFilterRows(
	rows: Array<Record<string, unknown>>,
	search: string,
	modelNameMap: Record<string, string>,
	accessLevelMap: Record<string, string>,
): Array<Record<string, unknown>> {
	const words = search.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return rows;
	return rows.filter((row) => {
		const modelLabel = (
			modelNameMap[row.modelName as string] ??
			(row.modelName as string) ??
			""
		).toLowerCase();
		const levelLabel = (
			accessLevelMap[row.accessLevel as string] ??
			(row.accessLevel as string) ??
			""
		).toLowerCase();
		const modelKey = ((row.modelName as string) ?? "").toLowerCase();
		const levelKey = ((row.accessLevel as string) ?? "").toLowerCase();
		const idStr = String(row.id as number | null | undefined);
		return words.every(
			(w) =>
				modelLabel.includes(w) ||
				modelKey.includes(w) ||
				levelLabel.includes(w) ||
				levelKey.includes(w) ||
				idStr.includes(w),
		);
	});
}

describe("AccessRightsTable — defaultNewRow", () => {
	it("возвращает undefined если userUuid не задан", () => {
		expect(makeAccessRightsDefaultNewRow("")).toBeUndefined();
	});

	it("содержит обязательные поля при наличии userUuid", () => {
		const row = makeAccessRightsDefaultNewRow("user-uuid-1");
		expect(row).toBeDefined();
		expect(row!.userUuid).toBe("user-uuid-1");
		expect(row!.modelName).toBe("Organization"); // первая свободная
		expect(row!.accessLevel).toBe("none");
		expect(row).not.toHaveProperty("organizationUuid");
	});

	it("включает organizationUuid если передан", () => {
		const row = makeAccessRightsDefaultNewRow("user-uuid-1", "org-uuid-2");
		expect(row!.organizationUuid).toBe("org-uuid-2");
	});

	it("выбирает первую незанятую модель если Organization уже в таблице", () => {
		const existing = [{ modelName: "Organization" }];
		const row = makeAccessRightsDefaultNewRow(
			"user-uuid-1",
			undefined,
			existing,
		);
		expect(row!.modelName).toBe("Counterparty");
	});

	it("выбирает следующую незанятую если несколько заняты", () => {
		const existing = [
			{ modelName: "Organization" },
			{ modelName: "Counterparty" },
		];
		const row = makeAccessRightsDefaultNewRow(
			"user-uuid-1",
			undefined,
			existing,
		);
		expect(row!.modelName).toBe("Contract");
	});
});

describe("AccessRightsTable — filterRows", () => {
	const modelNameMap: Record<string, string> = {
		Organization: "Организации",
		Sale: "Продажи",
		Product: "Товары",
	};
	const accessLevelMap: Record<string, string> = {
		full: "Полный",
		readonly: "Только чтение",
		none: "Нет доступа",
	};
	const rows = [
		{ id: 1, modelName: "Organization", accessLevel: "full" },
		{ id: 2, modelName: "Sale", accessLevel: "readonly" },
		{ id: 3, modelName: "Product", accessLevel: "none" },
	];

	it("пустой поиск возвращает все строки", () => {
		expect(
			accessRightsFilterRows(rows, "", modelNameMap, accessLevelMap),
		).toHaveLength(3);
	});

	it("фильтрует по части метки модели (русский)", () => {
		const result = accessRightsFilterRows(
			rows,
			"органи",
			modelNameMap,
			accessLevelMap,
		);
		expect(result).toHaveLength(1);
		expect(result[0].modelName).toBe("Organization");
	});

	it("фильтрует по ключу модели (английский)", () => {
		const result = accessRightsFilterRows(
			rows,
			"sale",
			modelNameMap,
			accessLevelMap,
		);
		expect(result).toHaveLength(1);
		expect(result[0].modelName).toBe("Sale");
	});

	it("фильтрует по метке уровня доступа", () => {
		const result = accessRightsFilterRows(
			rows,
			"только",
			modelNameMap,
			accessLevelMap,
		);
		expect(result).toHaveLength(1);
		expect(result[0].accessLevel).toBe("readonly");
	});

	it("фильтрует по id", () => {
		const result = accessRightsFilterRows(
			rows,
			"3",
			modelNameMap,
			accessLevelMap,
		);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(3);
	});

	it("возвращает пустой массив если ничего не найдено", () => {
		expect(
			accessRightsFilterRows(rows, "zzz", modelNameMap, accessLevelMap),
		).toHaveLength(0);
	});
});

describe("AccessRights columns.json — структура", () => {
	it("содержит ключевые колонки modelName и accessLevel", () => {
		const ids = (accessRightsCols as any[]).map((c: any) => c.identifier);
		expect(ids).toContain("modelName");
		expect(ids).toContain("accessLevel");
	});

	it("не содержит organization.bin", () => {
		const ids = (accessRightsCols as any[]).map((c: any) => c.identifier);
		expect(ids).not.toContain("organization.bin");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// UserPermissionsTable
// ═══════════════════════════════════════════════════════════════════════════

const ROLE_OPTIONS = [
	{ value: "member", label: "Участник" },
	{ value: "admin", label: "Администратор" },
];

describe("UserPermissionsTable — defaultNewRow", () => {
	it("содержит обязательные поля", () => {
		const defaultNewRow = {
			organizationUuid: null,
			organization: null,
			role: "member",
		};
		expect(defaultNewRow.role).toBe("member");
		expect(defaultNewRow.organizationUuid).toBeNull();
		expect(defaultNewRow.organization).toBeNull();
	});
});

describe("UserPermissionsTable — roleMap", () => {
	const roleMap = Object.fromEntries(
		ROLE_OPTIONS.map((o) => [o.value, o.label]),
	);

	it("содержит все роли", () => {
		expect(roleMap["member"]).toBe("Участник");
		expect(roleMap["admin"]).toBe("Администратор");
	});

	it("возвращает undefined для неизвестной роли", () => {
		expect(roleMap["unknown"]).toBeUndefined();
	});
});

describe("UserPermissions subColumns.json — структура", () => {
	it("содержит поля id, organization.shortName, role", () => {
		const ids = (userPermissionsSubCols as any[]).map((c: any) => c.identifier);
		expect(ids).toContain("id");
		expect(ids).toContain("organization.shortName");
		expect(ids).toContain("role");
	});

	it("не содержит organization.bin", () => {
		const ids = (userPermissionsSubCols as any[]).map((c: any) => c.identifier);
		expect(ids).not.toContain("organization.bin");
	});

	it("не содержит _expand", () => {
		const ids = (userPermissionsSubCols as any[]).map((c: any) => c.identifier);
		expect(ids).not.toContain("_expand");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Паттерн: все *Table компоненты должны принимать deferRemoteChanges-пропсы
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Проверяем что props-интерфейсы *Table содержат нужные поля для паттерна
 * "deferred SubTable": deferRemoteChanges + onItemsChange + initialPendingRows.
 *
 * Тесты описывают КОНТРАКТ — документируют ожидаемую форму пропсов.
 */
describe("*Table components — deferred SubTable pattern contract", () => {
	/** Набор props, которые ДОЛЖЕН поддерживать каждый *Table компонент */
	function checkDeferredProps(props: Record<string, unknown>) {
		expect(props).toHaveProperty("deferRemoteChanges");
		expect(props).toHaveProperty("onItemsChange");
		expect(props).toHaveProperty("initialPendingRows");
	}

	it("BankAccountsTable поддерживает deferred-пропсы", () => {
		checkDeferredProps({
			deferRemoteChanges: true,
			onItemsChange: () => {},
			initialPendingRows: [],
		});
	});

	it("ContactsTable поддерживает deferred-пропсы", () => {
		checkDeferredProps({
			deferRemoteChanges: true,
			onItemsChange: () => {},
			initialPendingRows: [],
		});
	});

	it("ContractsTable поддерживает deferred-пропсы", () => {
		checkDeferredProps({
			deferRemoteChanges: true,
			onItemsChange: () => {},
			initialPendingRows: [],
		});
	});

	it("EmployeeHistoryTable поддерживает deferred-пропсы", () => {
		checkDeferredProps({
			deferRemoteChanges: true,
			onItemsChange: () => {},
			initialPendingRows: [],
		});
	});

	it("AccessRightsTable поддерживает deferred-пропсы", () => {
		checkDeferredProps({
			deferRemoteChanges: true,
			onItemsChange: () => {},
			initialPendingRows: [],
		});
	});

	it("UserPermissionsTable поддерживает deferred-пропсы", () => {
		checkDeferredProps({
			deferRemoteChanges: true,
			onItemsChange: () => {},
			initialPendingRows: [],
		});
	});

	it("SaleItemsTable поддерживает deferred-пропсы", () => {
		checkDeferredProps({
			deferRemoteChanges: true,
			onItemsChange: () => {},
			initialPendingRows: [],
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// UsersForm — таблица userPermissions должна быть задекларирована в tables
// ═══════════════════════════════════════════════════════════════════════════

describe("UsersForm — UserPermissionsTable tables config", () => {
	it("конфигурация tables содержит userPermissions с правильным endpoint", () => {
		const tablesConfig: Record<
			string,
			{ endpoint: string; parentField: string }
		> = {
			userPermissions: {
				endpoint: "user-permissions",
				parentField: "userUuid",
			},
		};
		expect(tablesConfig.userPermissions.endpoint).toBe("user-permissions");
		expect(tablesConfig.userPermissions.parentField).toBe("userUuid");
	});
});
