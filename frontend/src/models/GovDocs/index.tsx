// Государственные документы РК — списки «Исходящие» ЭАВР и СНТ (выписанные из
// Реализации/Перемещения, со статусом и рег.номером). Единый вид — стандартный
// <Table/>; клик по строке открывает документ-источник.
import { FC, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { useAppContext } from "src/app/context";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getFormatDateOnly } from "src/utils/datetime";
import { openDocumentByType } from "src/utils/accountingDocTypes";
import { useEsfSession } from "src/hooks/useEsfSession";
import { useNcaLayerSign } from "src/hooks/useNcaLayerSign";
import { getKeyInfo } from "src/services/ncalayer";
import Notice, { type NoticeItem } from "src/components/Notice";
import {
	fetchAwpOutbox, fetchSntOutbox, fetchAwpIncoming, fetchSntIncoming,
	buildAwpAction, changeAwpIncoming, buildSntAction, changeSntIncoming,
	type GovIncomingRow, type GovAction,
} from "src/services/govdocs/api";
import styles from "src/models/Edo/Edo.module.scss";

const PALETTE: Record<string, "ok" | "pending" | "bad"> = {
	DELIVERED: "ok", CONFIRMED: "ok", CREATED: "ok",
	DRAFT: "pending", SENT: "pending",
	DECLINED: "bad", REVOKED: "bad", FAILED: "bad",
};
const badge = (s: string | null) => (
	<span className={[styles.Badge, styles[PALETTE[String(s)] || "pending"]].join(" ")}>{s || "—"}</span>
);
const fmtDate = (d: unknown) => (d ? getFormatDateOnly(String(d)) : "—");

// ── Исходящие ЭАВР ────────────────────────────────────────────────────────────
const AWP_COLUMNS: TColumn[] = [
	{ identifier: "number", type: "string", width: "140px", minWidth: "80px", alignment: "left", hint: translate("number"), visible: true, inlist: true },
	{ identifier: "date", type: "date", width: "110px", minWidth: "90px", alignment: "left", hint: translate("date"), visible: true, inlist: true },
	{ identifier: "counterpartyName", type: "string", width: "220px", minWidth: "120px", alignment: "left", hint: translate("counterparty"), visible: true, inlist: true },
	{ identifier: "awpStatus", type: "string", width: "130px", minWidth: "90px", alignment: "left", hint: translate("edoStatus"), visible: true, inlist: true },
	{ identifier: "awpRegistrationNumber", type: "string", width: "200px", minWidth: "120px", alignment: "left", hint: translate("esfRegNo"), visible: true, inlist: true },
] as unknown as TColumn[];

export const AwpOutboxList: FC = () => {
	const { addPane } = useAppContext().windows;
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(AWP_COLUMNS, "AwpOutboxList"));
	const { data, isLoading, refetch } = useQuery({ queryKey: ["awp", "outbox"], queryFn: async () => (await fetchAwpOutbox()).items });
	const rows = useMemo(() => (data ?? []).map((r, i) => ({ id: i + 1, ...r })), [data]);

	const open = useCallback((d: Partial<TDataItem>) => { if (d.uuid) void openDocumentByType("sale", String(d.uuid), addPane); }, [addPane]);
	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "date") return <span>{fmtDate(row.date)}</span>;
		if (col.identifier === "awpStatus") return badge(row.awpStatus as string | null);
		return undefined;
	}, []);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: "AwpOutboxList", rows, columns, setColumns, isLoading, onRowClick: open, onReload: () => void refetch(), renderCell,
	}), [rows, columns, isLoading, open, refetch, renderCell]);

	return <div className={styles.Wrapper}><Table {...tableProps} /></div>;
};
AwpOutboxList.displayName = "AwpOutboxList";

// ── Исходящие СНТ ─────────────────────────────────────────────────────────────
const SNT_COLUMNS: TColumn[] = [
	{ identifier: "number", type: "string", width: "140px", minWidth: "80px", alignment: "left", hint: translate("number"), visible: true, inlist: true },
	{ identifier: "date", type: "date", width: "110px", minWidth: "90px", alignment: "left", hint: translate("date"), visible: true, inlist: true },
	{ identifier: "sourceLabel", type: "string", width: "150px", minWidth: "100px", alignment: "left", hint: translate("basisDocument"), visible: true, inlist: true },
	{ identifier: "contragent", type: "string", width: "200px", minWidth: "120px", alignment: "left", hint: translate("counterparty"), visible: true, inlist: true },
	{ identifier: "sntStatus", type: "string", width: "130px", minWidth: "90px", alignment: "left", hint: translate("edoStatus"), visible: true, inlist: true },
	{ identifier: "sntRegistrationNumber", type: "string", width: "200px", minWidth: "120px", alignment: "left", hint: translate("esfRegNo"), visible: true, inlist: true },
] as unknown as TColumn[];

export const SntOutboxList: FC = () => {
	const { addPane } = useAppContext().windows;
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(SNT_COLUMNS, "SntOutboxList"));
	const { data, isLoading, refetch } = useQuery({ queryKey: ["snt", "outbox"], queryFn: async () => (await fetchSntOutbox()).items });
	const rows = useMemo(() => (data ?? []).map((r, i) => ({
		id: i + 1, ...r,
		sourceLabel: r.source === "inventory-transfers" ? translate("docType_inventory_transfer") : translate("docType_sale"),
	})), [data]);

	const open = useCallback((d: Partial<TDataItem>) => {
		if (!d.uuid) return;
		const type = d.source === "inventory-transfers" ? "inventory_transfer" : "sale";
		void openDocumentByType(type, String(d.uuid), addPane);
	}, [addPane]);
	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "date") return <span>{fmtDate(row.date)}</span>;
		if (col.identifier === "sntStatus") return badge(row.sntStatus as string | null);
		return undefined;
	}, []);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: "SntOutboxList", rows, columns, setColumns, isLoading, onRowClick: open, onReload: () => void refetch(), renderCell,
	}), [rows, columns, isLoading, open, refetch, renderCell]);

	return <div className={styles.Wrapper}><Table {...tableProps} /></div>;
};
SntOutboxList.displayName = "SntOutboxList";

// ── Входящие СНТ/ЭАВР (опрос ИС ЭСФ через сессию NCALayer) ────────────────────
// + приём: Принять(CONFIRM)/Отклонить(DECLINE) — подписанное действие через NCALayer.
const INCOMING_COLUMNS: TColumn[] = [
	{ identifier: "registrationNumber", type: "string", width: "220px", minWidth: "120px", alignment: "left", hint: translate("esfRegNo"), visible: true, inlist: true },
	{ identifier: "date", type: "date", width: "120px", minWidth: "90px", alignment: "left", hint: translate("date"), visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "150px", minWidth: "100px", alignment: "left", hint: translate("edoStatus"), visible: true, inlist: true },
	{ identifier: "__actions", type: "string", width: "220px", minWidth: "160px", alignment: "left", hint: translate("actions"), visible: true, inlist: true },
] as unknown as TColumn[];

function useGovIncoming(kind: "awp" | "snt", componentName: string) {
	const { ensureSession, clearSession } = useEsfSession();
	const { sign } = useNcaLayerSign();
	const certRef = useRef<string | null>(null);
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(INCOMING_COLUMNS, componentName));
	const [rows, setRows] = useState<GovIncomingRow[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<NoticeItem | null>(null);
	const [decline, setDecline] = useState<{ id: string } | null>(null);
	const [reason, setReason] = useState("");

	const ensureCert = useCallback(async () => {
		if (certRef.current) return certRef.current;
		certRef.current = (await getKeyInfo({ keyType: "SIGNATURE" })).certificate;
		return certRef.current;
	}, []);

	const load = useCallback(async () => {
		setBusy(true); setNotice(null);
		try {
			const sessionId = await ensureSession();
			const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
			const { items } = kind === "awp" ? await fetchAwpIncoming(sessionId, from) : await fetchSntIncoming(sessionId, from);
			setRows(items);
		} catch (e) {
			clearSession();
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			setNotice({ type: "attention", text: a?.response?.data?.message || a?.message || "Ошибка" });
		} finally { setBusy(false); }
	}, [kind, ensureSession, clearSession]);

	// Приём/отклонение: build-action → подпись NCALayer (enveloped) → change-status.
	const act = useCallback(async (docId: string, action: GovAction, cause?: string) => {
		setBusy(true); setNotice(null);
		try {
			const sessionId = await ensureSession();
			const cert = await ensureCert();
			const { xml } = kind === "awp" ? await buildAwpAction(docId, action, cause) : await buildSntAction(docId, action, cause);
			const signed = await sign(xml, "SIGNATURE");
			if (kind === "awp") await changeAwpIncoming(sessionId, docId, signed, cert || undefined);
			else await changeSntIncoming(sessionId, docId, signed, cert || undefined);
			setNotice({ type: "success", text: action === "CONFIRM" ? translate("govAccepted") : translate("govDeclined") });
			await load();
		} catch (e) {
			clearSession();
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			setNotice({ type: "attention", text: a?.response?.data?.message || a?.message || "Ошибка" });
		} finally { setBusy(false); }
	}, [kind, ensureSession, ensureCert, sign, load, clearSession]);

	const tableRows = useMemo<TDataItem[]>(() => (rows ?? []).map((r, i) => ({
		id: i + 1, uuid: r.registrationNumber || String(i + 1), docId: r.awpId || r.sntId || "",
		registrationNumber: r.registrationNumber || "—", date: r.date, status: r.status,
	})), [rows]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "date") return <span>{fmtDate(row.date)}</span>;
		if (col.identifier === "status") return badge(row.status as string | null);
		if (col.identifier === "__actions") {
			const id = String(row.docId || "");
			if (!id) return <span>—</span>;
			return (
				<div className={styles.Actions}>
					<button className={[styles.Btn, styles.BtnPrimary].join(" ")} disabled={busy} onClick={() => void act(id, "CONFIRM")}>{translate("govAccept")}</button>
					<button className={[styles.Btn, styles.BtnDanger].join(" ")} disabled={busy} onClick={() => { setReason(""); setDecline({ id }); }}>{translate("govDecline")}</button>
				</div>
			);
		}
		return undefined;
	}, [busy, act]);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName, rows: tableRows, columns, setColumns, isLoading: busy, renderCell,
		extraButtons: <button className={[styles.Btn, styles.BtnPrimary].join(" ")} disabled={busy} onClick={() => void load()}>{translate("esfSyncIncoming")}</button>,
	}), [componentName, tableRows, columns, busy, renderCell, load]);

	const declineModal = decline ? (
		<Modal title={translate("govDecline")} onClose={() => setDecline(null)}
			onApply={() => { if (!reason.trim()) { setNotice({ type: "attention", text: translate("govReasonRequired") }); return; } const id = decline.id; setDecline(null); void act(id, "DECLINE", reason.trim()); }}>
			<div className={styles.SectionTitle}>{translate("govReasonHint")}</div>
			<textarea className={styles.ReasonArea} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={translate("govReasonHint")} />
		</Modal>
	) : null;

	return { rows, notice, tableProps, declineModal };
}

export const AwpIncomingList: FC = () => {
	const { rows, notice, tableProps, declineModal } = useGovIncoming("awp", "AwpIncomingList");
	return <div className={styles.Wrapper}><Notice items={notice ? [notice] : []} />{rows === null ? <div className={styles.Empty}>{translate("esfIncomingHint")}</div> : <Table {...tableProps} />}{declineModal}</div>;
};
AwpIncomingList.displayName = "AwpIncomingList";

export const SntIncomingList: FC = () => {
	const { rows, notice, tableProps, declineModal } = useGovIncoming("snt", "SntIncomingList");
	return <div className={styles.Wrapper}><Notice items={notice ? [notice] : []} />{rows === null ? <div className={styles.Empty}>{translate("esfIncomingHint")}</div> : <Table {...tableProps} />}{declineModal}</div>;
};
SntIncomingList.displayName = "SntIncomingList";
