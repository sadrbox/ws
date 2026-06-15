/**
 * useAssignNumber — присвоение следующего номера документу («Присвоить номер»).
 *
 * Возвращает СТАБИЛЬНУЮ функцию `assign(endpoint, organizationUuid, currentNumber,
 * onAssigned, date?)`. Запрашивает у сервера предпросмотр следующего номера
 * (backend /document-number/next → peekNextNumber): тот же счётчик, что и при
 * автосохранении, с учётом года (по `date`) и самовосстановлением до максимума
 * журнала. Поэтому превью совпадает с тем, что реально присвоится при сохранении.
 */
import { useCallback } from "react";
import { api } from "src/services/api/client";
import { translate } from "src/i18";
import { showToast } from "src/components/UIToast";

export function useAssignNumber() {
  return useCallback(
    async (endpoint: string, organizationUuid: string | undefined, currentNumber: string | undefined, onAssigned: (number: string) => void, date?: string) => {
      // Документу уже присвоен номер — НЕ переназначаем (он занимает место в
      // последовательности; новое присвоение «перепрыгнуло» бы и нарушило порядок).
      // Чтобы сменить номер — сначала очистить поле, затем «Присвоить номер».
      if (currentNumber && currentNumber.trim() !== "") {
        showToast(translate("numberAlreadyAssigned"), "warning", 3000);
        return;
      }
      try {
        const resp = await api.get<{ success?: boolean; number?: string }>("document-number/next", {
          params: {
            endpoint,
            ...(organizationUuid ? { organizationUuid } : {}),
            // Год берётся из даты документа — превью соответствует ряду нужного года.
            ...(date ? { date } : {}),
          },
        });
        if (resp?.number) onAssigned(resp.number);
      } catch (e) {
        console.error("[assign-number] failed", e);
      }
    },
    [],
  );
}
