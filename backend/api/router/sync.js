/**
 * sync.js — API для двусторонней синхронизации offline-клиента.
 *
 * POST /sync/pull  — клиент отправляет { lastSyncAt, tables: ["organizations", ...] }
 *                    сервер возвращает записи с updatedAt > lastSyncAt — ТОЛЬКО доступные
 * POST /sync/push  — клиент отправляет массив изменений (офлайн-правки справочников)
 *                    сервер применяет разрешённые и возвращает конфликты и ошибки
 * GET  /sync/meta  — максимальные updatedAt и число записей по таблицам — по тем же правилам
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПЕРЕДЕЛАНО ПО Б1 АУДИТА 26.09. Раньше обмен шёл вообще без проверок:
 *   - pull отдавал 28 таблиц ВСЕХ организаций, `users` — целиком, с хэшем пароля и секретом 2FA;
 *   - push писал в любую модель что угодно: `{table:"users", action:"update", uuid:<свой>,
 *     data:{isSuperAdmin:true}}` делал автора суперадмином, документы писались в чужие
 *     организации и закрытые периоды без проведения.
 *
 * Теперь:
 *   PULL — белый список таблиц (ровно то, что просит панель, services/offlineDb.ts), по каждой —
 *     право на чтение модели и изоляция организации (tenantFilter / directoryScope). Пользователи —
 *     только видимые (по членству) и только безопасные поля; права — только свои; код приглашения
 *     организации — только её администратору.
 *   PUSH — пишем только СПРАВОЧНИКИ, у которых нет своей логики сохранения: контрагенты, договоры,
 *     контакты, контактные лица, банковские счета, склады, бренды, товары, сотрудники, должности.
 *     Поля — белый список скаляров модели (без служебных и учётных флагов), организация — доступная,
 *     ссылки — на доступные записи, удаление — мягкое и только если на запись никто не ссылается.
 *     ДОКУМЕНТЫ, задачи, пользователи, права, организации офлайн НЕ записываются: у них проведение,
 *     нумерация, блокировка периода и правила E17 — всё это живёт в своих роутерах. Такое изменение
 *     возвращается ошибкой с понятным текстом и остаётся в очереди клиента: его сохраняют при связи.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/prisma-client.js";
import {
	tenantFilter, directoryScope, checkOwnership, orgIsAccessible, canAccessModel,
	resolveWritableOrg, OrgAccessError, isAdminOfOrg,
} from "../../utils/auth.js";
import { findReferences, resolveTableName, formatReferencesMessage } from "../../utils/checkReferences.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// Белый список таблиц для PULL (endpoint панели → модель, право, способ изоляции)
// ═══════════════════════════════════════════════════════════════════════════

const SAFE_USER_SELECT = {
	id: true, uuid: true, username: true, email: true, employeeUuid: true, avatarPath: true,
	organizationUuid: true, createdAt: true, updatedAt: true, deletedAt: true,
	employee: { select: { uuid: true, fullName: true, firstName: true, lastName: true, middleName: true, organizationUuid: true } },
};
const TODO_USER = { select: { uuid: true, username: true, employee: { select: { fullName: true } } } };

/**
 * scope:
 *   "org"     — записи организации: tenantFilter;
 *   "dir"     — справочник с возможными общими записями: directoryScope(req, perm);
 *   "self"    — сами организации: tenantFilter по uuid;
 *   "global"  — общий справочник без организации (валюты);
 *   "users"   — пользователи по членству в доступных организациях;
 *   "ownPerm" — только свои права.
 */
export const PULL_TABLES = {
	organizations: { model: "organization", perm: "Organization", scope: "self" },
	counterparties: { model: "counterparty", perm: "Counterparty", scope: "dir" },
	contracts: { model: "contract", perm: "Contract", scope: "org", include: { organization: true, counterparty: true } },
	contacts: { model: "contact", perm: "Contact", scope: "org" },
	contactpersons: { model: "contactPerson", perm: "ContactPerson", scope: "org" },
	bankaccounts: { model: "bankAccount", perm: "BankAccount", scope: "org", include: { currency: true } },
	users: { model: "user", perm: "User", scope: "users" },
	todos: { model: "todo", perm: "Todo", scope: "org", include: { organization: true, curator: TODO_USER, executor: TODO_USER } },
	warehouses: { model: "warehouse", perm: "Warehouse", scope: "org", include: { organization: true } },
	sales: {
		model: "sale", perm: "Sale", scope: "org",
		include: { organization: true, counterparty: true, contract: true, warehouse: true, saleItems: { include: { product: true } } },
	},
	purchases: { model: "purchase", perm: "Purchase", scope: "org", include: { organization: true, counterparty: true, contract: true } },
	"outgoing-invoices": { model: "outgoingInvoice", perm: "OutgoingInvoice", scope: "org", include: { organization: true, counterparty: true, contract: true } },
	"incoming-invoices": { model: "incomingInvoice", perm: "IncomingInvoice", scope: "org", include: { organization: true, counterparty: true, contract: true } },
	"payment-invoices": { model: "paymentInvoice", perm: "PaymentInvoice", scope: "org", include: { organization: true, counterparty: true, contract: true } },
	"scheduled-tasks": { model: "scheduledTask", perm: "ScheduledTask", scope: "org", include: { organization: true } },
	"inventory-transfers": { model: "inventoryTransfer", perm: "InventoryTransfer", scope: "org", include: { organization: true, fromWarehouse: true, toWarehouse: true } },
	"cash-receipt-orders": { model: "cashOrder", perm: "CashReceiptOrder", scope: "org", where: { direction: "receipt" }, include: { organization: true, counterparty: true, contract: true } },
	"cash-expense-orders": { model: "cashOrder", perm: "CashExpenseOrder", scope: "org", where: { direction: "expense" }, include: { organization: true, counterparty: true, contract: true } },
	brands: { model: "brand", perm: "Brand", scope: "dir" },
	products: { model: "product", perm: "Product", scope: "dir", include: { brand: true } },
	saleitems: { model: "saleItem", perm: "SaleItem", scope: "org", include: { product: true } },
	employees: { model: "employee", perm: "Employee", scope: "org", include: { organization: true } },
	positions: { model: "position", perm: "Position", scope: "org" },
	"employee-histories": { model: "employeeHistory", perm: "EmployeeHistory", scope: "org", include: { employee: true, position: true, organization: true } },
	"access-permissions": { model: "accessPermission", perm: null, scope: "ownPerm" },
	currencies: { model: "currency", perm: "Currency", scope: "global" },
	"payroll-calculations": { model: "payrollCalculation", perm: "PayrollCalculation", scope: "org", include: { employee: true, organization: true, position: true } },
	"payroll-payments": { model: "payrollPayment", perm: "PayrollPayment", scope: "org", include: { employee: true, organization: true } },
};

/** Предел строк одной таблицы за один pull (остаток дочитывается следующим обменом). */
export const PULL_TAKE = 5000;

/** Условие изоляции для таблицы. null — таблицу этому пользователю не отдаём вовсе. */
export async function pullScopeWhere(req, def) {
	switch (def.scope) {
		case "org": return tenantFilter(req);
		case "dir": return directoryScope(req, def.perm);
		case "self": return tenantFilter(req, "uuid");
		case "global": return {};
		case "users": {
			// Как в /users: участники всех доступных организаций и сам пользователь.
			if (req.user?.isSuperAdmin && req.user?.operatorDataAccess !== false) return {};
			const orgs = [...new Set([req.user?.organizationUuid, ...(req.user?.allowedOrgUuids ?? [])].filter(Boolean))];
			return { OR: [{ accessRights: { some: { organizationUuid: { in: orgs } } } }, { uuid: req.user?.uuid ?? "__none__" }] };
		}
		case "ownPerm": return { userUuid: req.user?.uuid ?? "__none__" };
		default: return null;
	}
}

/** Можно ли читать таблицу: своё право на модель (свои права доступа — всегда). */
async function canPull(req, def) {
	if (!def.perm) return true;
	return canAccessModel(req, def.perm);
}

/*
 * СВОИ ОРГАНИЗАЦИИ — И БЕЗ ПРАВА НА СПРАВОЧНИК (КР-18 аудита 27.09). Таблица `organizations` без права
 * Organization молча уходила в skipped: у кассира, кладовщика, сотрудника обслуживающей фирмы в
 * клиенте (профиль связи Organization не открывает — доступом клиента фирма не распоряжается) офлайн-
 * справочник организаций пуст, и офлайн-формы остаются без организации. Список СВОИХ организаций
 * (членство и обслуживание; изоляция — та же, tenantFilter) — не чужие данные: имя и БИН тех же
 * организаций человек получает при входе. Отдаём его и без права, но только эти поля — без реквизитов
 * и кода приглашения; в ответе таблица помечена в `limited`.
 */
export const ORG_DIRECTORY_SELECT = Object.freeze({
	id: true, uuid: true, name: true, legalName: true, bin: true, kind: true, createdAt: true, updatedAt: true, deletedAt: true,
});

/** Как отдавать таблицу: { select } — по праву целиком (select=null) или ограниченно; null — никак. */
export async function pullAccess(req, tableName, def) {
	if (await canPull(req, def)) return { select: null, limited: false };
	if (tableName === "organizations") return { select: ORG_DIRECTORY_SELECT, limited: true };
	return null;
}

/** Строка наружу: без секретов и без чужого кода приглашения. */
function sanitizeRow(req, table, row) {
	if (table === "organizations" && row && !isAdminOfOrg(req, row.uuid)) {
		const { inviteCode: _omit, ...rest } = row;
		return rest;
	}
	return row;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /sync/pull — скачать изменения с сервера
// ═══════════════════════════════════════════════════════════════════════════

router.post("/sync/pull", async (req, res) => {
	try {
		const { lastSyncAt, tables } = req.body ?? {};

		if (!tables || !Array.isArray(tables) || tables.length === 0) {
			return res.status(400).json({
				success: false,
				message: "Необходимо указать массив tables",
			});
		}

		const since = lastSyncAt ? new Date(lastSyncAt) : new Date(0);
		if (Number.isNaN(since.getTime())) {
			return res.status(400).json({ success: false, message: "Некорректный lastSyncAt" });
		}
		const results = {};
		let serverTime = new Date();
		const skipped = [];
		const limited = [];

		for (const tableName of new Set(tables)) {
			const def = PULL_TABLES[tableName];
			if (!def || !prisma[def.model]) { skipped.push(tableName); continue; }
			const access = await pullAccess(req, tableName, def);
			if (!access) { skipped.push(tableName); continue; }
			if (access.limited) limited.push(tableName);
			const scope = await pullScopeWhere(req, def);
			if (scope === null) { skipped.push(tableName); continue; }

			try {
				const where = { AND: [{ updatedAt: { gt: since } }, def.where ?? {}, scope] };
				const items = await prisma[def.model].findMany({
					where,
					...(def.model === "user" ? { select: SAFE_USER_SELECT } : access.select ? { select: access.select } : def.include ? { include: def.include } : {}),
					orderBy: { updatedAt: "asc" },
					take: PULL_TAKE,
				});
				if (items.length > 0) results[tableName] = items.map((r) => sanitizeRow(req, tableName, r));
				/*
				 * Хвост сверх предела не теряем (Н3): клиент запоминает serverTime как «синхронизировано
				 * по», поэтому при обрезке отдаём момент ЧУТЬ РАНЬШЕ последней отданной строки — следующий
				 * обмен дочитает остаток (уже полученные строки просто перезапишутся).
				 */
				if (items.length === PULL_TAKE) {
					const lastAt = new Date(items[items.length - 1].updatedAt).getTime() - 1;
					if (lastAt < serverTime.getTime()) serverTime = new Date(lastAt);
				}
			} catch (err) {
				console.warn(`[Sync/pull] Ошибка для таблицы ${tableName}:`, err.message);
			}
		}

		return res.json({
			success: true,
			serverTime: serverTime.toISOString(),
			data: results,
			...(skipped.length ? { skipped } : {}),
			...(limited.length ? { limited } : {}),
		});
	} catch (err) {
		console.error("[Sync/pull] Ошибка:", err);
		return res.status(500).json({
			success: false,
			message: "Ошибка синхронизации",
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════
// Правила PUSH
// ═══════════════════════════════════════════════════════════════════════════

/** Справочники, которые можно менять офлайн. */
export const PUSH_TABLES = {
	counterparties: { model: "counterparty", perm: "Counterparty" },
	contracts: { model: "contract", perm: "Contract" },
	contacts: { model: "contact", perm: "Contact", polymorphic: true },
	contactpersons: { model: "contactPerson", perm: "ContactPerson", polymorphic: true },
	bankaccounts: { model: "bankAccount", perm: "BankAccount", polymorphic: true },
	warehouses: { model: "warehouse", perm: "Warehouse" },
	brands: { model: "brand", perm: "Brand" },
	products: { model: "product", perm: "Product" },
	employees: { model: "employee", perm: "Employee" },
	positions: { model: "position", perm: "Position" },
};

/**
 * Причина отказа для таблиц, которые офлайн не пишутся.
 *
 * Проверить потом: панель (frontend/src/services/syncManager.ts) держит отклонённое изменение в
 * очереди и повторяет его при каждом обмене. Документ, созданный офлайн, надо досылать обычным
 * POST /{таблица} (с проведением и проверками) или не давать создавать документы без связи.
 */
export function pushRefusal(table) {
	if (PUSH_TABLES[table]) return null;
	if (["users", "access-permissions", "access-rights"].includes(table)) {
		return "Пользователи и права доступа офлайн не изменяются";
	}
	if (table === "organizations") return "Реквизиты организации офлайн не изменяются — сохраните их при связи";
	if (table === "todos") return "Задачи офлайн не сохраняются — откройте задачу и сохраните её при связи";
	if (table === "currencies") return "Валюты — общий справочник, офлайн не изменяются";
	if (PULL_TABLES[table]) {
		return "Документ нельзя записать офлайн: проведение, нумерация и закрытый период проверяются только при связи — откройте документ и сохраните его";
	}
	return `Таблица ${table} не синхронизируется`;
}

/**
 * Поля, которые офлайн-клиент НЕ задаёт никогда: служебные (id, метки времени), связь с 1С,
 * пути файлов и учётные флаги товара (серии/партии меняют смысл остатков — только через форму).
 */
const PUSH_SYSTEM_FIELDS = new Set([
	"id", "uuid", "createdAt", "updatedAt", "deletedAt", "externalId", "externalSource", "avatarPath",
	"trackSerialNumbers", "serialTrackingSince", "trackBatches", "batchTrackingSince", "assetKind",
]);

const MODEL_META = new Map();
for (const m of Prisma.dmmf?.datamodel?.models ?? []) MODEL_META.set(m.name[0].toLowerCase() + m.name.slice(1), m);

/** Разрешённые к записи скалярные поля модели. */
export function pushableFields(model) {
	const m = MODEL_META.get(model);
	if (!m) return new Set();
	return new Set(m.fields.filter((f) => f.kind !== "object" && !PUSH_SYSTEM_FIELDS.has(f.name)).map((f) => f.name));
}

/** Ссылки модели: поле-ключ → модель, на которую оно указывает (для проверки владельца). */
function foreignKeys(model) {
	const m = MODEL_META.get(model);
	const out = new Map();
	for (const f of m?.fields ?? []) {
		if (f.kind === "object" && !f.isList && f.relationFromFields?.length === 1) {
			out.set(f.relationFromFields[0], f.type[0].toLowerCase() + f.type.slice(1));
		}
	}
	return out;
}

/** Служебные поля, которые клиент присылает всегда (метки времени записи) — их просто не пишем. */
const PUSH_IGNORED = new Set(["id", "uuid", "createdAt", "updatedAt", "deletedAt"]);

/**
 * Оставить только разрешённые поля.
 *   - скаляры модели из белого списка — пишем;
 *   - служебные метки и то, чего в модели нет (подписи для интерфейса, вложенные объекты) —
 *     не пишем молча: это не данные записи;
 *   - запрещённые поля модели (связь с 1С, учётные флаги товара, пути файлов) — если клиент
 *     пытается их ИЗМЕНИТЬ, это ошибка: молча выбросить нельзя — клиент решит, что сохранил.
 * @param {object|null} current — текущая запись (для update), чтобы неизменённое значение не считалось попыткой
 */
export function filterPushData(model, data, current = null) {
	const allowed = pushableFields(model);
	const m = MODEL_META.get(model);
	const scalars = new Set((m?.fields ?? []).filter((f) => f.kind !== "object").map((f) => f.name));
	const out = {};
	const rejected = [];
	for (const [k, v] of Object.entries(data ?? {})) {
		if (allowed.has(k)) { out[k] = v; continue; }
		if (PUSH_IGNORED.has(k) || !scalars.has(k)) continue;
		const same = current ? String(current[k] ?? "") === String(v ?? "") : v == null || v === "" || v === false;
		if (!same) rejected.push(k);
	}
	return { data: out, rejected };
}

const OWNER_MODELS = { organization: "organization", counterparty: "counterparty", contactperson: "contactPerson", employee: "employee" };

class PushError extends Error {}

/** Все ссылки записи — на доступные пользователю записи. */
async function assertRefsAccessible(req, model, data) {
	for (const [field, target] of foreignKeys(model)) {
		const ref = data[field];
		if (!ref || field === "organizationUuid") continue;
		const meta = MODEL_META.get(target);
		if (!meta) continue;
		if (target === "organization") {
			if (!orgIsAccessible(req, ref)) throw new PushError(`Ссылка «${field}» недоступна`);
			continue;
		}
		if (!meta.fields.some((f) => f.name === "organizationUuid")) continue; // общий справочник
		const row = await prisma[target].findUnique({ where: { uuid: String(ref) }, select: { organizationUuid: true } });
		if (!row || !checkOwnership(row, req)) throw new PushError(`Ссылка «${field}» недоступна`);
	}
	if (data.ownerType !== undefined || data.ownerUuid !== undefined) {
		const t = OWNER_MODELS[String(data.ownerType ?? "").toLowerCase()];
		if (!t || !data.ownerUuid) throw new PushError("Владелец записи не указан или неизвестен");
		if (t === "organization") {
			if (!orgIsAccessible(req, data.ownerUuid)) throw new PushError("Владелец записи недоступен");
		} else {
			const row = await prisma[t].findUnique({ where: { uuid: String(data.ownerUuid) }, select: { organizationUuid: true } });
			if (!row || !checkOwnership(row, req)) throw new PushError("Владелец записи недоступен");
		}
	}
}

/** Применить одно изменение. Возвращает { action } или бросает PushError/OrgAccessError. */
async function applyChange(req, change) {
	const { table, action, uuid, clientUpdatedAt } = change;
	const def = PUSH_TABLES[table];
	if (!(await canAccessModel(req, def.perm, { write: true }))) throw new PushError("Нет права на изменение");
	if (typeof uuid !== "string" || !uuid) throw new PushError("Не указан uuid записи");
	const delegate = prisma[def.model];

	if (action === "create") {
		const existing = await delegate.findUnique({ where: { uuid } });
		// Уже создана (повторная отправка) — пропускаем, если она своя; чужая — «не найдено».
		if (existing) {
			if (!checkOwnership(existing, req, "organizationUuid", { allowShared: false })) throw new PushError("Запись с таким uuid недоступна");
			return { action: "skip" };
		}
		const { data, rejected } = filterPushData(def.model, change.data);
		if (rejected.length) throw new PushError(`Поля нельзя изменять офлайн: ${rejected.join(", ")}`);
		data.organizationUuid = resolveWritableOrg(req, data.organizationUuid ?? null);
		await assertRefsAccessible(req, def.model, data);
		await delegate.create({ data: { ...data, uuid } });
		return { action: "create" };
	}

	if (action === "update") {
		const serverRecord = await delegate.findUnique({ where: { uuid } });
		// Общая запись (без организации) офлайн не правится: её меняют при связи те, кому можно.
		if (!serverRecord || !checkOwnership(serverRecord, req, "organizationUuid", { allowShared: false })) {
			throw new PushError("Record not found on server");
		}
		const serverUpdatedAt = serverRecord.updatedAt ? new Date(serverRecord.updatedAt).getTime() : 0;
		const clientTs = clientUpdatedAt ? new Date(clientUpdatedAt).getTime() : 0;
		if (serverUpdatedAt > clientTs && clientTs > 0) {
			return { action: "conflict", serverRecord };
		}
		const { data, rejected } = filterPushData(def.model, change.data, serverRecord);
		if (rejected.length) throw new PushError(`Поля нельзя изменять офлайн: ${rejected.join(", ")}`);
		if ("organizationUuid" in data && data.organizationUuid !== serverRecord.organizationUuid) {
			if (!data.organizationUuid || !orgIsAccessible(req, data.organizationUuid)) throw new OrgAccessError(403, "Организация недоступна");
		}
		const polymorphicTouched = def.polymorphic && ("ownerType" in data || "ownerUuid" in data);
		await assertRefsAccessible(req, def.model, polymorphicTouched
			? { ...data, ownerType: data.ownerType ?? serverRecord.ownerType, ownerUuid: data.ownerUuid ?? serverRecord.ownerUuid }
			: data);
		await delegate.update({ where: { uuid }, data });
		return { action: "update" };
	}

	if (action === "delete") {
		const existing = await delegate.findUnique({ where: { uuid } });
		if (!existing) return { action: "skip" };
		if (!checkOwnership(existing, req, "organizationUuid", { allowShared: false })) throw new PushError("Record not found on server");
		// Запись, на которую ссылаются документы, не удаляем (как и общий обработчик удаления).
		const refs = await findReferences(resolveTableName(def.model), { uuid: existing.uuid, id: existing.id });
		if (refs.length) throw new PushError(formatReferencesMessage(refs) || "Запись используется и не может быть удалена");
		await delegate.update({ where: { uuid }, data: { deletedAt: new Date() } });
		return { action: "delete" };
	}

	throw new PushError(`Неизвестное действие: ${action}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /sync/push — отправить изменения на сервер
// ═══════════════════════════════════════════════════════════════════════════

router.post("/sync/push", async (req, res) => {
	try {
		const { changes } = req.body ?? {};

		if (!changes || !Array.isArray(changes) || changes.length === 0) {
			return res.json({ success: true, applied: 0, conflicts: [], errors: [] });
		}
		if (changes.length > 500) {
			return res.status(400).json({ success: false, message: "Слишком много изменений за один обмен (больше 500)" });
		}

		const applied = [];
		const conflicts = [];
		const errors = [];

		for (const change of changes) {
			const { table, uuid, data } = change ?? {};
			const refusal = pushRefusal(table);
			if (refusal) {
				errors.push({ uuid, table, code: "SYNC_PUSH_REFUSED", error: refusal });
				continue;
			}
			try {
				const r = await applyChange(req, change);
				if (r.action === "conflict") {
					conflicts.push({ uuid, table, clientData: data, serverData: r.serverRecord, serverUpdatedAt: r.serverRecord.updatedAt });
				} else {
					applied.push({ uuid, table, action: r.action });
				}
			} catch (err) {
				const known = err instanceof PushError || err instanceof OrgAccessError;
				if (!known) console.warn(`[Sync/push] ${table}/${uuid}:`, err?.message);
				errors.push({ uuid, table, error: known ? err.message : "Не удалось применить изменение" });
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
			message: "Ошибка синхронизации",
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /sync/meta — метаинформация для определения необходимости синхронизации
// ═══════════════════════════════════════════════════════════════════════════

router.get("/sync/meta", async (req, res) => {
	try {
		const meta = {};

		for (const [endpoint, def] of Object.entries(PULL_TABLES)) {
			if (!prisma[def.model]) continue;
			if (!(await pullAccess(req, endpoint, def))) continue;
			const scope = await pullScopeWhere(req, def);
			if (scope === null) continue;

			try {
				const result = await prisma[def.model].aggregate({
					where: { AND: [def.where ?? {}, scope] },
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
		return res.status(500).json({ success: false, message: "Ошибка синхронизации" });
	}
});

export default router;
