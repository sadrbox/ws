/**
 * «Заявки → Подключение баз» (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, часть 1).
 *
 * Администратор базы отправляет заявку из 1С («БухПроф AI → Подключение к BuhProf AI») и называет код по
 * телефону; здесь заявку находят по коду (быстрый поиск таблицы), сверяют базу и организации с БИН и одобряют:
 * организация ERP (по умолчанию — чей БИН совпал) и база реестра. Токен уходит в 1С сам при первом опросе после
 * одобрения — ни здесь, ни в 1С его никто не видит.
 *
 * ТАБЛИЦА, КАК ВЕЗДЕ В ПАНЕЛИ: сортировка, поиск, настройка колонок; действия — над активной строкой в тулбаре,
 * двойной щелчок по нерешённой заявке открывает одобрение. Решают только администраторы BuhProf.
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
	approveRegistration, fetchErpOrganizations, fetchRegistrations, rejectRegistration,
	type BaseRegistration, type RegistrationState,
} from "src/services/onec/api";
import { QueryError } from "./shared";
import {
	approveDefaults, configurationText, organizationOptions, registrationStateLabel, stateTone, whereText,
} from "./requestsView";
import styles from "./OneCAdmin.module.scss";

const TONE_CLASS = { wait: styles.ReqWait, ok: styles.ReqOk, bad: styles.ReqBad, off: styles.ReqOff };

const columns = (): TColumn[] => ([
	{ identifier: "reqCode", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqState", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqBaseName", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqConfiguration", type: "string", width: "240px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqWhere", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqOrganizations", type: "string", width: "300px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqSentBy", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqComment", type: "string", width: "220px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqReceived", type: "datetime", width: "160px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "reqExpires", type: "datetime", width: "160px", minWidth: "110px", alignment: "left", visible: false, inlist: true },
	{ identifier: "reqResult", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	// Повторы с разных адресов — повод перезвонить до одобрения: заявку мог подать не тот, кто звонит.
	{ identifier: "reqRepeats", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: false, inlist: true },
] as unknown as TColumn[]);

/**
 * `fitHeight` — вкладка ставит эту таблицу рядом со второй и делит высоту между ними («Доступ AI»);
 * сама по себе таблица по-прежнему занимает всё место.
 */
export const RegistrationsTab: FC<{ fitHeight?: boolean }> = ({ fitHeight }) => {
	const qc = useQueryClient();
	const [state, setState] = useState<RegistrationState | "">("PENDING");
	const list = useQuery({
		queryKey: ["onec", "registrations", state, ""],
		queryFn: () => fetchRegistrations({ state }),
		// Заявка приходит без предупреждения, а человек у телефона ждёт — список обновляется сам.
		refetchInterval: 15_000,
	});
	const items = useMemo(() => list.data?.items ?? [], [list.data]);
	const canDecide = !!list.data?.canDecide;
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_registrations"));
	const [activeId, setActiveId] = useState<string | null>(null);
	const active = items.find((r) => r.id === activeId) ?? null;
	const [approving, setApproving] = useState<BaseRegistration | null>(null);
	const [rejecting, setRejecting] = useState<BaseRegistration | null>(null);
	const refresh = () => qc.invalidateQueries({ queryKey: ["onec", "registrations"] });

	const rowsRaw = useMemo(() => withStableIds(items.map((r) => ({
		uuid: r.id,
		reqCode: r.code,
		reqState: registrationStateLabel(r.state),
		__tone: stateTone(r.state),
		reqBaseName: r.base.name,
		reqConfiguration: `${configurationText(r)}${r.base.extensionVersion ? ` · buhprof_api ${r.base.extensionVersion}` : ""}`,
		reqWhere: whereText(r),
		reqOrganizations: r.organizations.map((o) => `${o.name || "—"}${o.bin ? ` (${o.bin})` : ""}${o.erp ? ` — ${translate("onecReqBinMatch")}` : ""}`).join("; ") || "—",
		reqSentBy: [r.user?.name, r.contact].filter(Boolean).join(" · ") || "—",
		reqComment: r.comment || "—",
		reqReceived: r.createdAt,
		reqExpires: r.state === "PENDING" ? r.expiresAt : null,
		reqResult: r.state === "APPROVED"
			? `${r.baseKey ?? "—"} · ${r.tokenDelivered ? translate("onecReqTokenDelivered") : translate("onecReqTokenWaiting")}${r.note ? ` · ${r.note}` : ""}`
			: r.note || "—",
		reqRepeats: r.repeats ? `${r.repeats}${r.ip ? ` · ${r.ip}` : ""}` : "—",
	})), (r) => r.uuid), [items]);
	const view = useStaticTableView(rowsRaw, { reqReceived: "desc" });

	const pending = active?.state === "PENDING" && canDecide;

	return (
		<>
			<div className={styles.Hint}>{translate("onecReqRegHint")}</div>
			<div className={styles.BasesLimits}>
				<FieldSelect name="reg_state" label={translate("status")} size="sm" value={state}
					onChange={(e) => setState(e.target.value as RegistrationState | "")}
					options={[
						{ value: "PENDING", label: translate("onecReqPending") },
						{ value: "", label: translate("onecReqAll") },
						{ value: "APPROVED", label: translate("onecReqApproved") },
						{ value: "REJECTED", label: translate("onecReqRejected") },
						{ value: "EXPIRED", label: translate("onecReqExpired") },
					]} />
			</div>
			<QueryError error={list.error} noticeKey="onec-registrations" source={translate("onecReqRegistrations")} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_registrations", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search, fitHeight,
				isLoading: list.isLoading, reloading: list.isFetching && !list.isLoading,
				onReload: () => void list.refetch(),
				emptyText: translate("onecReqNone"),
				renderCell: (r, col) => (col.identifier === "reqState"
					? <span className={TONE_CLASS[asText(r.__tone) as keyof typeof TONE_CLASS]}>{asText(r.reqState)}</span>
					// Код — крупнее и моноширинным: его диктуют по телефону и сверяют посимвольно.
					: col.identifier === "reqCode" ? <span className={styles.ReqCode}>{asText(r.reqCode)}</span>
						: undefined),
				onActiveRowChange: (r) => setActiveId(r ? asText(r.uuid) : null),
				// Двойной щелчок по нерешённой заявке — сразу одобрение: ради него заявку и открывают.
				onRowClick: (r) => {
					const reg = items.find((x) => x.id === asText(r.uuid));
					if (reg?.state === "PENDING" && canDecide) setApproving(reg);
				},
				extraButtons: !canDecide ? undefined : (
					<>
						<Button variant="primary" disabled={!pending} onClick={() => active && setApproving(active)}>{translate("onecReqApprove")}</Button>
						<Button disabled={!pending} onClick={() => active && setRejecting(active)}>{translate("onecReqReject")}</Button>
					</>
				),
			})} />

			{approving && <ApproveModal reg={approving} onClose={() => setApproving(null)} onDone={() => { setApproving(null); void refresh(); }} />}
			{rejecting && <RejectModal reg={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); void refresh(); }} />}
		</>
	);
};

const ApproveModal: FC<{ reg: BaseRegistration; onClose: () => void; onDone: () => void }> = ({ reg, onClose, onDone }) => {
	const defaults = approveDefaults(reg);
	const [organizationUuid, setOrganizationUuid] = useState(defaults.organizationUuid);
	const [baseKey, setBaseKey] = useState(defaults.baseKey);
	const [baseId, setBaseId] = useState(defaults.baseId);
	const [note, setNote] = useState("");
	const orgs = useQuery({ queryKey: ["onec", "erp-organizations"], queryFn: fetchErpOrganizations, staleTime: 60_000 });
	const candidates = reg.suggestion.candidates;
	const ready = !!organizationUuid && !!baseKey.trim();

	const approve = useMutation({
		mutationFn: () => approveRegistration(reg.id, { organizationUuid, baseKey: baseKey.trim(), baseId: baseId || null, note: note.trim() || undefined }),
		onSuccess: (d) => {
			showToast(`${translate("onecReqApproved")}: ${reg.code} → ${d.baseKey} (${d.server})`, "success");
			onDone();
		},
		onError: (e) => reportError(e, { source: translate("onecReqRegistrations") }),
	});

	return (
		<Modal title={`${translate("onecReqApprove")}: ${reg.code}`} onClose={onClose} onApply={() => { if (ready && !approve.isPending) approve.mutate(); }}>
			<div className={styles.ModalForm}>
				<div>{reg.base.name} · {configurationText(reg)} · {whereText(reg)}</div>
				<FieldSelect name="reg_org" label={translate("onecReqErpOrg")} value={organizationUuid} required error={!organizationUuid}
					onChange={(e) => setOrganizationUuid(e.target.value)} options={organizationOptions(orgs.data?.items ?? [], reg)} />
				<Field name="reg_base_key" label={translate("onecReqBaseKey")} width={FIELD_WIDTH.lg} value={baseKey} required error={!baseKey.trim()}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setBaseKey(e.target.value); setBaseId(""); }}
					hint={translate("onecReqBaseKeyHint")} />
				{candidates.length > 1 && (
					<FieldSelect name="reg_base" label={translate("onecReqRegistryBase")} value={baseId}
						onChange={(e) => setBaseId(e.target.value)}
						options={[{ value: "", label: translate("onecReqByServer") }, ...candidates.map((c) => ({ value: c.baseId, label: `${c.key} — ${c.server}` }))]} />
				)}
				<FieldTextarea name="reg_note" label={translate("onecReqNote")} value={note} rows={2} onChange={(e) => setNote(e.target.value)} />
				<div className={styles.Hint}>{translate("onecReqApproveHint")}</div>
			</div>
		</Modal>
	);
};

const RejectModal: FC<{ reg: BaseRegistration; onClose: () => void; onDone: () => void }> = ({ reg, onClose, onDone }) => {
	const [note, setNote] = useState("");
	const reject = useMutation({
		mutationFn: () => rejectRegistration(reg.id, note.trim()),
		onSuccess: () => { showToast(`${translate("onecReqRejected")}: ${reg.code}`, "success"); onDone(); },
		onError: (e) => reportError(e, { source: translate("onecReqRegistrations") }),
	});
	return (
		<Modal title={`${translate("onecReqReject")}: ${reg.code}`} onClose={onClose} onApply={() => { if (note.trim() && !reject.isPending) reject.mutate(); }}>
			<div className={styles.ModalForm}>
				<div>{reg.base.name}</div>
				<FieldTextarea name="reg_reject_note" label={translate("onecReqRejectReason")} value={note} rows={3} required error={!note.trim()}
					onChange={(e) => setNote(e.target.value)} hint={translate("onecReqRejectHint")} />
			</div>
		</Modal>
	);
};

export default RegistrationsTab;
