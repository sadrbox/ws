/**
 * sync.js — API для двусторонней синхронизации offline-клиента.
 *
 * POST /sync/pull  — клиент отправляет { lastSyncAt, tables: ["organizations", ...] }
 *                    сервер возвращает все записи с updatedAt > lastSyncAt
 *
 * POST /sync/push  — клиент отправляет массив изменений
 *                    сервер применяет их и возвращает конфликты
 *
 * GET  /sync/meta  — возвращает текущие максимальные updatedAt для каждой таблицы
 */

import express from "express";
import { prisma } from "../../prisma/prisma-client.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// Карта моделей Prisma (endpoint → prisma delegate name)
// ═══════════════════════════════════════════════════════════════════════════

const MODEL_MAP = {
	organizations: "organization",
	counterparties: "counterparty",
	contracts: "contract",
	contacts: "contact",
	contactpersons: "contactPerson",
	bankaccounts: "bankAccount",
	todos: "todo",
	warehouses: "warehouse",
	sales: "sale",
	purchases: "purchase",
	"outgoing-invoices": "outgoingInvoice",
	"incoming-invoices": "incomingInvoice",
	"payment-invoices": "paymentInvoice",
	"scheduled-tasks": "scheduledTask",
	"inventory-transfers": "inventoryTransfer",
	"cash-receipt-orders": "cashReceiptOrder",
	"cash-expense-orders": "cashExpenseOrder",
	brands: "brand",
	products: "product",
	saleitems: "saleItem",
	employees: "employee",
	positions: "position",
	"employee-histories": "employeeHistory",
	"user-access-rights": "userAccessRight",
	currencies: "currency",
	users: "user",
	"payroll-calculations": "payrollCalculation",
	"payroll-payments": "payrollPayment",
};

// Таблицы, которые не поддерживают updatedAt (ActivityHistory, AttachedFile)
const SKIP_TABLES = new Set(["activityhistories", "attached-files"]);

// Include-карта для подгрузки связей (как в GET /:id роутерах)
const INCLUDE_MAP = {
	organization: {},
	counterparty: {},
	contract: { organization: true, counterparty: true },
	contact: {},
	contactPerson: {},
	bankAccount: { currency: true },
	todo: {
		organization: true,
		curator: {
			select: {
				uuid: true,
				username: true,
				employee: { select: { fullName: true } },
			},
		},
		executor: {
			select: {
				uuid: true,
				username: true,
				employee: { select: { fullName: true } },
			},
		},
	},
	warehouse: { organization: true },
	sale: {
		organization: true,
		counterparty: true,
		contract: true,
		warehouse: true,
		saleItems: { include: { product: true } },
	},
	purchase: { organization: true, counterparty: true, contract: true },
	outgoingInvoice: { organization: true, counterparty: true, contract: true },
	incomingInvoice: { organization: true, counterparty: true, contract: true },
	paymentInvoice: { organization: true, counterparty: true, contract: true },
	scheduledTask: { organization: true },
	inventoryTransfer: {
		organization: true,
		fromWarehouse: true,
		toWarehouse: true,
	},
	cashReceiptOrder: { organization: true, counterparty: true, contract: true },
	cashExpenseOrder: { organization: true, counterparty: true, contract: true },
	brand: {},
	product: { brand: true },
	saleItem: { product: true },
	employee: { organization: true },
	position: {},
	employeeHistory: { employee: true, position: true, organization: true },
	userAccessRight: {},
	currency: {},
	user: { employee: { include: { organization: true } }, userAccessRights: true },
	payrollCalculation: { employee: true, organization: true, position: true },
	payrollPayment: { employee: true, organization: true },
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /sync/pull — скачать изменения с сервера
// ═══════════════════════════════════════════════════════════════════════════

router.post("/sync/pull", async (req, res) => {
	try {
		const { lastSyncAt, tables } = req.body;

		if (!tables || !Array.isArray(tables) || tables.length === 0) {
			return res.status(400).json({
				success: false,
				message: "Необходимо указать массив tables",
			});
		}

		const since = lastSyncAt ? new Date(lastSyncAt) : new Date(0);
		const results = {};
		const serverTime = new Date().toISOString();

		for (const tableName of tables) {
			if (SKIP_TABLES.has(tableName)) continue;
			const modelKey = MODEL_MAP[tableName];
			if (!modelKey || !prisma[modelKey]) continue;

			try {
				const include = INCLUDE_MAP[modelKey] || {};
				const hasIncludes = Object.keys(include).length > 0;

				const items = await prisma[modelKey].findMany({
					where: {
						updatedAt: { gt: since },
					},
					...(hasIncludes ? { include } : {}),
					orderBy: { updatedAt: "asc" },
					take: 10000, // лимит безопасности
				});

				if (items.length > 0) {
					results[tableName] = items;
				}
			} catch (err) {
				console.warn(
					`[Sync/pull] Ошибка для таблицы ${tableName}:`,
					err.message,
				);
			}
		}

		return res.json({
			success: true,
			serverTime,
			data: results,
		});
	} catch (err) {
		console.error("[Sync/pull] Ошибка:", err);
		return res.status(500).json({
			success: false,
			message: err.message || "Ошибка синхронизации",
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /sync/push — отправить изменения на сервер
// ═══════════════════════════════════════════════════════════════════════════

router.post("/sync/push", async (req, res) => {
	try {
		const { changes } = req.body;

		if (!changes || !Array.isArray(changes) || changes.length === 0) {
			return res.json({ success: true, applied: 0, conflicts: [] });
		}

		const applied = [];
		const conflicts = [];
		const errors = [];

		for (const change of changes) {
			const { table, action, uuid, data, clientUpdatedAt } = change;
			const modelKey = MODEL_MAP[table];
			if (!modelKey || !prisma[modelKey]) {
				errors.push({ uuid, table, error: `Unknown table: ${table}` });
				continue;
			}

			try {
				if (action === "create") {
					// Проверяем нет ли уже записи с таким uuid
					const existing = await prisma[modelKey].findUnique({
						where: { uuid },
					});
					if (existing) {
						// Уже создана (другим клиентом или повторная отправка) — пропускаем
						applied.push({ uuid, table, action: "skip" });
						continue;
					}
					await prisma[modelKey].create({ data: { uuid, ...data } });
					applied.push({ uuid, table, action: "create" });
				} else if (action === "update") {
					// Проверяем на конфликт: если серверная версия новее клиентской
					const serverRecord = await prisma[modelKey].findUnique({
						where: { uuid },
					});
					if (!serverRecord) {
						errors.push({ uuid, table, error: "Record not found on server" });
						continue;
					}

					const serverUpdatedAt = serverRecord.updatedAt
						? new Date(serverRecord.updatedAt).getTime()
						: 0;
					const clientTs = clientUpdatedAt
						? new Date(clientUpdatedAt).getTime()
						: 0;

					// Если серверная версия новее — конфликт
					if (serverUpdatedAt > clientTs && clientTs > 0) {
						conflicts.push({
							uuid,
							table,
							clientData: data,
							serverData: serverRecord,
							serverUpdatedAt: serverRecord.updatedAt,
						});
						continue;
					}

					// Применяем обновление
					await prisma[modelKey].update({
						where: { uuid },
						data,
					});
					applied.push({ uuid, table, action: "update" });
				} else if (action === "delete") {
					// Soft delete
					const existing = await prisma[modelKey].findUnique({
						where: { uuid },
					});
					if (!existing) {
						applied.push({ uuid, table, action: "skip" });
						continue;
					}
					await prisma[modelKey].update({
						where: { uuid },
						data: { deletedAt: new Date() },
					});
					applied.push({ uuid, table, action: "delete" });
				}
			} catch (err) {
				errors.push({ uuid, table, error: err.message });
			}
		}

		return res.json({
			success: true,
			serverTime: new Date().toISOString(),
			applied: applied.length,
			conflicts,
			errors,
		});
	} catch (err) {
		console.error("[Sync/push] Ошибка:", err);
		return res.status(500).json({
			success: false,
			message: err.message || "Ошибка синхронизации",
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /sync/meta — метаинформация для определения необходимости синхронизации
// ═══════════════════════════════════════════════════════════════════════════

router.get("/sync/meta", async (req, res) => {
	try {
		const meta = {};

		for (const [endpoint, modelKey] of Object.entries(MODEL_MAP)) {
			if (SKIP_TABLES.has(endpoint)) continue;
			if (!prisma[modelKey]) continue;

			try {
				const result = await prisma[modelKey].aggregate({
					_max: { updatedAt: true },
					_count: true,
				});
				meta[endpoint] = {
					lastUpdatedAt: result._max.updatedAt,
					count: result._count,
				};
			} catch {
				// Таблица может не иметь updatedAt
			}
		}

		return res.json({
			success: true,
			serverTime: new Date().toISOString(),
			meta,
		});
	} catch (err) {
		console.error("[Sync/meta] Ошибка:", err);
		return res.status(500).json({ success: false, message: err.message });
	}
});

export default router;
