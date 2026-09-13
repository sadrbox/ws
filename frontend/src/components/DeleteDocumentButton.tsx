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
import apiClient from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import { notify } from "src/components/TechMessages/store";
import { errorStatus, errorText, reportError } from "src/services/errors/route";
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
      showToast(translate("documentDeleted"), "success", 3000);
      onDeleted?.();
      // Закрываем форму удалённого документа (force — сохранять нечего).
      if (paneId) await requestClose(paneId, { force: true });
    } catch (err: unknown) {
      /*
       * ДЛИННОЕ — В ЖУРНАЛ, КОРОТКОЕ — ТОСТОМ. Отказ 409 перечисляет мешающие ссылки: за
       * восемь секунд такой список не прочитать, а другого следа он не оставлял. Теперь
       * подробности остаются в «Технических сообщениях», а тост говорит главное — что
       * удалить нельзя и сколько ссылок мешает.
       */
      const status = errorStatus(err);
      const text = errorText(err, translate("deleteFailed"));
      if (status === 409) {
        const refs = text.split(/[\n,;]/).filter((x) => x.trim()).length;
        notify({
          severity: "error", text, source: translate("delete"),
          toast: refs > 1 ? `${translate("deleteBlockedShort")}: ${refs}` : text,
        });
      } else {
        reportError(err, { source: translate("delete"), fallback: translate("deleteFailed") });
      }
    }
  };

  return <IconButton icon="trash" title={translate("delete")} aria-label={translate("delete")} onClick={handleClick} />;
};

export default DeleteDocumentButton;
