/**
 * Контроллер связей между таблицами.
 *
 * Перед удалением записи в справочнике (soft-delete) проверяет, на неё ли
 * ссылаются другие таблицы. Если есть активные связи — возвращает их перечень,
 * чтобы можно было показать пользователю внятное сообщение вместо
 * молчаливого осиротевания внешних ключей.
 *
 * Особенности проекта:
 *   - В большинстве справочников применяется soft-delete (`deletedAt`).
 *     PostgreSQL не нарушает FK при soft-delete, поэтому проверка делается
 *     вручную: считаем активные строки (deletedAt IS NULL) в таблицах,
 *     у которых есть FK на удаляемую запись.
 *   - Чтобы не зависеть от знаний о конкретной модели, метаданные
 *     FK берём из `information_schema` PostgreSQL.
 */

import { Prisma } from "@prisma/client";
import { prisma, pool } from "../prisma/prisma-client.js";

/**
 * Кэш карты FK: { [referencedTable]: Array<{ table, column, refColumn }> }
 * Заполняется однократно при первом обращении.
 */
let fkMapCache = null;

/**
 * Карта Prisma-модели → имя таблицы в БД (`@@map`).
 * Используется, чтобы вызывать `guardReferences(res, "unitOfMeasure", ...)` —
 * без знания о SQL-имени таблицы из роутера.
 */
let modelToTableCache = null;

function buildModelToTable() {
	if (modelToTableCache) return modelToTableCache;
	const map = {};
	try {
		for (const m of Prisma.dmmf.datamodel.models) {
			const camel = m.name.charAt(0).toLowerCase() + m.name.slice(1);
			map[camel] = m.dbName || m.name;
			map[m.name] = m.dbName || m.name;
		}
	} catch {
		// Если DMMF недоступен — карта останется пустой; будет работать только
		// явная передача SQL-имени таблицы.
	}
	modelToTableCache = map;
	return map;
}

/**
 * Преобразует имя Prisma-модели (`unitOfMeasure` / `UnitOfMeasure`) в SQL-имя
 * таблицы (`units_of_measure`). Если на вход уже SQL-имя — возвращает как есть.
 */
export function resolveTableName(name) {
	if (!name) return name;
	const map = buildModelToTable();
	return map[name] || name;
}

export async function loadFkMap() {
	if (fkMapCache) return fkMapCache;

	const { rows } = await pool.query(`
    SELECT
      kcu.table_name      AS table,
      kcu.column_name     AS column,
      ccu.table_name      AS ref_table,
      ccu.column_name     AS ref_column,
      rc.delete_rule      AS delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name  = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
  `);

	const map = {};
	for (const r of rows) {
		const key = `${r.ref_table}.${r.ref_column}`;
		if (!map[key]) map[key] = [];
		map[key].push({
			table: r.table,
			column: r.column,
			refTable: r.ref_table,
			refColumn: r.ref_column,
			deleteRule: r.delete_rule, // NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT
		});
	}

	fkMapCache = map;
	return map;
}

/**
 * Возвращает список активных ссылок (deletedAt IS NULL) из других таблиц
 * на запись `targetTable.refColumn = value`.
 *
 * @param {string} targetTable  — таблица справочника (БД-имя `units_of_measure`
 *                                либо имя Prisma-модели `unitOfMeasure`/`UnitOfMeasure`).
 * @param {object} keyValues    — { uuid?: string, id?: number }
 * @returns {Promise<Array<{ table: string, column: string, count: number, label: string }>>}
 */
export async function findReferences(targetTable, keyValues) {
	const tableName = resolveTableName(targetTable);
	const fkMap = await loadFkMap();
	const refCols = ["uuid", "id"].filter((k) => keyValues[k] != null);

	const found = [];
	for (const refCol of refCols) {
		const refs = fkMap[`${tableName}.${refCol}`] || [];
		for (const ref of refs) {
			// CASCADE — это явная parent-child связь (например, sale → sale_items),
			// удаление родителя должно автоматически унести детей. Такие ссылки
			// не блокируют операцию.
			//
			// Все остальные правила (NO ACTION / RESTRICT / SET NULL / SET DEFAULT)
			// блокируем на уровне приложения: молчаливое обнуление FK теряет
			// связь между документами и приводит к "сиротам", что в учётной
			// системе недопустимо.
			const rule = (ref.deleteRule || "").toUpperCase();
			if (rule === "CASCADE") continue;

			// Подсчитываем только АКТИВНЫЕ ссылки (если есть deletedAt — учитываем).
			// information_schema не даёт инфо о наличии колонки; пробуем оба варианта.
			const value = keyValues[refCol];
			const sqlActive = `SELECT COUNT(*)::int AS n
                         FROM "${ref.table}"
                         WHERE "${ref.column}" = $1
                           AND "deletedAt" IS NULL`;
			const sqlAny = `SELECT COUNT(*)::int AS n
                      FROM "${ref.table}"
                      WHERE "${ref.column}" = $1`;
			let n = 0;
			try {
				const { rows } = await pool.query(sqlActive, [value]);
				n = rows[0]?.n ?? 0;
			} catch {
				try {
					const { rows } = await pool.query(sqlAny, [value]);
					n = rows[0]?.n ?? 0;
				} catch {
					n = 0;
				}
			}
			if (n > 0) {
				found.push({
					table: ref.table,
					column: ref.column,
					count: n,
					label: REFERENCE_LABELS[ref.table] ?? ref.table,
				});
			}
		}
	}

	return found;
}

/**
 * Человекочитаемое название таблицы для сообщения пользователю.
 */
export const REFERENCE_LABELS = {
	products: "Номенклатура",
	sale_items: "Строки реализации",
	purchase_items: "Строки поступления",
	contracts: "Договора",
	contacts: "Контакты",
	contact_persons: "Контактные лица",
	bank_accounts: "Банковские счета",
	counterparties: "Контрагенты",
	organizations: "Организации",
	sales: "Реализации",
	purchases: "Поступления",
	outgoing_invoices: "СФ исходящие",
	incoming_invoices: "СФ входящие",
	payment_invoices: "Счета на оплату",
	inventory_transfers: "Перемещения ТМЗ",
	cash_receipt_orders: "Приходные кассовые ордера",
	cash_expense_orders: "Расходные кассовые ордера",
	payroll_calculations: "Начисления ЗП",
	payroll_payments: "Выплаты ЗП",
	brands: "Бренды",
	units_of_measure: "Единицы измерения",
	currencies: "Валюты",
	taxes: "Налоги",
	warehouses: "Склады",
	employees: "Сотрудники",
	employee_histories: "Кадровая история",
	positions: "Должности",
	users: "Пользователи",
	user_permissions: "Права пользователей",
	access_rights: "Права доступа",
	files: "Файлы",
	todos: "Задачи",
	notifications: "Уведомления",
	scheduled_tasks: "Регламентные задачи",
};

/**
 * Формирует сообщение об ошибке для ответа клиенту.
 * @param {Array} refs — результат findReferences
 * @returns {string}
 */
export function formatReferencesMessage(refs) {
	if (!refs.length) return "";
	const lines = refs.map((r) => `• ${r.label}: ${r.count} шт.`);
	return `Невозможно удалить — запись используется в других документах:\n${lines.join("\n")}`;
}

/**
 * Express-helper: проверяет связи и, если есть — отправляет 409 ответ.
 * Возвращает true если ответ уже отправлен (вызов прервать), иначе false.
 *
 * @example
 *   if (await guardReferences(res, "units_of_measure", { uuid })) return;
 *   await prisma.unitOfMeasure.update({ where: { uuid }, data: { deletedAt: new Date() } });
 */
export async function guardReferences(res, targetTable, keyValues) {
	const refs = await findReferences(targetTable, keyValues);
	if (refs.length === 0) return false;
	res.status(409).json({
		success: false,
		message: formatReferencesMessage(refs),
		references: refs,
	});
	return true;
}

/**
 * Универсальный обработчик DELETE по `:id` (id или uuid в одном параметре).
 *
 * Делает 3 вещи:
 *   1) Ищет запись `prisma[modelName].findUnique({ where })` → 404 если нет.
 *   2) Проверяет внешние ссылки через guardReferences → 409 если используется.
 *   3) Если `softDelete=true` — `update({ data:{ deletedAt: new Date() }})`,
 *      иначе `delete({ where })`.
 *
 * @param {object}  opts
 * @param {object}  opts.req                 — Express request
 * @param {object}  opts.res                 — Express response
 * @param {object}  opts.prisma              — экземпляр prisma client
 * @param {string}  opts.modelName           — camelCase Prisma-модель ("unitOfMeasure")
 * @param {string}  [opts.notFoundMessage]   — текст 404-ответа
 * @param {boolean} [opts.softDelete=false]  — true → update deletedAt, false → delete
 */
export async function handleDelete({
	req,
	res,
	prisma,
	modelName,
	notFoundMessage = "Не найдено",
	softDelete = false,
}) {
	const param = req.params.id ?? req.params.uuid;
	const numId = Number(param);
	const isNumeric = !isNaN(numId) && Number.isInteger(numId) && numId > 0;
	const where = isNumeric ? { id: numId } : { uuid: param };

	try {
		const existing = await prisma[modelName].findUnique({ where });
		if (!existing) {
			return res.status(404).json({ success: false, message: notFoundMessage });
		}

		if (
			await guardReferences(res, modelName, {
				uuid: existing.uuid,
				id: existing.id,
			})
		)
			return;

		if (softDelete) {
			await prisma[modelName].update({
				where,
				data: { deletedAt: new Date() },
			});
		} else {
			await prisma[modelName].delete({ where });
		}
		return res.status(200).json({ success: true, message: "Удалено" });
	} catch (error) {
		if (error.code === "P2025") {
			return res.status(404).json({ success: false, message: notFoundMessage });
		}
		if (error.code === "P2003") {
			return res.status(409).json({
				success: false,
				message: "Невозможно удалить — запись используется в других документах",
			});
		}
		console.error(`DELETE ${modelName} error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
}

export default {
	findReferences,
	formatReferencesMessage,
	guardReferences,
	handleDelete,
};
