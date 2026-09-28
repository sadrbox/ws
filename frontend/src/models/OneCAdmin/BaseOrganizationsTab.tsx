/**
 * «Расширение БухПроф-AI» → «Организации баз» (Б11 аудита 26.09).
 *
 * База 1С называет свои организации сама: форма чата присылает список при открытии, потому что организацию могли
 * завести уже после подключения. Раньше каждый названный БИН сразу открывал базе задачи и заметки этой организации
 * в ERP — любой держатель токена базы мог назвать ЧУЖОЙ БИН. Теперь новый БИН ждёт решения администратора BuhProf,
 * как заявка на подключение базы, и действует только одобренным. БИНы из одобренной заявки на подключение и БИН
 * организации токена базы одобрены заранее и сюда не попадают.
 *
 * ОТБОРА ПО СОСТОЯНИЮ НЕТ, в отличие от заявок: сервис хранит только ожидающие — одобренный уходит в список
 * организаций базы, отклонённый удаляется (и встанет в ожидающие снова, если база назовёт его опять). Главное для
 * решения — есть ли в ERP организация с этим БИН: задачи и заметки адресуются ей, а чужой БИН обычно не совпадает
 * ни с одной. Решают только администраторы BuhProf; остальным сервис отвечает отказом — здесь одно объяснение
 * вместо таблицы, которая может только отказать.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { useAppActions } from "src/app/context";
import { usePanePollInterval } from "src/hooks/usePaneActive";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { withStableIds } from "src/utils/stableRowId";
import { asText } from "src/utils/asText";
import {
	decideBaseOrganization, fetchErpOrganizations, fetchPendingBaseOrganizations, type PendingBaseOrganization,
} from "src/services/onec/api";
import { isSharedListForbidden } from "./shared";
import { QueryError, SharedListForbidden } from "./sharedUi";
import { BASE_ORGS_PENDING_KEY, baseOrgTitle, pendingOrgKey, pendingOrgRows } from "./baseOrganizationsView";
import styles from "./OneCAdmin.module.scss";

const columns = (): TColumn[] => ([
	{ identifier: "bin", type: "string", width: "150px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "organizationName", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecReqErpOrg", type: "string", width: "280px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecBase", type: "string", width: "240px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecServer", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqReceived", type: "datetime", width: "160px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

type Decision = "approve" | "reject";

export const BaseOrganizationsTab: FC = () => {
	const qc = useQueryClient();
	const { actions: { confirm } } = useAppActions();
	// Опрос — только пока панель на экране (О4 аудита 26.09); БИН приходит без предупреждения, а база ждёт доступа.
	const pollInterval = usePanePollInterval(15_000);
	const list = useQuery({ queryKey: BASE_ORGS_PENDING_KEY, queryFn: fetchPendingBaseOrganizations, refetchInterval: pollInterval });
	const erp = useQuery({ queryKey: ["onec", "erp-organizations"], queryFn: fetchErpOrganizations, staleTime: 60_000, enabled: !!list.data });
	const items = useMemo(() => list.data?.items ?? [], [list.data]);
	const rowsRaw = useMemo(() => withStableIds(pendingOrgRows(items, erp.data?.items ?? []), (r) => r.uuid), [items, erp.data]);
	const view = useStaticTableView(rowsRaw, { reqReceived: "desc" }, "OneCAdmin_base_organizations");
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_base_organizations"));
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const active = items.find((o) => pendingOrgKey(o) === activeKey) ?? null;
	// Список отдаётся только администратору BuhProf — раз он на руках, решать можно.
	const canDecide = !!list.data;
	const refresh = () => qc.invalidateQueries({ queryKey: BASE_ORGS_PENDING_KEY });

	const decide = useMutation({
		mutationFn: (p: { org: PendingBaseOrganization; action: Decision }) => decideBaseOrganization(p.org.baseId, p.org.bin, p.action),
		onSuccess: (_d, p) => {
			showToast(`${translate(p.action === "approve" ? "onecBaseOrgApproved" : "onecBaseOrgRejected")}: ${baseOrgTitle(p.org)}`, "success");
			setActiveKey(null);
			void refresh();
		},
		onError: (e) => {
			reportError(e, { source: translate("onecExtBaseOrgs") });
			// «Уже решено» — строка устарела (решил другой администратор): перечитываем, а не оставляем её на экране.
			if ((e as { code?: string } | null)?.code === "ALREADY_DECIDED") void refresh();
		},
	});
	/** Одобрение выдаёт доступ, отказ его закрывает — оба с подтверждением, называющим организацию и базу. */
	const ask = async (org: PendingBaseOrganization, action: Decision) => {
		if (decide.isPending) return;
		const text = translate(action === "approve" ? "onecBaseOrgApproveAsk" : "onecBaseOrgRejectAsk").replace("{org}", baseOrgTitle(org));
		if (await confirm(text)) decide.mutate({ org, action });
	};

	if (isSharedListForbidden(list.error)) return <SharedListForbidden />;

	return (
		<>
			<div className={styles.Hint}>{translate("onecBaseOrgsHint")}</div>
			<QueryError error={list.error} noticeKey="onec-base-organizations" source={translate("onecExtBaseOrgs")} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_base_organizations", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: list.isLoading, reloading: list.isFetching && !list.isLoading,
				onReload: () => void list.refetch(),
				emptyText: translate("onecBaseOrgsNone"),
				wrapCells: true,
				renderCell: (r, col) => (col.identifier === "onecReqErpOrg"
					// Совпадение с ERP — зелёным, «нет в ERP» — тоном ожидания: это повод перезвонить, а не отказать сразу.
					? <span className={r.__erp ? styles.ReqOk : styles.ReqWait}>{asText(r.onecReqErpOrg)}</span>
					// БИН — моноширинным, как код заявки: его сверяют посимвольно.
					: col.identifier === "bin" ? <span className={styles.ReqCode}>{asText(r.bin)}</span>
						: undefined),
				onActiveRowChange: (r) => setActiveKey(r ? asText(r.uuid) : null),
				// Двойной щелчок — сразу одобрение: ради него строку и открывают.
				onRowClick: (r) => {
					const org = items.find((o) => pendingOrgKey(o) === asText(r.uuid));
					if (org && canDecide) void ask(org, "approve");
				},
				extraButtons: !canDecide ? undefined : (
					<>
						<Button variant="primary" disabled={!active || decide.isPending} onClick={() => { if (active) void ask(active, "approve"); }}>{translate("onecReqApprove")}</Button>
						<Button disabled={!active || decide.isPending} onClick={() => { if (active) void ask(active, "reject"); }}>{translate("onecReqReject")}</Button>
					</>
				),
			})} />
		</>
	);
};

export default BaseOrganizationsTab;
