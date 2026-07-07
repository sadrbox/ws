// Входящие ЭСФ (ИС ЭСФ, где предприятие — получатель). Требует сессию NCALayer.
// Единый вид — стандартный <Table/>; загрузка через /esf/incoming (queryInvoice
// INBOUND), подтверждение — без подписи. Сквозной сценарий — с реальным ЭЦП.
import { FC, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import { useEsfSession } from "src/hooks/useEsfSession";
import Notice, { type NoticeItem } from "src/components/Notice";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getFormatDateOnly } from "src/utils/datetime";
import { fetchEsfIncoming, confirmEsfIncoming, type EsfIncomingRow } from "src/services/esf/api";
import styles from "src/models/Edo/Edo.module.scss";

function errMsg(e: unknown): string {
	const a = e as { response?: { data?: { message?: string } }; message?: string };
	return a?.response?.data?.message || a?.message || "Ошибка ЭСФ";
}

const COLUMNS: TColumn[] = [
	{ identifier: "registrationNumber", type: "string", width: "220px", minWidth: "120px", alignment: "left", hint: translate("esfRegNo"), visible: true, inlist: true },
	{ identifier: "date", type: "date", width: "120px", minWidth: "90px", alignment: "left", hint: translate("date"), visible: true, inlist: true },
	{ identifier: "invoiceStatus", type: "string", width: "140px", minWidth: "100px", alignment: "left", hint: translate("edoStatus"), visible: true, inlist: true },
	{ identifier: "__confirm", type: "string", width: "140px", minWidth: "120px", alignment: "center", hint: "", visible: true, inlist: true },
] as unknown as TColumn[];

export const EsfIncomingList: FC = () => {
	const { ensureSession, clearSession } = useEsfSession();
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, "EsfIncomingList"));
	const [rows, setRows] = useState<EsfIncomingRow[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<NoticeItem | null>(null);

	const load = useCallback(async () => {
		setBusy(true); setNotice(null);
		try {
			const sessionId = await ensureSession();
			const to = new Date();
			const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
			const r = await fetchEsfIncoming(sessionId, from.toISOString(), to.toISOString());
			setRows(r.items);
		} catch (e) { clearSession(); setNotice({ type: "attention", text: errMsg(e) }); }
		finally { setBusy(false); }
	}, [ensureSession, clearSession]);

	const confirm = useCallback(async (id: string | null) => {
		if (!id) return;
		setBusy(true); setNotice(null);
		try {
			const sessionId = await ensureSession();
			await confirmEsfIncoming(sessionId, [id]);
			setNotice({ type: "success", text: translate("esfConfirmed") });
			await load();
		} catch (e) { clearSession(); setNotice({ type: "attention", text: errMsg(e) }); }
		finally { setBusy(false); }
	}, [ensureSession, clearSession, load]);

	const tableRows = useMemo<TDataItem[]>(() => (rows ?? []).map((r, i) => ({
		id: i + 1, uuid: r.invoiceId || String(i + 1), invoiceId: r.invoiceId, registrationNumber: r.registrationNumber || "—",
		date: r.deliveryDate || r.inputDate, invoiceStatus: r.invoiceStatus || "—",
	})), [rows]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "date") return <span>{row.date ? getFormatDateOnly(String(row.date)) : "—"}</span>;
		if (col.identifier === "__confirm") return (
			<button className={styles.Btn} disabled={busy} onClick={() => void confirm(row.invoiceId as string | null)}>{translate("esfConfirm")}</button>
		);
		return undefined;
	}, [busy, confirm]);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: "EsfIncomingList", rows: tableRows, columns, setColumns, isLoading: busy,
		renderCell,
		extraButtons: <button className={[styles.Btn, styles.BtnPrimary].join(" ")} disabled={busy} onClick={() => void load()}>{translate("esfSyncIncoming")}</button>,
	}), [tableRows, columns, busy, renderCell, load]);

	return (
		<div className={styles.Wrapper}>
			<Notice items={notice ? [notice] : []} />
			{rows === null ? <div className={styles.Empty}>{translate("esfIncomingHint")}</div> : <Table {...tableProps} />}
		</div>
	);
};
EsfIncomingList.displayName = "EsfIncomingList";
