import type { QueryClient } from "@tanstack/react-query";

/**
 * Инвалидирует активные запросы модели связанные с конкретным родителем:
 * 1. SubTable с extra[parentField] === parentUuid (вложенная таблица этого родителя)
 * 2. Standalone-списки без parentField в extra (например, открытый ContactsList)
 *
 * НЕ трогает SubTable других родителей (extra[parentField] !== parentUuid).
 *
 * QueryKey: [model, "infinite", { ..., extra: { [parentField]: parentUuid, ... } }]
 */
export function invalidateSubTableFor(
  queryClient: QueryClient,
  model: string,
  parentField: string,
  parentUuid: string,
): Promise<void> {
  if (!parentUuid) return Promise.resolve();
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [m, tag, params] = query.queryKey as [string, string, any];
      if (m !== model || tag !== "infinite") return false;
      const extraVal = params?.extra?.[parentField];
      // Invalidate: эта SubTable родителя ИЛИ standalone-список (без фильтра по parentField)
      return !extraVal || extraVal === parentUuid;
    },
    refetchType: "active",
  });
}
