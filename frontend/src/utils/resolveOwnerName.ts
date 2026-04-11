import apiClient from "src/services/api/client";

/**
 * Маппинг ownerType → endpoint API
 */
const OWNER_ENDPOINT_MAP: Record<string, string> = {
  organization: "organizations",
  counterparty: "counterparties",
  contactperson: "contactpersons",
  employee: "employees",
};

/**
 * Определяет какое поле использовать для отображаемого имени
 */
const OWNER_DISPLAY_FIELD_MAP: Record<string, string> = {
  organization: "shortName",
  counterparty: "shortName",
  contactperson: "fullName",
  employee: "fullName",
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

  const endpoint = OWNER_ENDPOINT_MAP[ownerType];
  if (!endpoint) return "";

  try {
    const res = await apiClient.get(`/${endpoint}/${ownerUuid}`);
    const item = res.data?.item ?? res.data;
    const displayField = OWNER_DISPLAY_FIELD_MAP[ownerType] || "shortName";
    return item?.[displayField] ?? item?.shortName ?? item?.fullName ?? "";
  } catch {
    return "";
  }
}
