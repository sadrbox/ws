/**
 * «Базы агента» в карточке бизнес-агента (ПН, docs/TASK_SERVICE_AGENT_BASES_LIMITS.md).
 *
 * Одна служба бизнес-агента обслуживает много баз своего компьютера, каждую по HTTP или COM, и ВСЕ организации,
 * которые в них видит: организации у агента нет, допуска БИН тоже (28.09). Сколько баз ей можно — решает тариф:
 * сервис считает лимит по порядку баз в настройках агента и команды сверх него отвергает, не ставя в очередь.
 * Здесь видно, что подключено, что из этого сверх лимита и в каких ещё базах есть та же организация.
 *
 * Срез хранит сервис (агент шлёт его сам при регистрации и в heartbeat) — это чтение из БД, не команда агенту,
 * поэтому список запрашивается при открытии, а не по кнопке.
 *
 * СПИСОК БАЗ — ОБЩИЙ КОМПОНЕНТ Table (28.09): сортировка по колонкам, быстрый поиск, ширины и видимость колонок
 * запоминаются. С переносом текста (`wrapCells`): в ячейке «Организации» — несколько организаций, каждая своей
 * строкой с пометками. Подсветки строки у Table нет, поэтому «сверх лимита» теперь видно
 * по ячейкам: ключ базы и состояние — цветом OverLimit (раньше строка ещё и бледнела — OverLimitRow).
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { usePanePollInterval } from "src/hooks/usePaneActive";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { showToast } from "src/components/UIToast";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { reportError } from "src/services/errors/route";
import { asText } from "src/utils/asText";
import { cx } from "src/utils/cx";
import { fetchAgentBases, fetchErpOrganizations, setAgentLimits, type AgentBaseRow, type AgentBasesView } from "src/services/onec/api";
import { withOp } from "./progress";
import { QueryError } from "./sharedUi";
import { baseState, limitInput, overUsage, parseLimitInput, sameLimits, usageText } from "./agentBasesView";
import { agentBaseRows, type AgentBaseTableRow } from "./agentTablesView";
import styles from "./OneCAdmin.module.scss";

const BASES = "OneCAdmin_agent_bases";

// Идентификатор колонки — ключ перевода её заголовка (getTranslateColumn).
const columns = (): TColumn[] => [
	{ identifier: "lineNumber", type: "number", width: "56px", minWidth: "44px", alignment: "right", visible: true, inlist: true },
	{ identifier: "onecBase", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecTransport", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecExtVersion", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "organizations", type: "string", width: "460px", minWidth: "200px", alignment: "left", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
];

export const AgentBasesTab: FC<{ agentId: string; agentName: string }> = ({ agentId, agentName }) => {
	const qc = useQueryClient();
	const queryKey = ["onec", "agent-bases", agentId];
	const pollInterval = usePanePollInterval(30_000);
	const q = useQuery({
		queryKey,
		queryFn: () => fetchAgentBases(agentId),
		enabled: !!agentId,
		// Срез обновляется heartbeat'ом агента — раз в полминуты достаточно, чтобы увидеть новую базу.
		// Только пока панель на экране (О4 аудита 26.09).
		refetchInterval: pollInterval,
	});
	const v = q.data;
	/*
	 * ОБСЛУЖИВАЕТ ОРГАНИЗАЦИИ (В6, 28.09): у агента нет своей организации, и кому он отвечает, видно здесь — по каждой
	 * организации базы её организация ERP (по БИН). Нет в ERP — чат этой организации к агенту не придёт.
	 */
	const erpOrgs = useQuery({ queryKey: ["onec", "erp-organizations"], queryFn: fetchErpOrganizations, staleTime: 60_000 });
	const erpByBin = useMemo(() => new Map((erpOrgs.data?.items ?? []).filter((o) => o.bin).map((o) => [o.bin!, o.name])), [erpOrgs.data]);

	// Черновик лимита: пока поле не трогали — в нём сохранённое значение, после сохранения черновик сбрасывается.
	const [draft, setDraft] = useState<string | undefined>(undefined);
	const maxBases = draft ?? (v ? limitInput(v.limits.maxBases) : "");

	const nextBases = parseLimitInput(maxBases);
	const valid = nextBases !== undefined;
	const changed = !!v && valid && !sameLimits(v.limits, { maxBases: nextBases });

	const save = useMutation({
		mutationFn: () => withOp(
			{ kind: "update", title: translate("onecAgentLimits"), target: agentName, ref: { endpoint: "onec-agents", uuid: agentId, label: agentName } },
			() => setAgentLimits(agentId, { maxBases: nextBases ?? null })),
		onSuccess: (fresh) => {
			// Ответ сервиса — уже новое представление: показываем его сразу, иначе до повторного запроса поля
			// на миг вернулись бы к прежнему лимиту. Права и роль в ответе на запись не приходят — берём прежние.
			qc.setQueryData<AgentBasesView>(queryKey, (old) => (old ? { ...old, ...fresh } : fresh));
			setDraft(undefined);
			showToast(translate("saved"), "success");
			void qc.invalidateQueries({ queryKey });
			void qc.invalidateQueries({ queryKey: ["onec", "agents"] });
		},
		onError: (e) => reportError(e, { source: translate("onecAgentLimits") }),
	});

	const bases = v?.bases ?? [];
	const anyOver = bases.some((b) => baseState(b) === "overLimit" || (b.organizations ?? []).some((o) => o.overLimit));

	const rowsRaw = useMemo(() => agentBaseRows(v?.bases ?? []), [v]);
	// Порядок по умолчанию — порядок баз в настройках агента: по нему сервис считает лимит.
	const view = useStaticTableView(rowsRaw, { lineNumber: "asc" }, BASES, { scope: agentId });
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), BASES));

	/*
	 * Организации базы. Каждая — своей строкой-блоком (div в корневом span ячейки): в режиме переноса Table делает
	 * блоком (-webkit-box) каждый span ячейки, и если бы строкой организации был span, имя, БИН и пометки встали бы
	 * столбиком. Внутри .BaseOrg — flex-ряд, и span-пометки в нём идут подряд, как раньше.
	 */
	const renderOrgs = (b: AgentBaseRow) => {
		if (b.organizations === null) return <span className={styles.ReqOff}>{translate("onecOrgsUnknown")}</span>;
		if (!b.organizations.length) return "—";
		return (
			<span>
				{b.organizations.map((o, k) => (
					<div key={`${o.bin ?? ""}-${o.id ?? k}`} className={styles.BaseOrg}>
						<span>{o.name || "—"}</span>
						{o.bin && <span className={styles.Mono}>{o.bin}</span>}
						{o.bin && erpOrgs.data && (erpByBin.has(o.bin)
							? <span className={styles.ReqOk}>{`ERP: ${erpByBin.get(o.bin)}`}</span>
							: <span className={styles.ReqOff}>{translate("onecReqOrgMissing")}</span>)}
						{o.overLimit && <span className={styles.OverLimit}>{translate("onecOverLimit")}</span>}
						{/* Организация и в других базах агента: какая выполнит команду, решает сервис — своя база организации. */}
						{!o.overLimit && o.alsoIn.length > 0 && (
							<span className={styles.Hint}>{`${translate("onecBinAlsoIn")}: ${o.alsoIn.join(", ")}`}</span>
						)}
					</div>
				))}
			</span>
		);
	};

	const renderCell = (r: TDataItem, col: TColumn) => {
		const row = r as AgentBaseTableRow;
		const over = row.__state === "overLimit";
		switch (col.identifier) {
			// Ключ базы сверяют посимвольно — моноширинным; сверх лимита — цветом (вместо прежней подсветки строки).
			case "onecBase":
				return <span className={cx(styles.Mono, over && styles.OverLimit)}>{asText(row.onecBase)}</span>;
			case "organizations":
				return renderOrgs(row.__base);
			case "status":
				// Расхождение с агентом — второй строкой под состоянием (вложенный span в режиме переноса — блок).
				return (
					<span className={over ? styles.OverLimit : undefined} title={over ? translate("onecOverLimitHint") : undefined}>
						{asText(row.status)}
						{row.__base.limitMismatch && (
							<span className={styles.ReqOff} title={translate("onecLimitMismatchHint")}>{translate("onecLimitMismatch")}</span>
						)}
					</span>
				);
			default:
				return undefined;
		}
	};

	return (
		/*
		 * Колонка вкладки — SplitTabs, а не .Instances: у .Instances `container-type: size`, и Table в нём получил бы
		 * область нулевой высоты (см. OneCAdmin.module.scss).
		 */
		<div className={styles.SplitTabs}>
			<div className={styles.Hint}>{translate("onecAgentBasesHint")}</div>
			<QueryError error={q.error} noticeKey={`agent-bases-${agentId}`} source={translate("onecAgentBases")} />

			{v && (
				<div className={styles.BasesUsage}>
					<span className={overUsage(v.usage.bases, v.limits.maxBases) ? styles.OverLimit : undefined}>
						{translate("onecAgentBasesCount")}: {usageText(v.usage.bases, v.limits.maxBases)}
					</span>
					{/* Организаций — без лимита (В8): агент обслуживает все, что видит в своих базах. */}
					<span>{translate("onecAgentServes")}: {v.usage.bins}</span>
				</div>
			)}
			{anyOver && <div className={styles.ConfirmWarning}>{translate("onecOverLimitHint")}</div>}

			{v?.canEditLimits && (
				<div className={styles.BasesLimits}>
					<Field name="ag_max_bases" label={translate("onecAgentMaxBases")} width={FIELD_WIDTH.sm}
						value={maxBases} placeholder={translate("onecLimitNone")} error={nextBases === undefined}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} />
					<Button variant="primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
						{translate("save")}
					</Button>
					<span className={styles.Hint}>{valid ? translate("onecAgentLimitsHint") : translate("onecAgentLimitsInvalid")}</span>
				</div>
			)}

			<Table {...buildStaticTableProps({
				componentName: BASES, rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				// Список опрашивается раз в полминуты: вращение «Обновить» от опроса не передаём — только от нажатия.
				isLoading: q.isLoading,
				onReload: () => void q.refetch(),
				emptyText: v ? translate("onecAgentBasesNone") : undefined,
				wrapCells: true,
				renderCell,
			})} />
		</div>
	);
};

export default AgentBasesTab;
