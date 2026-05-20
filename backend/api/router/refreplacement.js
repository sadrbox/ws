/**
 * Поиск и замена ссылок (ref-replace).
 *
 * Endpoints:
 *   GET  /ref-replace/models              — список поддерживаемых моделей
 *   GET  /ref-replace/records             — записи модели (в т.ч. удалённые)
 *   POST /ref-replace/preview             — найти ссылки на запись-источник
 *   POST /ref-replace/execute             — выполнить замену
 *   GET  /ref-replace/orphans             — найти все активные записи с FK на удалённые записи
 */

import express from "express";
import { prisma, pool } from "../../prisma/prisma-client.js";
import {
	loadFkMap,
	resolveTableName,
	REFERENCE_LABELS,
} from "../../utils/checkReferences.js";

const router = express.Router();
const ROUTE = "ref-replace";

// ── Конфигурация поддерживаемых моделей ──────────────────────────────────────
// displayField: поле, используемое как отображаемое имя записи
// label: человекочитаемое название справочника
const MODEL_CONFIG = {
	unitOfMeasure: { displayField: "shortName", label: "Единицы измерения" },
	tax: { displayField: "shortName", label: "Налоги" },
	brand: { displayField: "shortName", label: "Бренды" },
	currency: { displayField: "shortName", label: "Валюты" },
	warehouse: { displayField: "shortName", label: "Склады" },
	employee: { displayField: "fullName", label: "Сотрудники" },
	position: { displayField: "shortName", label: "Должности" },
	counterparty: { displayField: "shortName", label: "Контрагенты" },
	organization: { displayField: "shortName", label: "Организации" },
};

// ── Отображаемое поле по DB-имени таблицы (для сканирования orphans) ─────────
const TABLE_DISPLAY_FIELD = {
	products: "shortName",
	employees: "fullName",
	contracts: "shortName",
	contacts: "value",
	counterparties: "shortName",
	organizations: "shortName",
	warehouses: "shortName",
	currencies: "shortName",
	brands: "shortName",
	taxes: "shortName",
	units_of_measure: "shortName",
	positions: "shortName",
	users: "username",
	bank_accounts: "bankName",
	contact_persons: "fullName",
	todos: "title",
};

// ── Человекочитаемое имя FK-колонки ──────────────────────────────────────────
const COLUMN_LABELS = {
	unitOfMeasureUuid: "Единица измерения",
	taxUuid: "Налог",
	brandUuid: "Бренд",
	warehouseUuid: "Склад",
	warehouseFromUuid: "Склад (откуда)",
	warehouseToUuid: "Склад (куда)",
	currencyUuid: "Валюта",
	counterpartyUuid: "Контрагент",
	organizationUuid: "Организация",
	employeeUuid: "Сотрудник",
	positionUuid: "Должность",
	authorUuid: "Автор",
	contractUuid: "Договор",
	bankAccountUuid: "Банковский счёт",
	userUuid: "Пользователь",
	ownerUuid: "Владелец",
};

// ── GET /ref-replace/models ───────────────────────────────────────────────────
router.get(`/${ROUTE}/models`, (_req, res) => {
	const models = Object.entries(MODEL_CONFIG).map(([value, cfg]) => ({
		value,
		label: cfg.label,
	}));
	return res.status(200).json({ success: true, models });
});

// ── GET /ref-replace/records?model=...&includeDeleted=true ────────────────────
router.get(`/${ROUTE}/records`, async (req, res) => {
	try {
		const modelName = req.query.model;
		if (!modelName || !MODEL_CONFIG[modelName]) {
			return res
				.status(400)
				.json({ success: false, message: "Неизвестная модель" });
		}
		const cfg = MODEL_CONFIG[modelName];
		const includeDeleted = req.query.includeDeleted === "true";

		const where = includeDeleted ? {} : { deletedAt: null };

		// Некоторые модели не имеют deletedAt — избегаем ошибки Prisma
		let items;
		try {
			items = await prisma[modelName].findMany({
				where,
				orderBy: [{ [cfg.displayField]: "asc" }],
				take: 2000,
			});
		} catch {
			items = await prisma[modelName].findMany({
				orderBy: [{ [cfg.displayField]: "asc" }],
				take: 2000,
			});
		}

		return res.status(200).json({
			success: true,
			items,
			displayField: cfg.displayField,
		});
	} catch (error) {
		console.error(`GET /${ROUTE}/records error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /ref-replace/preview ─────────────────────────────────────────────────
// Тело: { model: "unitOfMeasure", sourceUuid: "..." }
// Возвращает: список таблиц со счётчиками (всего / активных) ссылок на источник
router.post(`/${ROUTE}/preview`, async (req, res) => {
	try {
		const { model: modelName, sourceUuid } = req.body;
		if (!modelName || !MODEL_CONFIG[modelName]) {
			return res
				.status(400)
				.json({ success: false, message: "Неизвестная модель" });
		}
		if (!sourceUuid) {
			return res
				.status(400)
				.json({ success: false, message: "Не указан UUID источника" });
		}

		const source = await prisma[modelName].findUnique({
			where: { uuid: sourceUuid },
		});
		if (!source) {
			return res
				.status(404)
				.json({ success: false, message: "Запись-источник не найдена" });
		}

		const tableName = resolveTableName(modelName);
		const fkMap = await loadFkMap();
		const seen = new Set(); // чтобы не дублировать table+column
		const refs = [];

		for (const refCol of ["uuid", "id"]) {
			const value = source[refCol];
			if (value == null) continue;

			const fkRefs = fkMap[`${tableName}.${refCol}`] || [];
			for (const ref of fkRefs) {
				const rule = (ref.deleteRule || "").toUpperCase();
				if (rule === "CASCADE") continue;

				const key = `${ref.table}.${ref.column}`;
				if (seen.has(key)) continue;
				seen.add(key);

				// Общее число ссылок (включая мягко удалённые строки)
				let total = 0;
				let active = 0;
				try {
					const { rows } = await pool.query(
						`SELECT COUNT(*)::int AS n FROM "${ref.table}" WHERE "${ref.column}" = $1`,
						[value],
					);
					total = rows[0]?.n ?? 0;
				} catch {
					// таблица недоступна — пропускаем
					continue;
				}
				try {
					const { rows } = await pool.query(
						`SELECT COUNT(*)::int AS n FROM "${ref.table}" WHERE "${ref.column}" = $1 AND "deletedAt" IS NULL`,
						[value],
					);
					active = rows[0]?.n ?? 0;
				} catch {
					active = total; // таблица без deletedAt — все записи «активные»
				}

				refs.push({
					table: ref.table,
					column: ref.column,
					label: REFERENCE_LABELS[ref.table] ?? ref.table,
					total,
					active,
					refCol,
				});
			}
		}

		// Сортируем: сначала с ненулевыми ссылками
		refs.sort((a, b) => b.total - a.total);

		const cfg = MODEL_CONFIG[modelName];
		return res.status(200).json({
			success: true,
			refs,
			totalRefs: refs.reduce((s, r) => s + r.total, 0),
			source: {
				uuid: source.uuid,
				id: source.id,
				label: source[cfg.displayField] ?? sourceUuid,
				isDeleted: !!source.deletedAt,
			},
		});
	} catch (error) {
		console.error(`POST /${ROUTE}/preview error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /ref-replace/execute ─────────────────────────────────────────────────
// Тело: { model: "unitOfMeasure", sourceUuid: "...", targetUuid: "..." }
// Выполняет замену в транзакции, возвращает подробный протокол
router.post(`/${ROUTE}/execute`, async (req, res) => {
	try {
		const { model: modelName, sourceUuid, targetUuid } = req.body;
		if (!modelName || !MODEL_CONFIG[modelName]) {
			return res
				.status(400)
				.json({ success: false, message: "Неизвестная модель" });
		}
		if (!sourceUuid || !targetUuid) {
			return res.status(400).json({
				success: false,
				message: "Не указан UUID источника или цели",
			});
		}
		if (sourceUuid === targetUuid) {
			return res
				.status(400)
				.json({ success: false, message: "Источник и цель совпадают" });
		}

		const [source, target] = await Promise.all([
			prisma[modelName].findUnique({ where: { uuid: sourceUuid } }),
			prisma[modelName].findUnique({ where: { uuid: targetUuid } }),
		]);
		if (!source) {
			return res
				.status(404)
				.json({ success: false, message: "Запись-источник не найдена" });
		}
		if (!target) {
			return res
				.status(404)
				.json({ success: false, message: "Запись-цель не найдена" });
		}

		const tableName = resolveTableName(modelName);
		const fkMap = await loadFkMap();
		const cfg = MODEL_CONFIG[modelName];
		const protocol = [];
		const seen = new Set();

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			for (const refCol of ["uuid", "id"]) {
				const sourceVal = source[refCol];
				const targetVal = target[refCol];
				if (sourceVal == null || targetVal == null) continue;

				const fkRefs = fkMap[`${tableName}.${refCol}`] || [];
				for (const ref of fkRefs) {
					const rule = (ref.deleteRule || "").toUpperCase();
					if (rule === "CASCADE") continue;

					const key = `${ref.table}.${ref.column}`;
					if (seen.has(key)) continue;
					seen.add(key);

					const result = await client.query(
						`UPDATE "${ref.table}" SET "${ref.column}" = $1 WHERE "${ref.column}" = $2`,
						[targetVal, sourceVal],
					);
					protocol.push({
						table: ref.table,
						column: ref.column,
						label: REFERENCE_LABELS[ref.table] ?? ref.table,
						affected: result.rowCount ?? 0,
						refCol,
					});
				}
			}

			await client.query("COMMIT");
		} catch (err) {
			await client.query("ROLLBACK");
			return res.status(500).json({
				success: false,
				message: `Ошибка при обновлении: ${err.message}`,
			});
		} finally {
			client.release();
		}

		// Сортируем: сначала те где были изменения
		protocol.sort((a, b) => b.affected - a.affected);

		const totalAffected = protocol.reduce((s, p) => s + p.affected, 0);

		return res.status(200).json({
			success: true,
			protocol,
			summary: {
				model: modelName,
				modelLabel: cfg.label,
				sourceUuid,
				sourceLabel: source[cfg.displayField] ?? sourceUuid,
				sourceIsDeleted: !!source.deletedAt,
				targetUuid,
				targetLabel: target[cfg.displayField] ?? targetUuid,
				totalAffected,
				executedAt: new Date().toISOString(),
			},
		});
	} catch (error) {
		console.error(`POST /${ROUTE}/execute error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── POST /ref-replace/safe-delete ────────────────────────────────────────────
// Тело: { model: "unitOfMeasure", uuid: "..." }
// Проверяет, что на запись нет ссылок, затем выполняет мягкое удаление.
// При наличии ссылок возвращает 409 с перечнем таблиц.
router.post(`/${ROUTE}/safe-delete`, async (req, res) => {
	try {
		const { model: modelName, uuid } = req.body;
		if (!modelName || !MODEL_CONFIG[modelName])
			return res
				.status(400)
				.json({ success: false, message: "Неизвестная модель" });
		if (!uuid)
			return res
				.status(400)
				.json({ success: false, message: "Не указан UUID" });

		const cfg = MODEL_CONFIG[modelName];
		const record = await prisma[modelName].findUnique({ where: { uuid } });
		if (!record)
			return res
				.status(404)
				.json({ success: false, message: "Запись не найдена" });
		if (record.deletedAt)
			return res
				.status(400)
				.json({ success: false, message: "Запись уже удалена" });

		// Проверяем ссылки (все, включая мягко удалённые строки)
		const tableName = resolveTableName(modelName);
		const fkMap = await loadFkMap();
		const seen = new Set();
		let totalRefs = 0;
		const refs = [];

		for (const refCol of ["uuid", "id"]) {
			const value = record[refCol];
			if (value == null) continue;

			const fkRefs = fkMap[`${tableName}.${refCol}`] || [];
			for (const ref of fkRefs) {
				const rule = (ref.deleteRule || "").toUpperCase();
				if (rule === "CASCADE") continue;

				const key = `${ref.table}.${ref.column}`;
				if (seen.has(key)) continue;
				seen.add(key);

				try {
					const { rows } = await pool.query(
						`SELECT COUNT(*)::int AS n FROM "${ref.table}" WHERE "${ref.column}" = $1`,
						[value],
					);
					const n = rows[0]?.n ?? 0;
					if (n > 0) {
						totalRefs += n;
						refs.push({
							table: ref.table,
							column: ref.column,
							label: REFERENCE_LABELS[ref.table] ?? ref.table,
							total: n,
						});
					}
				} catch {
					// таблица недоступна — пропускаем
				}
			}
		}

		if (totalRefs > 0) {
			refs.sort((a, b) => b.total - a.total);
			return res.status(409).json({
				success: false,
				message: `Невозможно удалить — запись используется в ${totalRefs} ссылках`,
				refs,
				totalRefs,
			});
		}

		// Мягкое удаление
		const updated = await prisma[modelName].update({
			where: { uuid },
			data: { deletedAt: new Date() },
		});

		return res.status(200).json({
			success: true,
			label: record[cfg.displayField] ?? uuid,
			deletedAt: updated.deletedAt.toISOString(),
		});
	} catch (error) {
		console.error(`POST /${ROUTE}/safe-delete error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── GET /ref-replace/orphans ──────────────────────────────────────────────────
// Сканирует все FK-связи и возвращает активные записи, которые ссылаются на
// мягко удалённые записи (deletedAt IS NOT NULL в referenced-таблице).
// Результат: массив групп { table, column, columnLabel, tableLabel,
//   refTable, refTableLabel, records: [{ uuid, id, label, refUuid, refLabel }] }
router.get(`/${ROUTE}/orphans`, async (req, res) => {
	try {
		const limitPerGroup = Math.min(parseInt(req.query.limit) || 200, 1000);

		// 1. Получаем FK-карту
		const fkMap = await loadFkMap();

		// 2. Таблицы с колонкой deletedAt
		const { rows: dtRows } = await pool.query(`
			SELECT DISTINCT table_name
			FROM information_schema.columns
			WHERE table_schema = 'public' AND column_name = 'deletedAt'
		`);
		const hasSoftDelete = new Set(dtRows.map((r) => r.table_name));

		const groups = [];
		const processed = new Set();

		for (const [key, fkRefs] of Object.entries(fkMap)) {
			const dotIdx = key.lastIndexOf(".");
			const refTable = key.slice(0, dotIdx);
			const refCol = key.slice(dotIdx + 1);

			// Интересуют только soft-deleteable справочные таблицы
			if (!hasSoftDelete.has(refTable)) continue;

			for (const ref of fkRefs) {
				const rule = (ref.deleteRule || "").toUpperCase();
				if (rule === "CASCADE") continue;

				// Ссылающаяся таблица тоже должна иметь deletedAt (для проверки активности)
				if (!hasSoftDelete.has(ref.table)) continue;

				const groupKey = `${ref.table}.${ref.column}`;
				if (processed.has(groupKey)) continue;
				processed.add(groupKey);

				const displayField = TABLE_DISPLAY_FIELD[ref.table];
				const refDisplayField = TABLE_DISPLAY_FIELD[refTable];

				// Строим SELECT для label с fallback на uuid
				const labelExpr = displayField
					? `r."${displayField}"::text`
					: `r.uuid::text`;
				const refLabelExpr = refDisplayField
					? `ref."${refDisplayField}"::text`
					: `ref.uuid::text`;

				try {
					const { rows } = await pool.query(
						`SELECT
							r.uuid       AS record_uuid,
							r.id         AS record_id,
							${labelExpr} AS record_label,
							ref.uuid     AS ref_uuid,
							${refLabelExpr} AS ref_label,
							ref."deletedAt" AS ref_deleted_at
						FROM   "${ref.table}"  r
						JOIN   "${refTable}"   ref
							ON r."${ref.column}" = ref."${refCol}"
						WHERE  r."deletedAt"   IS NULL
						AND    ref."deletedAt" IS NOT NULL
						ORDER BY r.id
						LIMIT  $1`,
						[limitPerGroup],
					);

					if (rows.length > 0) {
						groups.push({
							table: ref.table,
							column: ref.column,
							columnLabel: COLUMN_LABELS[ref.column] ?? ref.column,
							tableLabel: REFERENCE_LABELS[ref.table] ?? ref.table,
							refTable,
							refTableLabel: REFERENCE_LABELS[refTable] ?? refTable,
							totalFound: rows.length,
							hasMore: rows.length === limitPerGroup,
							records: rows.map((r) => ({
								uuid: r.record_uuid,
								id: r.record_id,
								label: r.record_label ?? r.record_uuid,
								refUuid: r.ref_uuid,
								refLabel: r.ref_label ?? r.ref_uuid,
								refDeletedAt: r.ref_deleted_at,
							})),
						});
					}
				} catch {
					// Таблица или колонка недоступна — пропускаем
				}
			}
		}

		// Сортируем: сначала с большим числом нарушений
		groups.sort((a, b) => b.totalFound - a.totalFound);

		return res.status(200).json({
			success: true,
			groups,
			totalViolations: groups.reduce((s, g) => s + g.totalFound, 0),
		});
	} catch (error) {
		console.error(`GET /${ROUTE}/orphans error:`, error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
