/**
 * «Подключение агентов по коду» (СВ5, docs/CONTRACT_AGENT_ENROLLMENT_2026-09-19.md).
 *
 * Агент сам просит подключение (окно агента → «Подключить агента по коду…») и показывает код; здесь заявку находят
 * по коду (быстрый поиск таблицы), сверяют компьютер, службу и роль и одобряют с организацией ERP. Идентификатор и
 * токен агент получает сам — ни здесь, ни в окне агента их не копируют. Повторное подключение той же службы
 * получает того же агента с новым токеном. Решают только администраторы BuhProf.
 *
 * Таблица — как везде в панели; действия — над активной строкой, двойной щелчок по нерешённой — одобрение.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import { FieldTextarea } from "src/components/Field/FieldTextarea";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
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
	approveEnrollment, fetchEnrollments, fetchErpOrganizations, rejectEnrollment,
	type AgentEnrollment, type EnrollmentState,
} from "src/services/onec/api";
import { QueryError, SharedListForbidden, isSharedListForbidden, useAgents } from "./shared";
import { registrationStateLabel, stateTone } from "./requestsView";
import styles from "./OneCAdmin.module.scss";

const TONE_CLASS = { wait: styles.ReqWait, ok: styles.ReqOk, bad: styles.ReqBad, off: styles.ReqOff };

const columns = (): TColumn[] => ([
	{ identifier: "reqCode", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqState", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "role", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecEnrollWhere", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecServer", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "enrVersion", type: "string", width: "200px", minWidth: "110px", alignment: "left", visible: false, inlist: true },
	{ identifier: "reqReceived", type: "datetime", width: "160px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqExpires", type: "datetime", width: "160px", minWidth: "110px", alignment: "left", visible: false, inlist: true },
	{ identifier: "reqResult", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecEnrollReplaces", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqRepeats", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: false, inlist: true },
] as unknown as TColumn[]);

export const EnrollmentsTab: FC = () => {
	const qc = useQueryClient();
	const [state, setState] = useState<EnrollmentState | "">("PENDING");
	const list = useQuery({
		queryKey: ["onec", "enrollments", state, ""],
		queryFn: () => fetchEnrollments({ state }),
		// Человек у компьютера с агентом ждёт одобрения — список обновляется сам.
		refetchInterval: 10_000,
	});
	const agents = useAgents();
	const names = useMemo(() => new Map((agents.data?.items ?? []).map((a) => [a.id, a.name])), [agents.data]);
	const nameOf = (id: string | null) => (id ? names.get(id) || id.slice(0, 8) : "");
	const items = useMemo(() => list.data?.items ?? [], [list.data]);
	const canDecide = !!list.data?.canDecide;
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_enrollments"));
	const [activeId, setActiveId] = useState<string | null>(null);
	const active = items.find((e) => e.id === activeId) ?? null;
	const [approving, setApproving] = useState<AgentEnrollment | null>(null);
	const [rejecting, setRejecting] = useState<AgentEnrollment | null>(null);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["onec", "enrollments"] });
		void qc.invalidateQueries({ queryKey: ["onec", "agents"] });
	};

	const rowsRaw = useMemo(() => withStableIds(items.map((e) => ({
		uuid: e.id,
		reqCode: e.code,
		reqState: registrationStateLabel(e.state),
		__tone: stateTone(e.state),
		name: e.name,
		role: e.role === "admin" ? translate("onecRoleAdmin") : translate("onecRoleBusiness"),
		onecEnrollWhere: `${e.computer} · ${e.serviceName}`,
		onecServer: e.serverName || "—",
		enrVersion: e.version || "—",
		reqReceived: e.createdAt,
		reqExpires: e.state === "PENDING" ? e.expiresAt : null,
		reqResult: e.state === "APPROVED"
			? `${(e.agentId && names.get(e.agentId)) || e.agentId?.slice(0, 8) || "—"} · ${e.tokenDeliveredAt ? translate("onecReqTokenDelivered") : translate("onecEnrollWaiting")}${e.note ? ` · ${e.note}` : ""}`
			: e.note || "—",
		onecEnrollReplaces: e.previousAgentId ? names.get(e.previousAgentId) || e.previousAgentId.slice(0, 8) : "—",
		reqRepeats: e.repeats ? `${e.repeats}${e.ip ? ` · ${e.ip}` : ""}` : "—",
	})), (r) => r.uuid), [items, names]);
	const view = useStaticTableView(rowsRaw, { reqReceived: "desc" });
	const pending = active?.state === "PENDING" && canDecide;

	// Сводный список закрыт установкой (С3.4): одно объяснение вместо таблицы, которая может только отказать.
	if (isSharedListForbidden(list.error)) return <SharedListForbidden />;

	return (
		<>
			<div className={styles.Hint}>{translate("onecEnrollHint")}</div>
			<div className={styles.BasesLimits}>
				<FieldSelect name="enr_state" label={translate("status")} size="sm" value={state}
					onChange={(e) => setState(e.target.value as EnrollmentState | "")}
					options={[
						{ value: "PENDING", label: translate("onecReqPending") },
						{ value: "", label: translate("onecReqAll") },
						{ value: "APPROVED", label: translate("onecReqApproved") },
						{ value: "REJECTED", label: translate("onecReqRejected") },
						{ value: "EXPIRED", label: translate("onecReqExpired") },
					]} />
			</div>
			<QueryError error={list.error} noticeKey="onec-enrollments" source={translate("onecEnrollments")} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_enrollments", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: list.isLoading, reloading: list.isFetching && !list.isLoading,
				onReload: () => void list.refetch(),
				emptyText: translate("onecReqNone"),
				wrapCells: true,
				renderCell: (r, col) => (col.identifier === "reqState"
					? <span className={TONE_CLASS[asText(r.__tone) as keyof typeof TONE_CLASS]}>{asText(r.reqState)}</span>
					: col.identifier === "reqCode" ? <span className={styles.ReqCode}>{asText(r.reqCode)}</span>
						: undefined),
				onActiveRowChange: (r) => setActiveId(r ? asText(r.uuid) : null),
				onRowClick: (r) => {
					const e = items.find((x) => x.id === asText(r.uuid));
					if (e?.state === "PENDING" && canDecide) setApproving(e);
				},
				extraButtons: !canDecide ? undefined : (
					<>
						<Button variant="primary" disabled={!pending} onClick={() => active && setApproving(active)}>{translate("onecReqApprove")}</Button>
						<Button disabled={!pending} onClick={() => active && setRejecting(active)}>{translate("onecReqReject")}</Button>
					</>
				),
			})} />
			{approving && <ApproveModal enr={approving} previousName={nameOf(approving.previousAgentId)} onClose={() => setApproving(null)} onDone={() => { setApproving(null); refresh(); }} />}
			{rejecting && <RejectModal enr={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); refresh(); }} />}
		</>
	);
};

const ApproveModal: FC<{ enr: AgentEnrollment; previousName: string; onClose: () => void; onDone: () => void }> = ({ enr, previousName, onClose, onDone }) => {
	/*
	 * ОРГАНИЗАЦИЯ — ТОЛЬКО БИЗНЕС-АГЕНТУ. Он ходит в базы одной организации ERP: по ней выбирается исполнитель
	 * команд чата и считается лимит тарифа. Агент кластера обслуживает весь сервер — все базы всех клиентов, и
	 * организация ему ни на что не влияет: спрашивать её значило бы требовать выбор «для галочки».
	 */
	const needsOrg = enr.role !== "admin";
	const [organizationUuid, setOrganizationUuid] = useState("");
	const [name, setName] = useState(enr.name);
	const [reuse, setReuse] = useState(!!enr.previousAgentId);
	const [note, setNote] = useState("");
	const orgs = useQuery({ queryKey: ["onec", "erp-organizations"], queryFn: fetchErpOrganizations, staleTime: 60_000 });
	const approve = useMutation({
		mutationFn: () => approveEnrollment(enr.id, {
			...(needsOrg ? { organizationUuid } : {}), name: name.trim() || undefined,
			/*
			 * ВЫБОР ИЗ СПИСКА ДОЛЖЕН ИСПОЛНЯТЬСЯ — ОБА (С3.1 аудита 23.09). «Новый агент» уходил явным `null`, а
			 * «тот же агент» не уходил вовсе — и сервис в этом случае решает сам: прежнего агента он занимает только
			 * по явному указанию, а если тот на связи, заводит НОВОГО (иначе имя компьютера из заявки позволяло бы
			 * забрать токен живого агента). Выходило, что человек выбрал «тот же», а получил новый, и сказал об этом
			 * только тост. Теперь оба варианта называются явно: «тот же» — идентификатором прежнего агента.
			 */
			...(enr.previousAgentId ? { agentId: reuse ? enr.previousAgentId : null } : {}),
			// Причина решения остаётся в заявке и в журнале — как у отказа: «почему одобрили» спрашивают так же часто.
			...(note.trim() ? { note: note.trim() } : {}),
		}),
		onSuccess: (d) => {
			showToast(`${translate("onecReqApproved")}: ${enr.code}${d.created ? ` — ${translate("onecEnrollNewAgent")}` : ""}`, "success");
			onDone();
		},
		onError: (e) => reportError(e, { source: translate("onecEnrollments") }),
	});
	return (
		<Modal title={`${translate("onecReqApprove")}: ${enr.code}`} onClose={onClose}
			onApply={() => { if ((!needsOrg || organizationUuid) && !approve.isPending) approve.mutate(); }}>
			<div className={styles.ModalForm}>
				<div>{enr.computer} · {enr.serviceName} · {enr.role === "admin" ? translate("onecRoleAdmin") : translate("onecRoleBusiness")}</div>
				{needsOrg
					? (
						<FieldSelect name="enr_org" label={translate("onecReqErpOrg")} value={organizationUuid} required error={!organizationUuid}
							onChange={(e) => setOrganizationUuid(e.target.value)} hint={translate("onecEnrollOrgHint")}
							options={[{ value: "", label: "—" }, ...(orgs.data?.items ?? []).map((o) => ({ value: o.uuid, label: `${o.name}${o.bin ? ` (${o.bin})` : ""}` }))]} />
					)
					: <div className={styles.Hint}>{translate("onecEnrollClusterHint")}</div>}
				<Field name="enr_name" label={translate("name")} width={FIELD_WIDTH.lg} value={name}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
				{enr.previousAgentId && (
					<FieldSelect name="enr_reuse" label={translate("onecEnrollAgent")} value={reuse ? "reuse" : "new"}
						onChange={(e) => setReuse(e.target.value === "reuse")}
						options={[
							{ value: "reuse", label: `${translate("onecEnrollReuse")}: ${previousName}` },
							{ value: "new", label: translate("onecEnrollNewAgent") },
						]} />
				)}
				<Field name="enr_note" label={translate("onecReqNote")} width={FIELD_WIDTH.lg} value={note}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)} />
				<div className={styles.Hint}>{translate("onecEnrollApproveHint")}</div>
			</div>
		</Modal>
	);
};

const RejectModal: FC<{ enr: AgentEnrollment; onClose: () => void; onDone: () => void }> = ({ enr, onClose, onDone }) => {
	const [note, setNote] = useState("");
	const reject = useMutation({
		mutationFn: () => rejectEnrollment(enr.id, note.trim()),
		onSuccess: () => { showToast(`${translate("onecReqRejected")}: ${enr.code}`, "success"); onDone(); },
		onError: (e) => reportError(e, { source: translate("onecEnrollments") }),
	});
	return (
		<Modal title={`${translate("onecReqReject")}: ${enr.code}`} onClose={onClose} onApply={() => { if (note.trim() && !reject.isPending) reject.mutate(); }}>
			<div className={styles.ModalForm}>
				<div>{enr.computer} · {enr.name}</div>
				<FieldTextarea name="enr_reject_note" label={translate("onecReqRejectReason")} value={note} rows={3} required error={!note.trim()}
					onChange={(e) => setNote(e.target.value)} hint={translate("onecEnrollRejectHint")} />
			</div>
		</Modal>
	);
};

export default EnrollmentsTab;
