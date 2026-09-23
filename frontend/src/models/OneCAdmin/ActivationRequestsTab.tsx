/**
 * «Заявки → Активация БИНов» (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, часть 2).
 *
 * Клиент просит активировать организацию из окна агента («Базы и БИНы» → «Запросить активацию»); здесь запрос
 * одобряют (БИН попадает в список активных агента) или отклоняют с причиной — клиент увидит её в окне агента.
 *
 * У агента без списка первое одобрение заводит список из того, что он обслуживает сейчас, плюс новый БИН: иначе
 * одобрение одной организации выключило бы остальные. Больше тарифа — одобряется, но с предупреждением.
 *
 * Таблица — как везде в панели; действия — над активной строкой. С `agentId` (карточка агента) — только запросы
 * этого агента, без колонки «Агент».
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { FieldSelect } from "src/components/Field";
import { FieldTextarea } from "src/components/Field/FieldTextarea";
import Modal from "src/components/Modal";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { withStableIds } from "src/utils/stableRowId";
import { asText } from "src/utils/asText";
import {
	approveActivation, fetchActivationRequests, fixAllActiveBins, rejectActivation,
	type ActivationRequest, type ActivationState,
} from "src/services/onec/api";
import { QueryError, SharedListForbidden, isSharedListForbidden } from "./shared";
import { activationStateLabel, stateTone } from "./requestsView";
import styles from "./OneCAdmin.module.scss";

const TONE_CLASS = { wait: styles.ReqWait, ok: styles.ReqOk, bad: styles.ReqBad, off: styles.ReqOff };

const columns = (withAgent: boolean): TColumn[] => ([
	{ identifier: "agentName", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: withAgent, inlist: withAgent },
	{ identifier: "reqState", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqOrgName", type: "string", width: "240px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqBin", type: "string", width: "130px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqBaseName", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqComment", type: "string", width: "240px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqReceived", type: "datetime", width: "160px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqResult", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqTariff", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const ActivationRequestsTab: FC<{ agentId?: string }> = ({ agentId }) => {
	const qc = useQueryClient();
	const [state, setState] = useState<ActivationState | "">("PENDING");
	const list = useQuery({
		queryKey: ["onec", "activation-requests", state, agentId ?? ""],
		queryFn: () => fetchActivationRequests({ state, agentId }),
		refetchInterval: 15_000,
	});
	const items = useMemo(() => list.data?.items ?? [], [list.data]);
	const canDecide = !!list.data?.canDecide;
	// У карточки агента своя раскладка колонок: там колонки «Агент» нет вовсе.
	const tableName = agentId ? "OneCAdmin_activation_agent" : "OneCAdmin_activation";
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(!agentId), tableName));
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const keyOf = (r: ActivationRequest) => `${r.agentId}:${r.bin}`;
	const active = items.find((r) => keyOf(r) === activeKey) ?? null;
	const [rejecting, setRejecting] = useState<ActivationRequest | null>(null);

	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["onec", "activation-requests"] });
		void qc.invalidateQueries({ queryKey: ["onec", "agent-bases"] });
		void qc.invalidateQueries({ queryKey: ["onec", "agents"] });
	};

	// Перевод всех агентов без списка на явный список активных (C15) — по их нынешнему обслуживанию.
	const fixAll = useMutation({
		mutationFn: fixAllActiveBins,
		onSuccess: (d) => {
			showToast(translate("onecActiveBinsFixAllDone").replace("{n}", String(d.fixed.length)).replace("{s}", String(d.skipped)), "success");
			refresh();
		},
		onError: (e) => reportError(e, { source: translate("onecReqActivation") }),
	});

	const approve = useMutation({
		mutationFn: (r: ActivationRequest) => approveActivation(r.agentId, r.bin),
		onSuccess: (d, r) => {
			showToast(`${translate("onecReqApproved")}: ${r.bin}`, "success");
			// Сверх тарифа — не ошибка (решает человек), но сказать надо.
			if (d.warning) showToast(d.warning, "warning");
			refresh();
		},
		onError: (e) => reportError(e, { source: translate("onecReqActivation") }),
	});

	const rowsRaw = useMemo(() => withStableIds(items.map((r) => ({
		uuid: keyOf(r),
		agentName: `${r.agentName || r.agentId.slice(0, 8)} · ${r.agentOnline ? translate("onecAgentOnline") : translate("onecAgentOffline")}`,
		reqState: activationStateLabel(r.state),
		__tone: stateTone(r.state),
		reqOrgName: r.name || "—",
		reqBin: r.bin,
		reqBaseName: r.baseKey || "—",
		reqComment: r.comment || "—",
		reqReceived: r.requestedAt || r.createdAt,
		reqResult: [r.active === true && r.state !== "APPROVED" ? translate("onecBinActive") : "", r.note ?? ""].filter(Boolean).join(" · ") || "—",
		reqTariff: r.limits?.maxBins != null
			? translate("onecReqActiveOfTariff").replace("{n}", String(r.limits.activeBins?.length ?? "—")).replace("{max}", String(r.limits.maxBins))
			: "—",
	})), (r) => r.uuid), [items]);
	const view = useStaticTableView(rowsRaw, { reqReceived: "desc" });
	const pending = active?.state === "PENDING" && canDecide;

	// Сводный список закрыт установкой (С3.4): одно объяснение вместо таблицы, которая может только отказать.
	if (isSharedListForbidden(list.error)) return <SharedListForbidden />;

	return (
		<>
			{!agentId && <div className={styles.Hint}>{translate("onecReqActHint")}</div>}
			<div className={styles.BasesLimits}>
				<FieldSelect name="act_state" label={translate("status")} size="sm" value={state}
					onChange={(e) => setState(e.target.value as ActivationState | "")}
					options={[
						{ value: "PENDING", label: translate("onecReqPending") },
						{ value: "", label: translate("onecReqAll") },
						{ value: "APPROVED", label: translate("onecReqApproved") },
						{ value: "REJECTED", label: translate("onecReqRejected") },
					]} />
			</div>
			<QueryError error={list.error} noticeKey={`onec-activation-${agentId ?? "all"}`} source={translate("onecReqActivation")} />
			<Table {...buildStaticTableProps({
				componentName: tableName, rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: list.isLoading, reloading: list.isFetching && !list.isLoading,
				onReload: () => void list.refetch(),
				emptyText: translate("onecReqNone"),
				wrapCells: true,
				renderCell: (r, col) => (col.identifier === "reqState"
					? <span className={TONE_CLASS[asText(r.__tone) as keyof typeof TONE_CLASS]}>{asText(r.reqState)}</span>
					: col.identifier === "reqBin" ? <span className={styles.Mono}>{asText(r.reqBin)}</span>
						: undefined),
				onActiveRowChange: (r) => setActiveKey(r ? asText(r.uuid) : null),
				extraButtons: !canDecide ? undefined : (
					<>
						<Button variant="primary" disabled={!pending || approve.isPending} onClick={() => active && approve.mutate(active)}>{translate("onecReqApprove")}</Button>
						<Button disabled={!pending} onClick={() => active && setRejecting(active)}>{translate("onecReqReject")}</Button>
						{!agentId && (
							<Button disabled={fixAll.isPending} title={translate("onecActiveBinsFixAllHint")} onClick={() => fixAll.mutate()}>
								{translate("onecActiveBinsFixAll")}
							</Button>
						)}
					</>
				),
			})} />

			{rejecting && <RejectModal req={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); refresh(); }} />}
		</>
	);
};

const RejectModal: FC<{ req: ActivationRequest; onClose: () => void; onDone: () => void }> = ({ req, onClose, onDone }) => {
	const [note, setNote] = useState("");
	const reject = useMutation({
		mutationFn: () => rejectActivation(req.agentId, req.bin, note.trim()),
		onSuccess: () => { showToast(`${translate("onecReqRejected")}: ${req.bin}`, "success"); onDone(); },
		onError: (e) => reportError(e, { source: translate("onecReqActivation") }),
	});
	return (
		<Modal title={`${translate("onecReqReject")}: ${req.bin}`} onClose={onClose} onApply={() => { if (note.trim() && !reject.isPending) reject.mutate(); }}>
			<div className={styles.ModalForm}>
				<div>{req.name || req.bin} · {req.baseKey || "—"}</div>
				<FieldTextarea name="act_reject_note" label={translate("onecReqRejectReason")} value={note} rows={3} required error={!note.trim()}
					onChange={(e) => setNote(e.target.value)} hint={translate("onecReqActRejectHint")} />
			</div>
		</Modal>
	);
};

export default ActivationRequestsTab;
