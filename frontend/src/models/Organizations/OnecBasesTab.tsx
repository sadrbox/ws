/**
 * «Базы 1С» в карточке организации (ПН4 плана PLAN_TASKS_NOTES_PANEL_SERVICE_2026-09-22).
 *
 * ЗАЧЕМ. В карточке видно договоры, склады и кассы организации — а откуда приходят её задачи, заметки
 * и документы из 1С, не видно нигде: разбор «эта задача откуда взялась» начинался с похода к
 * администратору. Здесь — список баз и то, чем каждая связана с организацией.
 *
 * ТОЛЬКО ЧТЕНИЕ. Базы заводит кластер 1С, токены выдаёт администратор BuhProf (панель → «Базы 1С»),
 * список организаций присылает сама база при открытии чата. Менять это из карточки организации
 * нечем и незачем — здесь только показано, как оно сложилось.
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { getFormatDate } from "src/utils/datetime";
import { fetchOrganizationBases } from "src/services/onec/api";
import { QueryError } from "src/models/OneCAdmin/shared";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

const CHAT_LABEL: Record<string, string> = {
  active: "onecOrgBaseChatActive",
  revoked: "onecOrgBaseChatRevoked",
  none: "onecOrgBaseChatNone",
};

export const OnecBasesTab: FC<{ organizationUuid: string }> = ({ organizationUuid }) => {
  const q = useQuery({
    queryKey: ["onec", "organization-bases", organizationUuid],
    queryFn: () => fetchOrganizationBases(organizationUuid),
    enabled: !!organizationUuid,
  });
  const items = q.data?.items ?? [];

  return (
    <div className={admin.Instances}>
      <div className={admin.Hint}>{translate("onecOrgBasesHint")}</div>
      <QueryError error={q.error} noticeKey={`organization-bases-${organizationUuid}`} source={translate("onecOrgBases")} />
      {q.data && !items.length && <div className={admin.Hint}>{translate("onecOrgBasesNone")}</div>}
      {items.length > 0 && (
        <table className={`${admin.StatsTable} ${admin.ReqTable}`}>
          <thead>
            <tr>
              <th>{translate("onecBase")}</th>
              <th>{translate("onecServer")}</th>
              <th>{translate("onecTabChat")}</th>
              <th>{translate("binIin")}</th>
              <th>{translate("onecOrgBaseLastSeen")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={`${b.serverName ?? ""}-${b.baseKey}`}>
                <td>
                  {b.name}
                  {/* Отключённая база остаётся в списке: задачи, которые она успела создать, никуда не делись. */}
                  {b.disabled && <span className={admin.ReqOff}> · {translate("onecBaseDisabled")}</span>}
                </td>
                <td>{b.serverName || "—"}</td>
                <td>
                  <span className={b.chat === "active" ? admin.ReqOk : admin.ReqOff}>
                    {translate(CHAT_LABEL[b.chat] ?? "onecOrgBaseChatNone")}
                  </span>
                </td>
                {/* БИН из списка самой базы: пусто — организацию она не называет, задачи по ней не заведёт. */}
                <td>{b.declaredBin || "—"}</td>
                <td>{b.lastSeenAt ? getFormatDate(b.lastSeenAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default OnecBasesTab;
