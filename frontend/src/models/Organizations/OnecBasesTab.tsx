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
 *
 * ТАБЛИЦА — общий компонент Table (28.09), как у соседних вкладок-списков карточки: сортировка по колонкам,
 * быстрый поиск, ширины и видимость колонок запоминаются, «Обновить» перечитывает список у сервиса.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { asText } from "src/utils/asText";
import { fetchOrganizationBases } from "src/services/onec/api";
import { QueryError } from "src/models/OneCAdmin/sharedUi";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";
import { organizationBaseRows, type BaseRow } from "./onecBasesView";

const COMPONENT = "Organizations_onec_bases";

// Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn).
const columns = (): TColumn[] => ([
  { identifier: "onecBase", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
  { identifier: "onecServer", type: "string", width: "170px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
  { identifier: "onecTabChat", type: "string", width: "170px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
  { identifier: "binIin", type: "string", width: "150px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
  { identifier: "onecOrgBaseLastSeen", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const OnecBasesTab: FC<{ organizationUuid: string }> = ({ organizationUuid }) => {
  const q = useQuery({
    queryKey: ["onec", "organization-bases", organizationUuid],
    queryFn: () => fetchOrganizationBases(organizationUuid),
    enabled: !!organizationUuid,
  });
  const rowsRaw = useMemo(() => organizationBaseRows(q.data?.items ?? []), [q.data]);
  const view = useStaticTableView(rowsRaw, { onecBase: "asc" }, COMPONENT, { scope: organizationUuid });
  const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), COMPONENT));

  return (
    <>
      <div className={admin.Hint}>{translate("onecOrgBasesHint")}</div>
      <QueryError error={q.error} noticeKey={`organization-bases-${organizationUuid}`} source={translate("onecOrgBases")} />
      <Table {...buildStaticTableProps({
        componentName: COMPONENT, rows: view.rows, columns: cols, setColumns: setCols,
        sorting: view.sorting, search: view.search,
        isLoading: q.isLoading, reloading: q.isFetching && !q.isLoading,
        onReload: () => void q.refetch(),
        emptyText: q.data ? translate("onecOrgBasesNone") : undefined,
        renderCell: (r, col) => {
          const row = r as BaseRow;
          if (col.identifier === "onecBase") {
            // Имя и пометка — ОДНИМ span ячейки: на `.TableBodyCell > span` держатся отступ и многоточие, а два
            // соседних span дали бы двойной отступ между именем и пометкой.
            return (
              <span>
                {asText(row.onecBase)}
                {/* Отключённая база остаётся в списке: задачи, которые она успела создать, никуда не делись. */}
                {row.__disabled && <span className={admin.ReqOff}> · {translate("onecBaseDisabled")}</span>}
              </span>
            );
          }
          if (col.identifier === "onecTabChat") {
            return <span className={row.__chat === "active" ? admin.ReqOk : admin.ReqOff}>{asText(row.onecTabChat)}</span>;
          }
          // БИН сверяют посимвольно — моноширинным, как в заявках 1С.
          if (col.identifier === "binIin" && row.binIin !== "—") return <span className={admin.ReqCode}>{asText(row.binIin)}</span>;
          return undefined;
        },
      })} />
    </>
  );
};

export default OnecBasesTab;
