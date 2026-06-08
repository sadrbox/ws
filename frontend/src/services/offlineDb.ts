/**
 * offlineDb.ts — локальная база данных Dexie (IndexedDB) для offline-first.
 *
 * Зеркалит структуру серверных таблиц Prisma.
 * Каждая таблица индексируется по uuid (уникальный ключ) и updatedAt (для инкрементальной синхронизации).
 *
 * Также содержит служебную таблицу _syncMeta для хранения lastSyncAt на каждую таблицу
 * и _pendingChanges для трекинга локальных изменений, ожидающих push на сервер.
 */

import Dexie, { type EntityTable } from "dexie";

// ═══════════════════════════════════════════════════════════════════════════
// Типы
// ═══════════════════════════════════════════════════════════════════════════

/** Метаданные синхронизации для каждой таблицы */
export interface SyncMeta {
	table: string; // PK — имя таблицы (endpoint)
	lastSyncAt: string; // ISO timestamp последнего pull
	lastPushAt?: string; // ISO timestamp последнего push
	itemCount?: number; // кол-во записей после последнего sync
}

/** Локальное изменение, ожидающее push на сервер */
export interface PendingChange {
	id?: number; // autoIncrement
	table: string; // endpoint таблицы
	uuid: string; // uuid записи
	action: "create" | "update" | "delete";
	data?: Record<string, unknown>; // данные (для create/update)
	clientUpdatedAt: string; // ISO timestamp локального изменения
	createdAt: string; // ISO timestamp создания записи в очереди
}

/** Базовый тип для всех sync-записей */
export interface SyncRecord {
	id?: number;
	uuid: string;
	updatedAt?: string;
	deletedAt?: string | null;
	[key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Маппинг endpoint → имя Dexie-таблицы
// ═══════════════════════════════════════════════════════════════════════════

/** Все sync-enabled endpoint'ы приложения */
export const SYNCABLE_TABLES = [
	"organizations",
	"counterparties",
	"contracts",
	"contacts",
	"contactpersons",
	"bankaccounts",
	"users",
	"todos",
	"warehouses",
	"sales",
	"purchases",
	"outgoing-invoices",
	"incoming-invoices",
	"payment-invoices",
	"scheduled-tasks",
	"inventory-transfers",
	"cash-receipt-orders",
	"cash-expense-orders",
	"brands",
	"products",
	"saleitems",
	"employees",
	"positions",
	"employee-histories",
	"user-access-rights",
	"currencies",
	"payroll-calculations",
	"payroll-payments",
] as const;

export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

// ═══════════════════════════════════════════════════════════════════════════
// Dexie Database
// ═══════════════════════════════════════════════════════════════════════════

class OfflineDatabase extends Dexie {
	// ── Служебные таблицы ──
	_syncMeta!: EntityTable<SyncMeta, "table">;
	_pendingChanges!: EntityTable<PendingChange, "id">;

	// ── Бизнес-таблицы ──
	organizations!: EntityTable<SyncRecord, "id">;
	counterparties!: EntityTable<SyncRecord, "id">;
	contracts!: EntityTable<SyncRecord, "id">;
	contacts!: EntityTable<SyncRecord, "id">;
	contactpersons!: EntityTable<SyncRecord, "id">;
	bankaccounts!: EntityTable<SyncRecord, "id">;
	users!: EntityTable<SyncRecord, "id">;
	todos!: EntityTable<SyncRecord, "id">;
	notifications!: EntityTable<SyncRecord, "id">;
	warehouses!: EntityTable<SyncRecord, "id">;
	sales!: EntityTable<SyncRecord, "id">;
	purchases!: EntityTable<SyncRecord, "id">;
	"outgoing-invoices"!: EntityTable<SyncRecord, "id">;
	"incoming-invoices"!: EntityTable<SyncRecord, "id">;
	"payment-invoices"!: EntityTable<SyncRecord, "id">;
	"scheduled-tasks"!: EntityTable<SyncRecord, "id">;
	"inventory-transfers"!: EntityTable<SyncRecord, "id">;
	"cash-receipt-orders"!: EntityTable<SyncRecord, "id">;
	"cash-expense-orders"!: EntityTable<SyncRecord, "id">;
	brands!: EntityTable<SyncRecord, "id">;
	products!: EntityTable<SyncRecord, "id">;
	saleitems!: EntityTable<SyncRecord, "id">;
	employees!: EntityTable<SyncRecord, "id">;
	positions!: EntityTable<SyncRecord, "id">;
	"employee-histories"!: EntityTable<SyncRecord, "id">;
	"user-access-rights"!: EntityTable<SyncRecord, "id">;
	currencies!: EntityTable<SyncRecord, "id">;
	"payroll-calculations"!: EntityTable<SyncRecord, "id">;
	"payroll-payments"!: EntityTable<SyncRecord, "id">;

	constructor() {
		super("app_offline_db");

		this.version(2).stores({
			// ── Служебные ──
			_syncMeta: "table",
			_pendingChanges: "++id, table, uuid, action, createdAt, [table+uuid]",

			// ── Бизнес-таблицы ──
			// Формат: "primaryKey, &uniqueIndex, normalIndex, ..."
			// ++id — autoIncrement PK, &uuid — уникальный индекс, updatedAt — для delta-sync
			organizations: "++id, &uuid, updatedAt, deletedAt, bin, name",
			counterparties: "++id, &uuid, updatedAt, deletedAt, bin, name",
			contracts:
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, name",
			contacts:
				"++id, &uuid, updatedAt, deletedAt, contactType, ownerType, ownerUuid",
			contactpersons:
				"++id, &uuid, updatedAt, deletedAt, ownerType, ownerUuid, fullName",
			bankaccounts:
				"++id, &uuid, updatedAt, deletedAt, ownerType, ownerUuid, currencyUuid, iban",
			users:
				"++id, &uuid, updatedAt, deletedAt, username, email, employeeUuid, organizationUuid",
			todos:
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, curatorUuid, executorUuid, status",
			notifications:
				"++id, &uuid, updatedAt, deletedAt, userUuid, todoUuid, isRead",
			warehouses:
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, name",
			sales:
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, contractUuid, documentDate, status",
			purchases:
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, contractUuid, documentDate, status",
			"outgoing-invoices":
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, contractUuid, documentDate, status",
			"incoming-invoices":
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, contractUuid, documentDate, status",
			"payment-invoices":
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, contractUuid, documentDate, status",
			"scheduled-tasks":
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, status",
			"inventory-transfers":
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, fromWarehouseUuid, toWarehouseUuid, documentDate",
			"cash-receipt-orders":
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, contractUuid, documentDate, status",
			"cash-expense-orders":
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, counterpartyUuid, contractUuid, documentDate, status",
			brands: "++id, &uuid, updatedAt, deletedAt, name",
			products: "++id, &uuid, updatedAt, deletedAt, brandUuid, name, sku",
			saleitems: "++id, &uuid, updatedAt, deletedAt, saleUuid, productUuid",
			employees:
				"++id, &uuid, updatedAt, deletedAt, organizationUuid, fullName, iin",
			positions: "++id, &uuid, updatedAt, deletedAt, name",
			"employee-histories":
				"++id, &uuid, updatedAt, deletedAt, employeeUuid, positionUuid, organizationUuid",
			"access-rights": "++id, &uuid, updatedAt, deletedAt, userUuid, modelName",
			currencies: "++id, &uuid, updatedAt, deletedAt, code, name",
		});

		// v3: добавлены таблицы кадрового учёта
		this.version(3).stores({
			"payroll-calculations":
				"++id, &uuid, updatedAt, deletedAt, employeeUuid, organizationUuid, positionUuid, period, status",
			"payroll-payments":
				"++id, &uuid, updatedAt, deletedAt, employeeUuid, organizationUuid, period, status",
		});

		// v4: переименование таблицы "access-rights" → "user-access-rights"
		// (модель AccessRight → UserAccessRight). Старая таблица удаляется,
		// данные пересинхронизируются с сервера.
		this.version(4).stores({
			"access-rights": null,
			"user-access-rights": "++id, &uuid, updatedAt, deletedAt, userUuid, modelName",
		});
	}

	/** Получить Dexie-таблицу по имени endpoint'а */
	getTable(endpoint: string): EntityTable<SyncRecord, "id"> | undefined {
		try {
			return this.table(endpoint) as EntityTable<SyncRecord, "id">;
		} catch {
			return undefined;
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════

export let offlineDb = new OfflineDatabase();

/**
 * При UpgradeError (например, при добавлении новых таблиц в новой версии) —
 * удаляем старую IndexedDB и пересоздаём. Все данные восстановятся с сервера
 * при следующей синхронизации.
 */
export async function ensureOfflineDb(): Promise<OfflineDatabase> {
	if (offlineDb.isOpen()) return offlineDb;
	try {
		await offlineDb.open();
	} catch (err: any) {
		if (
			err?.name === "UpgradeError" ||
			err?.name === "DatabaseClosedError" ||
			err?.inner?.name === "UpgradeError"
		) {
			console.warn(
				"[OfflineDB] Upgrade error — deleting and recreating database...",
				err.message,
			);
			try {
				await Dexie.delete("app_offline_db");
			} catch {
				/* ignore */
			}
			offlineDb = new OfflineDatabase();
			await offlineDb.open();
		} else {
			throw err;
		}
	}
	return offlineDb;
}

// ═══════════════════════════════════════════════════════════════════════════
// Утилиты для _syncMeta
// ═══════════════════════════════════════════════════════════════════════════

/** Получить lastSyncAt для таблицы */
export async function getLastSyncAt(table: string): Promise<string | null> {
	const meta = await offlineDb._syncMeta.get(table);
	return meta?.lastSyncAt ?? null;
}

/** Обновить lastSyncAt для таблицы */
export async function setLastSyncAt(
	table: string,
	timestamp: string,
): Promise<void> {
	const existing = await offlineDb._syncMeta.get(table);
	await offlineDb._syncMeta.put({
		...existing, // сначала старые поля (lastPushAt, itemCount)
		table, // PK — всегда перезаписываем
		lastSyncAt: timestamp, // новое значение — после spread, чтобы НЕ было затёрто
	});
}

/** Получить все мета-записи */
export async function getAllSyncMeta(): Promise<SyncMeta[]> {
	return offlineDb._syncMeta.toArray();
}

// ═══════════════════════════════════════════════════════════════════════════
// Утилиты для _pendingChanges
// ═══════════════════════════════════════════════════════════════════════════

/** Добавить pending change */
export async function addPendingChange(
	change: Omit<PendingChange, "id" | "createdAt">,
): Promise<number> {
	return offlineDb._pendingChanges.add({
		...change,
		createdAt: new Date().toISOString(),
	} as PendingChange) as Promise<number>;
}

/** Получить все pending changes */
export async function getAllPendingChanges(): Promise<PendingChange[]> {
	return offlineDb._pendingChanges.orderBy("createdAt").toArray();
}

/** Получить pending changes для конкретной таблицы */
export async function getPendingChangesByTable(
	table: string,
): Promise<PendingChange[]> {
	return offlineDb._pendingChanges.where("table").equals(table).toArray();
}

/** Удалить pending change по id */
export async function removePendingChange(id: number): Promise<void> {
	await offlineDb._pendingChanges.delete(id);
}

/** Очистить все pending changes */
export async function clearAllPendingChanges(): Promise<void> {
	await offlineDb._pendingChanges.clear();
}

/** Количество pending changes */
export async function getPendingChangesCount(): Promise<number> {
	return offlineDb._pendingChanges.count();
}

// ═══════════════════════════════════════════════════════════════════════════
// Утилиты для бизнес-таблиц
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert массива записей в таблицу (bulkPut по uuid).
 * Если запись с таким uuid уже есть — она обновляется.
 */
export async function upsertRecords(
	tableName: string,
	records: SyncRecord[],
): Promise<void> {
	const table = offlineDb.getTable(tableName);
	if (!table || records.length === 0) return;

	// bulkPut обновляет существующие записи по PK.
	// Но мы используем uuid как уникальный индекс, а PK = id.
	// Нужно сначала найти существующие записи по uuid и перенести их id.
	const uuids = records.map((r) => r.uuid).filter(Boolean);
	const existing = await table.where("uuid").anyOf(uuids).toArray();
	const existingMap = new Map(existing.map((e) => [e.uuid, e.id]));

	const toWrite = records.map((r) => {
		const existingId = existingMap.get(r.uuid);
		if (existingId !== undefined) {
			return { ...r, id: existingId };
		}
		// Новая запись — убираем id, чтобы Dexie сгенерировал новый
		const { id: _, ...rest } = r;
		return rest;
	});

	await table.bulkPut(toWrite as SyncRecord[]);
}

/**
 * Получить одну запись по uuid.
 */
export async function getRecordByUuid(
	tableName: string,
	uuid: string,
): Promise<SyncRecord | undefined> {
	const table = offlineDb.getTable(tableName);
	if (!table) return undefined;
	return table.where("uuid").equals(uuid).first();
}

/**
 * Получить все активные записи (deletedAt === null).
 * Поддерживает лимит и offset для пагинации.
 */
export async function getActiveRecords(
	tableName: string,
	options?: {
		limit?: number;
		offset?: number;
		sortField?: string;
		sortDir?: "asc" | "desc";
	},
): Promise<SyncRecord[]> {
	const table = offlineDb.getTable(tableName);
	if (!table) return [];

	const collection = table.filter((r) => !r.deletedAt);

	const all = await collection.toArray();

	// Сортировка
	if (options?.sortField) {
		const field = options.sortField;
		const dir = options.sortDir === "desc" ? -1 : 1;
		all.sort((a, b) => {
			const va = (a as any)[field];
			const vb = (b as any)[field];
			if (va == null && vb == null) return 0;
			if (va == null) return 1;
			if (vb == null) return -1;
			if (va < vb) return -dir;
			if (va > vb) return dir;
			return 0;
		});
	}

	// Пагинация
	const offset = options?.offset ?? 0;
	const limit = options?.limit ?? all.length;
	return all.slice(offset, offset + limit);
}

/**
 * Подсчитать активные записи (без deletedAt).
 */
export async function countActiveRecords(tableName: string): Promise<number> {
	const table = offlineDb.getTable(tableName);
	if (!table) return 0;
	return table.filter((r) => !r.deletedAt).count();
}

/**
 * Полнотекстовый поиск по локальным данным.
 * Ищет подстроку в строковых полях записи.
 */
export async function searchRecords(
	tableName: string,
	query: string,
	searchColumns?: string[],
): Promise<SyncRecord[]> {
	const table = offlineDb.getTable(tableName);
	if (!table || !query.trim()) return [];

	const lowerQuery = query.toLowerCase();
	const words = lowerQuery.split(/\s+/).filter(Boolean);

	const all = await table
		.filter((r) => {
			if (r.deletedAt) return false;
			const fieldsToSearch = searchColumns ?? Object.keys(r);
			return words.every((word) =>
				fieldsToSearch.some((field) => {
					const val = (r as any)[field];
					if (typeof val === "string") return val.toLowerCase().includes(word);
					if (typeof val === "number") return String(val).includes(word);
					return false;
				}),
			);
		})
		.toArray();

	return all;
}

/**
 * Очистить все данные offline-базы (при logout).
 */
export async function clearOfflineDb(): Promise<void> {
	const tables = offlineDb.tables;
	await Promise.all(tables.map((t) => t.clear()));
	console.info("[OfflineDB] Все таблицы очищены");
}

/**
 * Получить суммарную статистику по offline-базе.
 */
export async function getOfflineDbStats(): Promise<Record<string, number>> {
	const stats: Record<string, number> = {};
	for (const name of SYNCABLE_TABLES) {
		const table = offlineDb.getTable(name);
		if (table) {
			stats[name] = await table.count();
		}
	}
	const pending = await offlineDb._pendingChanges.count();
	stats._pendingChanges = pending;
	return stats;
}

export default offlineDb;
