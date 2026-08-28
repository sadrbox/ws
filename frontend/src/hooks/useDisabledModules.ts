import { useQuery } from "@tanstack/react-query";
import { api } from "src/services/api/client";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

/**
 * Набор ОТКЛЮЧЁННЫХ модулей организации пользователя (E11). Питает скрытие
 * разделов в NavList. Источник — GET /module-settings; серверный гард на
 * создание документов остаётся авторитетным независимо от этого хука.
 * По умолчанию (нет данных / нет орг) — пустой набор: все модули включены.
 */
export function useDisabledModules(organizationUuid?: string): Set<string> {
  const def = useDefaultOrganization();
  const orgUuid = organizationUuid ?? def.organizationUuid ?? "";

  const { data } = useQuery<Set<string>>({
    queryKey: ["module-settings", orgUuid],
    queryFn: async () => {
      const resp = await api.get<{ disabled?: string[] }>("module-settings", {
        params: orgUuid ? { organizationUuid: orgUuid } : {},
      });
      return new Set(resp?.disabled ?? []);
    },
    staleTime: 60_000,
  });

  return data ?? new Set<string>();
}
