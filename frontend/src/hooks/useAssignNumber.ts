/**
 * useAssignNumber — присвоение номера документу («Присвоить номер»).
 *
 * Возвращает СТАБИЛЬНУЮ функцию `assign(endpoint, organizationUuid, currentNumber,
 * onAssigned, date?)`. Запрашивает у сервера номер (backend /document-number/next):
 *  • документ УЖЕ имеет номер → приводим его к текущим настройкам, СОХРАНЯЯ позицию
 *    (напр. после смены префикса: «ПГРМ-000003» → «000003»); если уже совпадает —
 *    не меняем (toast);
 *  • пусто → следующий номер по порядку СОХРАНЕНИЯ (не по дате документа).
 */
import { useCallback } from "react";
import { api } from "src/services/api/client";
import { translate } from "src/i18";
import { showToast } from "src/components/UIToast";

export function useAssignNumber() {
  return useCallback(
    async (endpoint: string, organizationUuid: string | undefined, currentNumber: string | undefined, onAssigned: (number: string) => void, date?: string, uuid?: string) => {
      const cur = (currentNumber ?? "").trim();
      try {
        const resp = await api.get<{ success?: boolean; number?: string }>("document-number/next", {
          params: {
            endpoint,
            ...(organizationUuid ? { organizationUuid } : {}),
            // Год берётся из даты документа — номер в ряду нужного года.
            ...(date ? { date } : {}),
            ...(cur ? { current: cur } : {}),
            // uuid существующего документа → при очистке поля вернётся СВОЙ номер.
            ...(uuid ? { uuid } : {}),
          },
        });
        const n = resp?.number ?? "";
        if (!n) return;
        if (cur && n === cur) {
          // Номер уже соответствует настройкам — менять нечего.
          showToast(translate("numberAlreadyAssigned"), "info", 3000);
          return;
        }
        onAssigned(n);
        if (cur) showToast(translate("numberReformatted"), "success", 3000);
      } catch (e) {
        console.error("[assign-number] failed", e);
      }
    },
    [],
  );
}
