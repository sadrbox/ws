/**
 * Строки вкладки «Базы 1С» карточки организации (OnecBasesTab) — без React, отдельным модулем: в модуле-компоненте
 * только компоненты (Fast Refresh, памятка reference_fast_refresh_hubs).
 */
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import { withStableIds } from "src/utils/stableRowId";
import type { OrganizationBase } from "src/services/onec/api";

const CHAT_LABEL: Record<string, string> = {
  active: "onecOrgBaseChatActive",
  revoked: "onecOrgBaseChatRevoked",
  none: "onecOrgBaseChatNone",
};

export type BaseRow = TDataItem & { __disabled: boolean; __chat: OrganizationBase["chat"] };

/** Строки таблицы: значения колонок — текстом, как их видят поиск и сортировка; признаки для раскраски — отдельно. */
export function organizationBaseRows(items: readonly OrganizationBase[]): BaseRow[] {
  return withStableIds(items, (b) => `${b.serverName ?? ""}/${b.baseKey}`).map((b) => ({
    id: b.id,
    uuid: `${b.serverName ?? ""}/${b.baseKey}`,
    onecBase: b.name || b.baseKey,
    onecServer: b.serverName || "—",
    onecTabChat: translate(CHAT_LABEL[b.chat] ?? "onecOrgBaseChatNone"),
    // БИН из списка самой базы: пусто — организацию она не называет, задачи по ней не заведёт.
    binIin: b.declaredBin || "—",
    onecOrgBaseLastSeen: b.lastSeenAt ?? null,
    __disabled: b.disabled,
    __chat: b.chat,
  }));
}

