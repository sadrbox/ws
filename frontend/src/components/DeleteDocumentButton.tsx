/**
 * DeleteDocumentButton — кнопка «Удалить» в шапке формы документа.
 *
 * Удаляет ТЕКУЩИЙ открытый документ: подтверждение → DELETE → закрытие панели.
 * Если документ нельзя удалить (например, он является «Основанием» для другого —
 * сервер вернёт 409), показывается понятный toast, а панель остаётся открытой.
 * Самоскрывается, пока документ не сохранён (нет uuid).
 */
import { FC } from "react";
import { translate } from "src/i18";
import { useQueryClient } from "@tanstack/react-query";
import IconButton from "src/components/IconButton/IconButton";
import { useAppContext } from "src/app/context";
import apiClient, { type RequestError } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { isSyncableEndpoint } from "src/services/offlineDataService";
import { upsertRecords, getRecordByUuid } from "src/services/offlineDb";

const DeleteDocumentButton: FC<{
  endpoint: string;
  uuid?: string;
  /** ID панели формы — закрываем после успешного удаления (force, без guard). */
  paneId?: string;
  /** Доп. колбэк после успешного удаления (например, обновить связанные данные). */
  onDeleted?: () => void;
}> = ({ endpoint, uuid, paneId, onDeleted }) => {
  const { actions: { confirm }, windows: { requestClose } } = useAppContext();
  const queryClient = useQueryClient();

  if (!uuid) return null;

  const handleClick = async () => {
    if (!(await confirm("Удалить документ?"))) return;
    try {
      await apiClient.delete(`/${endpoint}/${uuid}`);
      // Офлайн-кэш: помечаем запись удалённой, чтобы не висела в списке.
      if (isSyncableEndpoint(endpoint)) {
        try {
          const existing = await getRecordByUuid(endpoint, uuid);
          if (existing) await upsertRecords(endpoint, [{ ...existing, deletedAt: new Date().toISOString() }]);
        } catch { /* best-effort — офлайн-кэш не критичен */ }
      }
      // Обновляем открытый *List (если есть) — ключ react-query = [endpoint].
      void queryClient.invalidateQueries({ queryKey: [endpoint] });
      showToast("Документ удалён", "success", 3000);
      onDeleted?.();
      // Закрываем форму удалённого документа (force — сохранять нечего).
      if (paneId) await requestClose(paneId, { force: true });
    } catch (err: unknown) {
      const data = (err as RequestError)?.response?.data;
      const msg =
        (err as RequestError)?.response?.status === 409 && typeof data?.message === "string"
          ? data.message
          : data?.message || "Не удалось удалить документ";
      showToast(msg, "error", 8000);
    }
  };

  return <IconButton icon="trash" title={translate("delete")} aria-label={translate("delete")} onClick={handleClick} />;
};

export default DeleteDocumentButton;
