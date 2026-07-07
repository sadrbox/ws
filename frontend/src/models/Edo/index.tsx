// ЭДО (документооборот с контрагентами) — UI: списки Входящие/Исходящие + форма
// документа с действиями (подпись NCALayer, приём/отклонение/отзыв/аннулирование).
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
import { useAppContext } from "src/app/context";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useEdoDocument } from "src/hooks/useEdoDocument";
import Notice, { type NoticeItem } from "src/components/Notice";
import Modal from "src/components/Modal";
import LookupField from "src/components/Field/LookupField";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getFormatDateOnly } from "src/utils/datetime";
import {
	fetchInbox, fetchOutbox, fetchEdoDocument, createEdoDocument, type EdoDocument,
} from "src/services/edo/api";
import styles from "./Edo.module.scss";

// Типы документа ЭДО (свободный обмен между контрагентами).
const EDO_KINDS = ["act", "waybill", "contract", "free"] as const;

// ── Статусы ──────────────────────────────────────────────────────────────────
const STATUS_PALETTE: Record<string, "ok" | "pending" | "bad"> = {
	DELIVERED: "ok", SIGNED: "ok", ACCEPTED: "ok",
	DRAFT: "pending", SENT: "pending",
	REJECTED: "bad", REVOKED: "bad", ANNULLED: "bad",
};
const statusLabel = (s: string) => translate(`edoStatus_${s}`) || s;

// ═══════════════════════════════════════════════════════════════════════════
// СПИСКИ Входящие / Исходящие (стандартный <Table/>)
// ═══════════════════════════════════════════════════════════════════════════

const listColumns = (mode: "inbox" | "outbox"): TColumn[] => ([
	{ identifier: "number", type: "string", width: "140px", minWidth: "80px", alignment: "left", hint: translate("number"), visible: true, inlist: true },
	{ identifier: "date", type: "date", width: "120px", minWidth: "90px", alignment: "left", hint: translate("date"), visible: true, inlist: true },
	{ identifier: "kind", type: "string", width: "120px", minWidth: "80px", alignment: "left", hint: translate("edoKind"), visible: true, inlist: true },
	{ identifier: "contragent", type: "string", width: "160px", minWidth: "100px", alignment: "left", hint: mode === "inbox" ? translate("edoSender") : translate("edoReceiver"), visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "150px", minWidth: "100px", alignment: "left", hint: translate("edoStatus"), visible: true, inlist: true },
] as unknown as TColumn[]);

const EdoList: FC<{ mode: "inbox" | "outbox" }> = ({ mode }) => {
	const { addPane } = useAppContext().windows;
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(listColumns(mode), `Edo_${mode}`));
	const { data, isLoading, refetch } = useQuery({
		queryKey: ["edo", mode],
		queryFn: async () => (mode === "inbox" ? fetchInbox() : fetchOutbox()),
	});
	const rows = useMemo(() => (data?.items ?? []).map((d, i) => ({
		id: i + 1, uuid: d.uuid, number: d.number || "—", date: d.date, kind: d.kind,
		contragent: mode === "inbox" ? d.senderBin : d.receiverBin, status: d.status,
	})), [data, mode]);

	const openDoc = useCallback((d: Partial<TDataItem>) => {
		addPane({ component: EdoDocumentForm, label: `${translate("edo")}: ${d.number || (d.uuid as string || "").slice(0, 8)}`, data: { uuid: d.uuid } });
	}, [addPane]);
	const openCreate = useCallback(() => addPane({ component: EdoDocumentCreateForm, label: translate("edoNew") }), [addPane]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "date") return <span>{row.date ? getFormatDateOnly(String(row.date)) : "—"}</span>;
		if (col.identifier === "status") {
			const s = String(row.status);
			return <span className={[styles.Badge, styles[STATUS_PALETTE[s] || "pending"]].join(" ")}>{statusLabel(s)}</span>;
		}
		return undefined;
	}, []);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: `Edo_${mode}`, rows, columns, setColumns, isLoading,
		onRowClick: openDoc, onReload: () => void refetch(), renderCell,
		extraButtons: mode === "outbox" ? <button className={[styles.Btn, styles.BtnPrimary].join(" ")} onClick={openCreate}>+ {translate("edoNew")}</button> : undefined,
	}), [rows, columns, isLoading, mode, openDoc, refetch, renderCell, openCreate]);

	return <div className={styles.Wrapper}><Table {...tableProps} /></div>;
};

export const EdoInboxList: FC = () => <EdoList mode="inbox" />;
EdoInboxList.displayName = "EdoInboxList";
export const EdoOutboxList: FC = () => <EdoList mode="outbox" />;
EdoOutboxList.displayName = "EdoOutboxList";

// ═══════════════════════════════════════════════════════════════════════════
// СОЗДАНИЕ исходящего документа
// ═══════════════════════════════════════════════════════════════════════════

export const EdoDocumentCreateForm: FC<Partial<TPane>> = () => {
	const { addPane } = useAppContext().windows;
	const queryClient = useQueryClient();
	const [receiverBin, setReceiverBin] = useState("");
	const [receiverName, setReceiverName] = useState("");
	const [kind, setKind] = useState<string>("act");
	const [title, setTitle] = useState("");
	const [number, setNumber] = useState("");
	const [comment, setComment] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const canCreate = /^\d{12}$/.test(receiverBin) && !!kind && !busy;

	const create = useCallback(async () => {
		setBusy(true); setError(null);
		try {
			const { item } = await createEdoDocument({ receiverBin, kind, title: title || undefined, number: number || undefined, comment: comment || undefined });
			void queryClient.invalidateQueries({ queryKey: ["edo", "outbox"] });
			addPane({ component: EdoDocumentForm, label: `${translate("edo")}: ${item.number || item.title || item.uuid.slice(0, 8)}`, data: { uuid: item.uuid } });
			// сброс для возможного повторного создания
			setReceiverBin(""); setReceiverName(""); setTitle(""); setNumber(""); setComment("");
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			setError(a?.response?.data?.message || a?.message || translate("edoNotConnected"));
		} finally { setBusy(false); }
	}, [receiverBin, kind, title, number, comment, addPane, queryClient]);

	return (
		<div className={styles.Wrapper}>
			<Notice items={error ? [{ type: "attention", text: error }] : []} />
			<div className={styles.CreateForm}>
				<div className={styles.Field}>
					<label>{translate("edoReceiver")}</label>
					<LookupField label="" name="edo_receiver" value={receiverBin} displayValue={receiverName}
						endpoint="counterparties" displayField="name"
						onSelect={(_uuid, dv, item) => { setReceiverBin((item as { bin?: string })?.bin || ""); setReceiverName(dv); }}
						onClear={() => { setReceiverBin(""); setReceiverName(""); }} />
				</div>
				<div className={styles.Field}>
					<label>{translate("edoKind")}</label>
					<select className={styles.Select} value={kind} onChange={(e) => setKind(e.target.value)}>
						{EDO_KINDS.map((k) => <option key={k} value={k}>{translate(`edoKind_${k}`) || k}</option>)}
					</select>
				</div>
				<div className={styles.Field}>
					<label>{translate("edoTitle")}</label>
					<input value={title} onChange={(e) => setTitle(e.target.value)} />
				</div>
				<div className={styles.Field}>
					<label>{translate("number")}</label>
					<input value={number} onChange={(e) => setNumber(e.target.value)} />
				</div>
				<div className={styles.Field}>
					<label>{translate("Comment")}</label>
					<input value={comment} onChange={(e) => setComment(e.target.value)} />
				</div>
				<div className={styles.Actions}>
					<button className={[styles.Btn, styles.BtnPrimary].join(" ")} disabled={!canCreate} onClick={() => void create()}>{translate("edoCreate")}</button>
				</div>
			</div>
		</div>
	);
};
EdoDocumentCreateForm.displayName = "EdoDocumentCreateForm";

// ═══════════════════════════════════════════════════════════════════════════
// ФОРМА ДОКУМЕНТА
// ═══════════════════════════════════════════════════════════════════════════

export const EdoDocumentForm: FC<Partial<TPane>> = (paneProps) => {
	const uuid = (paneProps.data as { uuid?: string })?.uuid || "";
	const queryClient = useQueryClient();
	const { organizationUuid: myOrg } = useDefaultOrganization();
	const edo = useEdoDocument();
	const [reasonAction, setReasonAction] = useState<null | "reject" | "annul">(null);
	const [reasonText, setReasonText] = useState("");

	const { data, refetch } = useQuery({
		queryKey: ["edoDoc", uuid],
		queryFn: async () => (await fetchEdoDocument(uuid)).item,
		enabled: !!uuid,
	});
	const doc = data;

	const refresh = useCallback(() => {
		void refetch();
		void queryClient.invalidateQueries({ queryKey: ["edo"] });
	}, [refetch, queryClient]);

	const act = useCallback(async (op: () => Promise<unknown>) => {
		try { await op(); refresh(); } catch { /* ошибка в edo.error → Notice */ }
	}, [refresh]);

	const notices = useMemo<NoticeItem[]>(() => {
		const out: NoticeItem[] = [];
		if (doc) {
			const pal = STATUS_PALETTE[doc.status] || "pending";
			out.push({ type: pal === "ok" ? "success" : pal === "bad" ? "attention" : "warning", text: `${translate("edoStatus")}: ${statusLabel(doc.status)}` });
			if (doc.rejectionReason) out.push({ type: "attention", text: `${translate("edoReason")}: ${doc.rejectionReason}` });
		}
		if (edo.error) out.push({ type: "attention", text: edo.error });
		return out;
	}, [doc, edo.error]);

	if (!doc) return <div className={styles.Wrapper}><div className={styles.Empty}>…</div></div>;

	const isSender = doc.senderOrgUuid === myOrg;
	const isReceiver = doc.receiverOrgUuid === myOrg;
	const st = doc.status;

	const submitReason = () => {
		const r = reasonText.trim();
		if (!r) return;
		const action = reasonAction;
		setReasonAction(null); setReasonText("");
		if (action === "reject") void act(() => edo.reject(uuid, r));
		else if (action === "annul") void act(() => edo.annul(uuid, r));
	};

	return (
		<div className={styles.Wrapper}>
			<Notice items={notices} />

			<dl className={styles.DocHeader}>
				<dt>{translate("edoKind")}</dt><dd>{doc.kind}</dd>
				<dt>{translate("edoTitle")}</dt><dd>{doc.title || "—"}</dd>
				<dt>{translate("number")}</dt><dd>{doc.number || "—"}</dd>
				<dt>{translate("date")}</dt><dd>{doc.date ? getFormatDateOnly(String(doc.date)) : "—"}</dd>
				<dt>{translate("edoSender")}</dt><dd>{doc.senderBin}</dd>
				<dt>{translate("edoReceiver")}</dt><dd>{doc.receiverBin}{doc.receiverOrgUuid ? "" : ` (${translate("edoNotConnected")})`}</dd>
				{doc.comment ? (<><dt>{translate("Comment")}</dt><dd>{doc.comment}</dd></>) : null}
			</dl>

			{doc.attachments && doc.attachments.length > 0 && (
				<div className={styles.Section}>
					<div className={styles.SectionTitle}>{translate("edoAttachments")}</div>
					<ul>{doc.attachments.map((a) => <li key={a.uuid}>{a.fileName}</li>)}</ul>
				</div>
			)}

			<div className={styles.Section}>
				<div className={styles.SectionTitle}>{translate("edoSignatures")} ({doc.signatures?.length ?? 0})</div>
				<ul>
					{(doc.signatures ?? []).map((s) => (
						<li key={s.uuid}>{translate(`edoRole_${s.role}`) || s.role} — {getFormatDateOnly(String(s.signedAt))}</li>
					))}
				</ul>
			</div>

			<div className={styles.Actions}>
				{isSender && st === "DRAFT" && (
					<button className={[styles.Btn, styles.BtnPrimary].join(" ")} disabled={edo.busy} onClick={() => void act(() => edo.signAndSend(uuid))}>{translate("edoSignSend")}</button>
				)}
				{isSender && (st === "SENT" || st === "DELIVERED") && (
					<button className={[styles.Btn, styles.BtnDanger].join(" ")} disabled={edo.busy} onClick={() => void act(() => edo.revoke(uuid))}>{translate("edoRevoke")}</button>
				)}
				{isReceiver && st === "DELIVERED" && (<>
					<button className={[styles.Btn, styles.BtnPrimary].join(" ")} disabled={edo.busy} onClick={() => void act(() => edo.signAndAccept(uuid))}>{translate("edoAcceptSign")}</button>
					<button className={styles.Btn} disabled={edo.busy} onClick={() => void act(() => edo.accept(uuid))}>{translate("edoAccept")}</button>
					<button className={[styles.Btn, styles.BtnDanger].join(" ")} disabled={edo.busy} onClick={() => setReasonAction("reject")}>{translate("edoReject")}</button>
				</>)}
				{(isSender || isReceiver) && (st === "SIGNED" || st === "ACCEPTED") && (
					<button className={[styles.Btn, styles.BtnDanger].join(" ")} disabled={edo.busy} onClick={() => setReasonAction("annul")}>{translate("edoAnnul")}</button>
				)}
			</div>

			{reasonAction && (
				<Modal
					title={reasonAction === "reject" ? translate("edoReject") : translate("edoAnnul")}
					onClose={() => { setReasonAction(null); setReasonText(""); }}
					onApply={submitReason}
				>
					<textarea className={styles.ReasonArea} value={reasonText} placeholder={translate("edoReason")}
						onChange={(e) => setReasonText(e.target.value)} autoFocus />
				</Modal>
			)}
		</div>
	);
};
EdoDocumentForm.displayName = "EdoDocumentForm";
