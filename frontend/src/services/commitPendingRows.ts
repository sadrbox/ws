import apiClient, { type RequestError } from "src/services/api/client";
import { translateError } from "src/i18";
import type { TDataItem } from "src/components/Table/types";

/** Поля, которые не учитываются при проверке «пустая ли строка» */
const SKIP_FIELDS = new Set(["_pendingAction", "id", "uuid", "_tempId"]);

/**
 * Универсальная функция коммита pending-строк SubTable.
 *
 * Два режима:
 * 1. **Простой** (generic) — все поля строки (кроме служебных) отправляются «как есть».
 *    Подходит для contacts, bankaccounts, contracts, employee-histories и т.д.
 *
 * 2. **С кастомными payload-функциями** — передаются `createPayload` / `updatePayload`.
 *    Используется если payload отличается от набора полей в строке (например saleitems).
 *
 * @param endpoint      API endpoint (без `/`), например `"contacts"`, `"saleitems"`
 * @param rows          массив pending-строк
 * @param parentUuid    UUID родительской записи
 * @param parentField   имя FK-поля (например `"organizationUuid"`)
 * @param tableName     человекочитаемое имя таблицы для сообщения об ошибке
 * @param options       опциональные createPayload/updatePayload
 */
export async function commitPendingRows(
	endpoint: string,
	rows: TDataItem[],
	parentUuid: string,
	parentField: string,
	tableName: string,
	options?: {
		createPayload?: (row: TDataItem) => Record<string, unknown>;
		updatePayload?: (row: TDataItem) => Record<string, unknown>;
		/** Дополнительные поля-ключи, специфичные для endpoint, которые надо исключить из проверки «пустая строка» */
		extraSkipFields?: string[];
		/** Дополнительные поля, которые добавляются к каждому payload (например { ownerType: "organization" }) */
		extraFields?: Record<string, unknown>;
		/** Если true — не добавлять [parentField]: parentUuid к payload (createPayload сам отвечает за все поля) */
		skipParentField?: boolean;
		/** Batch endpoint (без /). Если задан — все строки отправляются одним POST /{batchEndpoint} */
		batchEndpoint?: string;
	},
): Promise<void> {
	if (!rows.length) return;

	const skipSet = new Set(SKIP_FIELDS);
	skipSet.add(parentField);
	if (options?.extraSkipFields) {
		for (const f of options.extraSkipFields) skipSet.add(f);
	}

	// ── Batch mode ────────────────────────────────────────────────────────────
	if (options?.batchEndpoint) {
		const operations: unknown[] = [];
		for (const row of rows) {
			if (!row._pendingAction) continue;
			const extra = options?.extraFields ?? {};
			if (row._pendingAction === "create") {
				const hasData = Object.entries(row).some(
					([k, v]) => !skipSet.has(k) && v !== "" && v !== null && v !== undefined && v !== 0,
				);
				if (!hasData) continue;
				const data = options?.createPayload
					? { ...options.createPayload(row), ...(options?.skipParentField ? {} : { [parentField]: parentUuid }), ...extra }
					: { ...buildGenericPayload(row, parentField, parentUuid), ...extra };
				operations.push({ action: "create", data });
			} else if (row._pendingAction === "update" && row.uuid) {
				const data = options?.updatePayload
					? { ...options.updatePayload(row), ...(options?.skipParentField ? {} : { [parentField]: parentUuid }), ...extra }
					: { ...buildGenericPayload(row, parentField, parentUuid), ...extra };
				operations.push({ action: "update", uuid: row.uuid, data });
			} else if (row._pendingAction === "delete" && row.uuid) {
				operations.push({ action: "delete", uuid: row.uuid });
			}
		}
		if (!operations.length) return;
		try {
			await apiClient.post(`/${options.batchEndpoint}`, { operations });
		} catch (err: unknown) {
			const serverMsg = translateError((err as RequestError).response?.data?.message ?? "") || translateError((err as RequestError).message ?? "");
			throw new Error(serverMsg ? `${tableName}: ${serverMsg}` : `Ошибка сохранения (${tableName})`);
		}
		return;
	}

	// ── Поштучный режим (default) ─────────────────────────────────────────────
	for (const row of rows) {
		if (!row._pendingAction) continue;

		try {
			if (row._pendingAction === "create") {
				// Проверяем, заполнена ли строка — полностью пустую просто пропускаем
				const hasData = Object.entries(row).some(
					([k, v]) =>
						!skipSet.has(k) &&
						v !== "" &&
						v !== null &&
						v !== undefined &&
						v !== 0,
				);
				if (!hasData) continue;

				const extra = options?.extraFields ?? {};
				const payload = options?.createPayload
					? {
							...options.createPayload(row),
							...(options?.skipParentField
								? {}
								: { [parentField]: parentUuid }),
							...extra,
						}
					: { ...buildGenericPayload(row, parentField, parentUuid), ...extra };

				await apiClient.post(`/${endpoint}`, payload);
			} else if (row._pendingAction === "update") {
				if (!row.uuid) continue;

				const extra = options?.extraFields ?? {};
				const payload = options?.updatePayload
					? {
							...options.updatePayload(row),
							...(options?.skipParentField
								? {}
								: { [parentField]: parentUuid }),
							...extra,
						}
					: { ...buildGenericPayload(row, parentField, parentUuid), ...extra };

				await apiClient.put(`/${endpoint}/${row.uuid}`, payload);
			} else if (row._pendingAction === "delete") {
				if (!row.uuid) continue;
				await apiClient.delete(`/${endpoint}/${row.uuid}`);
			}
		} catch (err: unknown) {
			const serverMsg =
				translateError((err as RequestError).response?.data?.message ?? "") ||
				translateError((err as RequestError).message ?? "");
			throw new Error(
				serverMsg
					? `${tableName}: ${serverMsg}`
					: `Заполните данные в добавленной строке (${tableName}) или удалите пустую строку`,
			);
		}
	}
}

/** Строит payload «как есть», убирая служебные поля и вложенные объекты */
function buildGenericPayload(
	row: TDataItem,
	parentField: string,
	parentUuid: string,
): Record<string, unknown> {
	const {
		_pendingAction,
		_untouched,
		id,
		uuid: _u,
		_tempId,
		...rest
	} = row as any;
	// Убираем вложенные объекты (relation includes) — они не нужны в payload
	const payload: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(rest)) {
		if (
			v !== null &&
			typeof v === "object" &&
			!Array.isArray(v) &&
			!(v instanceof Date)
		)
			continue;
		payload[k] = v;
	}
	payload[parentField] = parentUuid;
	return payload;
}
