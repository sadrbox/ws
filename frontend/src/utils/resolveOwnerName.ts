import { api } from "src/services/api/client";
import { unwrapItem } from "src/utils/apiUnwrap";

/**
 * Конфигурация владельца: endpoint API и поле отображаемого имени.
 */
const OWNER_CONFIG: Record<string, { endpoint: string; displayField: string }> = {
  organization: { endpoint: "organizations", displayField: "name" },
  counterparty: { endpoint: "counterparties", displayField: "name" },
  contactperson: { endpoint: "contactpersons", displayField: "fullName" },
  employee: { endpoint: "employees", displayField: "fullName" },
};

/**
 * Загружает отображаемое имя владельца по ownerType + ownerUuid.
 * Возвращает пустую строку если ownerType/ownerUuid не указаны или запрос неуспешен.
 */
export async function resolveOwnerName(
  ownerType: string | null | undefined,
  ownerUuid: string | null | undefined,
): Promise<string> {
  if (!ownerType || !ownerUuid) return "";

  const config = OWNER_CONFIG[ownerType];
  if (!config) return "";

  try {
    const item = unwrapItem<Record<string, unknown> | null>(
      await api.get(`/${config.endpoint}/${ownerUuid}`),
    );
    return String(
      item?.[config.displayField] ?? item?.name ?? item?.fullName ?? "",
    );
  } catch {
    return "";
  }
}
