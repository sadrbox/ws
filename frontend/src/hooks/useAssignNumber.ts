/**
 * useAssignNumber — присвоение следующего номера документу («Присвоить номер»).
 *
 * Возвращает СТАБИЛЬНУЮ функцию `assign(endpoint, organizationUuid, onAssigned)`.
 * Запрашивает у сервера следующий номер (числовой максимум в журнале + 1, с
 * корректным форматом — backend /document-number/next). Сервер устойчив к
 * «грязным» данным (разная ширина/префиксы), поэтому номера уникальны и
 * последовательны.
 */
import { useCallback } from "react";
import { api } from "src/services/api/client";
import { translate } from "src/i18";
import { showToast } from "src/components/UIToast";

export function useAssignNumber() {
  return useCallback(
    async (endpoint: string, organizationUuid: string | undefined, currentNumber: string | undefined, onAssigned: (number: string) => void) => {
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
