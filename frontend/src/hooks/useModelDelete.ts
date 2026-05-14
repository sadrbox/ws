import { useCallback } from "react";
import apiClient from "src/services/api/client";
import type { TDataItem } from "src/components/Table/types";
import { useAppContext, getComponentName } from "src/app";
import { showToast } from "src/components/UIToast";
import { isSyncableEndpoint } from "src/services/offlineDataService";
import { upsertRecords, getRecordByUuid } from "src/services/offlineDb";

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
			if (items.length === 0) return;

			const message =
				items.length === 1
					? `Удалить запись #${items[0].id}?`
					: `Удалить записи (${items.length} шт.)?`;

			const confirmed = await confirm(message);
			if (!confirmed) return;

			const errors: string[] = [];
			const deletedUuids = new Set<string>();
			const deletedIds = new Set<number>();

			for (const item of items) {
				const key = item.uuid || item.id;
				try {
					await apiClient.delete(`/${model}/${key}`);
					if (item.uuid) deletedUuids.add(String(item.uuid));
					if (item.id != null) deletedIds.add(Number(item.id));
				} catch (err: any) {
					const status = err?.response?.status;
					const data = err?.response?.data;
					// 409 — конфликт (FK / связанные записи). Показываем подробности.
					if (status === 409) {
						const refsMsg =
							typeof data?.message === "string"
								? data.message
								: `Запись #${item.id} используется и не может быть удалена`;
						errors.push(refsMsg);
					} else {
						const msg = data?.message || `Ошибка удаления #${item.id}`;
						errors.push(msg);
					}
				}
			}

			// ── 1) Mark-as-deleted в Dexie для синхронизируемых endpoint-ов ──────
			if (deletedUuids.size > 0 && isSyncableEndpoint(model)) {
				const now = new Date().toISOString();
				const updates: any[] = [];
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
			if (errors.length > 0) {
				showToast(
					errors.length === 1
						? errors[0]
						: `Ошибки при удалении:\n${errors.join("\n")}`,
					"error",
					8000,
				);
			} else if (deletedUuids.size + deletedIds.size > 0) {
				showToast(
					items.length === 1
						? "Запись удалена"
						: `Удалено записей: ${items.length}`,
					"success",
					3000,
				);
			}

			void refetch();
		},
		[model, refetch, confirm, panes, requestClose],
	);

	return handleDelete;
}
