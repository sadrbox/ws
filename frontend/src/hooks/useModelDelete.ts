import { useCallback } from "react";
import apiClient, { type RequestError } from "src/services/api/client";
import type { TDataItem } from "src/components/Table/types";
import { useAppContext } from "src/app/context";
import { getComponentName } from "src/app/getComponentName";
import { showToast } from "src/components/UIToast";
import { isSyncableEndpoint } from "src/services/offlineDataService";
import { upsertRecords, getRecordByUuid, type SyncRecord } from "src/services/offlineDb";
import { describeRow } from "src/utils/describeRow";

/**
 * Хук для удаления записей модели по выбранным строкам таблицы.
 * Использует глобальный ConfirmModal из AppContext вместо window.confirm.
 *
 * Помимо удаления выполняет «уборку» состояния, чтобы запись не оставалась
 * на клиенте видимой/редактируемой:
 *   1. Mark-as-deleted в локальном кэше Dexie (если endpoint синхронизируемый).
 *      Иначе после оффлайн-fallback запись осталась бы видимой в списке.
 *   2. Закрытие открытых Pane (форм), которые редактируют удалённую запись.
 *      Иначе пользователь продолжал бы редактировать «фантом», а save→404.
 *   3. Обработка 409 (FK / связанные записи) с показом понятного toast вместо
 *      браузерного alert. Бэкенд возвращает { success:false, message, references? }.
 *
 * При удалении нескольких строк использует POST /{model}/batch-delete вместо
 * отдельных DELETE-запросов на каждую запись.
 *
 * @param model — endpoint модели (например "organizations")
 * @param refetch — функция обновления списка после удаления
 */
export function useModelDelete(
	model: string,
	refetch: () => void | Promise<unknown>,
) {
	const {
		actions: { confirm },
		windows: { panes, requestClose },
	} = useAppContext();

	const handleDelete = useCallback(
		async (selectedRowIds: Set<number>, tableRows: TDataItem[]) => {
			const items = tableRows.filter((r) => selectedRowIds.has(Number(r.id)));
			if (items.length === 0) return { deletedIds: new Set<number>() };

			// Понятный текст подтверждения: имя сущности + № документа-дата (или ID-имя),
			// списком при множественном выборе. confirm рендерит как HTML → экранируем.
			const esc = (s: string) =>
				s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			const MAX_LIST = 12;
			const message =
				items.length === 1
					? `Удалить ${esc(describeRow(model, items[0]))}?`
					: `Удалить выбранные (${items.length}):\n` +
						items
							.slice(0, MAX_LIST)
							.map((r) => `• ${esc(describeRow(model, r))}`)
							.join("\n") +
						(items.length > MAX_LIST
							? `\n… и ещё ${items.length - MAX_LIST}`
							: "");

			const confirmed = await confirm(message);
			// Отмена — ничего не удалено; возвращаем пустой набор (таблица не двигает activeRow).
			if (!confirmed) return { deletedIds: new Set<number>() };

			const errors: string[] = [];
			const deletedUuids = new Set<string>();
			const deletedIds = new Set<number>();

			/** Удалить ОДНУ запись через DELETE /{model}/{key}. Ошибки — в errors. */
			const deleteOne = async (item: TDataItem) => {
				const key = item.uuid || item.id;
				try {
					await apiClient.delete(`/${model}/${key}`);
					if (item.uuid) deletedUuids.add(String(item.uuid));
					if (item.id != null) deletedIds.add(Number(item.id));
				} catch (err: unknown) {
					const status = (err as RequestError)?.response?.status;
					const data = (err as RequestError)?.response?.data;
					if (status === 409) {
						const refsMsg =
							typeof data?.message === "string"
								? data.message
								: `Запись ${item.id} используется и не может быть удалена`;
						errors.push(refsMsg);
					} else {
						const msg = data?.message || `Ошибка удаления ${item.id}`;
						errors.push(msg);
					}
				}
			};

			if (items.length > 1) {
				// ── Batch-удаление через POST /{model}/batch-delete ───────────────
				const uuids = items.map((i) => i.uuid).filter(Boolean);
				try {
					// ВАЖНО: apiClient отдаёт полный AxiosResponse (интерцептор возвращает
					// response), поэтому тело ответа — в .data. Раньше здесь читалось
					// resp?.failed, что ВСЕГДА давало undefined: неудалённые записи
					// (напр. на которые есть ссылки) считались удалёнными, а их ошибки
					// терялись. Читаем resp.data.failed.
					const resp = await apiClient.post<{
						failed?: Array<{ uuid: string; message: string }>;
					}>(`/${model}/batch-delete`, { uuids });
					const failed = resp.data?.failed ?? [];
					const failedUuids = new Set(failed.map((f) => f.uuid));
					for (const item of items) {
						if (item.uuid && !failedUuids.has(String(item.uuid))) {
							deletedUuids.add(String(item.uuid));
							if (item.id != null) deletedIds.add(Number(item.id));
						}
					}
					for (const f of failed) {
						errors.push(f.message);
					}
				} catch (err: unknown) {
					// Батч-роута у модели может не быть (журнал действий, задачи,
					// пользователи) — тогда сервер отвечает 404, и раньше пользователь
					// получал «Ошибка пакетного удаления», хотя записи удалимы
					// поштучно. Мягко деградируем: удаляем по одной.
					if ((err as RequestError)?.response?.status === 404) {
						for (const item of items) await deleteOne(item);
					} else {
						const msg =
							(err as RequestError)?.response?.data?.message || "Ошибка пакетного удаления";
						errors.push(msg);
					}
				}
			} else {
				await deleteOne(items[0]);
			}

			// ── 1) Mark-as-deleted в Dexie для синхронизируемых endpoint-ов ──────
			if (deletedUuids.size > 0 && isSyncableEndpoint(model)) {
				const now = new Date().toISOString();
				const updates: SyncRecord[] = [];
				for (const uuid of deletedUuids) {
					try {
						const existing = await getRecordByUuid(model, uuid);
						if (existing) updates.push({ ...existing, deletedAt: now });
					} catch {
						// best-effort: офлайн-кэш не критичен
					}
				}
				if (updates.length > 0) {
					await upsertRecords(model, updates).catch(() => {});
				}
			}

			// ── 2) Закрываем открытые Pane для удалённых записей ─────────────────
			//    uniqId формируется как "<FormName>-<uuid|id>" (см. app/index.tsx),
			//    но надёжнее искать по data.uuid/data.id текущих panes.
			if (deletedUuids.size > 0 || deletedIds.size > 0) {
				const toClose = panes.filter((p) => {
					const name = getComponentName(p.component);
					if (name.endsWith("List")) return false; // *List — не одна запись
					const d = (p as { data?: TDataItem }).data;
					if (!d) return false;
					if (d.uuid && deletedUuids.has(String(d.uuid))) return true;
					if (d.id != null && deletedIds.has(Number(d.id))) return true;
					return false;
				});
				for (const p of toClose) {
					// force=true — пропускаем beforeClose-гарды (запись уже удалена,
					// сохранять нечего).
					await requestClose(p.uniqId, { force: true });
				}
			}

			// ── 3) Показываем результат через toast (вместо native alert) ────────
			//   Частичный результат (удалено не всё) — отдельное предупреждение, где
			//   видно и сколько удалено, и сколько/почему НЕ удалено.
			const deletedCount = deletedIds.size;
			const failedCount = errors.length;
			if (deletedCount > 0 && failedCount > 0) {
				showToast(
					`Удалено: ${deletedCount}. Не удалось удалить: ${failedCount}.\n${errors.join("\n")}`,
					"warning",
					9000,
				);
			} else if (failedCount > 0) {
				showToast(
					failedCount === 1
						? errors[0]
						: `Не удалось удалить (${failedCount}):\n${errors.join("\n")}`,
					"error",
					9000,
				);
			} else if (deletedCount > 0) {
				showToast(
					deletedCount === 1
						? "Запись удалена"
						: `Удалено записей: ${deletedCount}`,
					"success",
					3000,
				);
			}

			void refetch();
			return { deletedIds };
		},
		[model, refetch, confirm, panes, requestClose],
	);

	return handleDelete;
}
