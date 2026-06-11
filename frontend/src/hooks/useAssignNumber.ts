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

export function useAssignNumber() {
  return useCallback(
    async (endpoint: string, organizationUuid: string | undefined, onAssigned: (number: string) => void) => {
      try {
        const resp = await api.get<{ success?: boolean; number?: string }>("document-number/next", {
          params: { endpoint, ...(organizationUuid ? { organizationUuid } : {}) },
        });
        if (resp?.number) onAssigned(resp.number);
      } catch (e) {
        console.error("[assign-number] failed", e);
      }
    },
    [],
  );
}
