// Админ-панель «Лицензии ЭСФ» (superadmin): список организаций по БИН, дата последней
// заявки на активацию и последнего heartbeat, переключатель активности прямо в строке,
// срок действия. Очередь на подключение (неактивные с заявками) — сверху.
// Данные: backend/api/router/esfLicense.js (adminRouter). Только фронт-CRUD.
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Modal from "src/components/Modal";
import { Field, FieldDate, FieldSelect } from "src/components/Field";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getFormatDate } from "src/utils/datetime";
import {
	fetchEsfLicenses, patchEsfLicense, createEsfLicense, deleteEsfLicense, type EsfLicense,
} from "src/services/esfLicenses/api";
import styles from "./EsfLicenses.module.scss";

const COMPONENT = "EsfLicensesList";

const COLUMNS: TColumn[] = [
	{ identifier: "bin", type: "string", width: "140px", minWidth: "110px", alignment: "left", hint: "БИН", visible: true, inlist: true },
	{ identifier: "note", type: "string", width: "240px", minWidth: "120px", alignment: "left", hint: "Организация / контакт", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "120px", minWidth: "90px", alignment: "left", hint: "Статус", visible: true, inlist: true, sortable: false },
	{ identifier: "lastRequestAt", type: "datetime", width: "150px", minWidth: "110px", alignment: "left", hint: "Заявка на активацию", visible: true, inlist: true },
	{ identifier: "lastHeartbeatAt", type: "datetime", width: "150px", minWidth: "110px", alignment: "left", hint: "Последний heartbeat", visible: true, inlist: true },
	{ identifier: "expiresAt", type: "date", width: "120px", minWidth: "100px", alignment: "left", hint: "Действует до", visible: true, inlist: true },
	{ identifier: "active", type: "boolean", width: "110px", minWidth: "90px", alignment: "center", hint: "Активна", visible: true, inlist: true, sortable: false },
] as unknown as TColumn[];

type StatusKind = "active" | "inactive" | "expired";
function statusOf(l: EsfLicense): StatusKind {
	if (!l.active) return "inactive";
	if (l.expiresAt && new Date(l.expiresAt) < new Date()) return "expired";
	return "active";
}
const STATUS_LABEL: Record<StatusKind, string> = { active: "Активна", inactive: "Не активна", expired: "Истекла" };

export const EsfLicensesList: FC = () => {
	const [active, setActive] = useState<string>(""); // "" | "true" | "false"
	const [search, setSearch] = useState("");
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, COMPONENT));
	const [edit, setEdit] = useState<EsfLicense | null>(null);
	const [adding, setAdding] = useState(false);
	const [busy, setBusy] = useState(false);

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["esf-licenses", active, search],
		queryFn: async () => (await fetchEsfLicenses({ active: active || undefined, search, limit: 1000 })).items,
	});
	const rows = useMemo(() => (data ?? []).map((l, i) => ({ id: i + 1, uuid: l.bin, ...l })), [data]);

	const toggleActive = useCallback(async (bin: string, next: boolean) => {
		try {
			await patchEsfLicense(bin, { active: next });
			void refetch();
		} catch {
			showToast("Не удалось изменить статус лицензии", "error");
		}
	}, [refetch]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		const lic = row as unknown as EsfLicense;
		if (col.identifier === "status") {
			const k = statusOf(lic);
			return <span className={`${styles.Badge} ${styles[k]}`}>{STATUS_LABEL[k]}</span>;
		}
		if (col.identifier === "active") {
			return (
				<label className={styles.Toggle} onClick={(e) => e.stopPropagation()}>
					<input type="checkbox" checked={lic.active} onChange={(e) => void toggleActive(lic.bin, e.target.checked)} />
				</label>
			);
		}
		return undefined; // даты/строки — стандартное форматирование Table
	}, [toggleActive]);

	const toolbar = (
		<>
			<FieldSelect name="esf-active" size="sm" value={active}
				onChange={(e) => setActive(e.target.value)}
				options={[{ value: "", label: "Все" }, { value: "false", label: "Не активные" }, { value: "true", label: "Активные" }]} />
			<Button variant="secondary" onClick={() => setAdding(true)}>Добавить БИН</Button>
		</>
	);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: COMPONENT, rows, columns, setColumns, isLoading,
		onReload: () => void refetch(), onRowClick: (d) => setEdit(d as unknown as EsfLicense),
		renderCell, extraButtons: toolbar, search: { value: search, onChange: setSearch },
	}), [rows, columns, isLoading, refetch, renderCell, toolbar, search]);

	return (
		<>
			<Table {...tableProps} />
			{adding && <AddModal busy={busy} setBusy={setBusy} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void refetch(); }} />}
			{edit && <EditModal lic={edit} busy={busy} setBusy={setBusy} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void refetch(); }} />}
		</>
	);
};
EsfLicensesList.displayName = COMPONENT;

// ── Добавление БИН вручную ────────────────────────────────────────────────────
const AddModal: FC<{ busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; onDone: () => void }> = ({ busy, setBusy, onClose, onDone }) => {
	const [bin, setBin] = useState("");
	const [note, setNote] = useState("");
	const submit = async () => {
		if (busy) return;
		if (!bin.trim()) { showToast("Укажите БИН", "error"); return; }
		setBusy(true);
		try {
			await createEsfLicense({ bin: bin.trim(), note: note.trim() || null });
			showToast("БИН добавлен", "success");
			onDone();
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } } };
			showToast(a?.response?.data?.message || "Не удалось добавить БИН", "error");
		} finally { setBusy(false); }
	};
	return (
		<Modal title="Добавить БИН" onClose={onClose} onApply={submit}>
			<div className={styles.Form}>
				<Field label="БИН" name="add-bin" value={bin} onChange={(e) => setBin(e.target.value)} />
				<Field label="Организация / контакт" name="add-note" value={note} onChange={(e) => setNote(e.target.value)} />
			</div>
		</Modal>
	);
};

// ── Редактирование лицензии ───────────────────────────────────────────────────
const EditModal: FC<{ lic: EsfLicense; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; onDone: () => void }> = ({ lic, busy, setBusy, onClose, onDone }) => {
	const [note, setNote] = useState(lic.note ?? "");
	const [active, setActive] = useState(lic.active);
	const [expiresAt, setExpiresAt] = useState(lic.expiresAt ? lic.expiresAt.slice(0, 10) : "");

	const save = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await patchEsfLicense(lic.bin, { active, note: note.trim() || null, expiresAt: expiresAt || null });
			showToast("Сохранено", "success");
			onDone();
		} catch {
			showToast("Не удалось сохранить", "error");
		} finally { setBusy(false); }
	};
	const remove = async () => {
		if (busy) return;
		if (!window.confirm(`Удалить лицензию БИН ${lic.bin}?`)) return;
		setBusy(true);
		try {
			await deleteEsfLicense(lic.bin);
			showToast("Удалено", "success");
			onDone();
		} catch {
			showToast("Не удалось удалить", "error");
		} finally { setBusy(false); }
	};

	return (
		<Modal title={`Лицензия ЭСФ — ${lic.bin}`} onClose={onClose} onApply={save}>
			<div className={styles.Form}>
				<Field label="Организация / контакт" name="edit-note" value={note} onChange={(e) => setNote(e.target.value)} />
				<label className={styles.Row}>
					<input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Активна
				</label>
				<FieldDate label="Действует до (пусто = бессрочно)" name="edit-expires" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
				<div className={styles.Meta}>
					Заявок: {lic.requestCount} · последняя: {lic.lastRequestAt ? getFormatDate(lic.lastRequestAt) : "—"}<br />
					Heartbeat: {lic.lastHeartbeatAt ? getFormatDate(lic.lastHeartbeatAt) : "—"}
					{lic.lastHeartbeatInstallId ? ` · install ${lic.lastHeartbeatInstallId}` : ""}
				</div>
				<div className={styles.Delete}>
					<Button variant="danger" onClick={remove}>Удалить</Button>
				</div>
			</div>
		</Modal>
	);
};

export default EsfLicensesList;
