// Справочник классификаторов РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС). Единый вид —
// стандартный компонент <Table/> (read-only) + тулбар: выбор типа, поиск, импорт
// официальных данных (суперадмин): из XML-файла гос-системы (КАТО/ГС ВС) или JSON.
// См. backend/api/router/classifiers.js.
import { FC, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { getCurrentUser } from "src/services/auth";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { fetchClassifiers, importClassifiers, importClassifiersFile, CLASSIFIER_TYPES } from "src/services/classifiers/api";
import styles from "./Classifiers.module.scss";

const COLUMNS: TColumn[] = [
	{ identifier: "code", type: "string", width: "160px", minWidth: "80px", alignment: "left", hint: translate("code"), visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "400px", minWidth: "120px", alignment: "left", hint: translate("name"), visible: true, inlist: true },
] as unknown as TColumn[];

const COMPONENT = "ClassifiersList";

export const ClassifiersList: FC = () => {
	const isSuperAdmin = !!getCurrentUser()?.isSuperAdmin;
	const [type, setType] = useState<string>("country");
	const [search, setSearch] = useState("");
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, COMPONENT));
	const [showImport, setShowImport] = useState(false);
	const [importText, setImportText] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<NoticeItem | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["classifiers", type, search],
		queryFn: async () => (await fetchClassifiers(type, search)).items,
	});
	const rows = useMemo(() => (data ?? []).map((c, i) => ({ id: i + 1, uuid: c.code, ...c })), [data]);

	const closeImport = useCallback(() => { setShowImport(false); setImportText(""); setFile(null); }, []);

	const doImport = useCallback(async () => {
		if (busy) return;
		setNotice(null); setBusy(true);
		try {
			if (file) {
				const r = await importClassifiersFile(file);
				const detail = Object.entries(r.counts).map(([t, n]) => `${t}: ${n}`).join(", ");
				setNotice({ type: "success", text: `${translate("clsImported")} (${detail})` });
			} else {
				let parsed: { code: string; name: string; parentCode?: string }[];
				try { parsed = JSON.parse(importText); if (!Array.isArray(parsed)) throw new Error(); }
				catch { setNotice({ type: "attention", text: translate("clsImportBadJson") }); return; }
				const r = await importClassifiers(type, parsed);
				setNotice({ type: "success", text: `${translate("clsImported")}: ${r.upserted}` });
			}
			closeImport(); void refetch();
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			setNotice({ type: "attention", text: a?.response?.data?.message || a?.message || "Ошибка импорта" });
		} finally { setBusy(false); }
	}, [busy, file, importText, type, refetch, closeImport]);

	const toolbar = (
		<>
			<select className={styles.Select} value={type} onChange={(e) => { setType(e.target.value); setSearch(""); }}>
				{CLASSIFIER_TYPES.map((t) => <option key={t.type} value={t.type}>{translate(t.i18) || t.type}</option>)}
			</select>
			{isSuperAdmin && <button className={styles.Btn} onClick={() => setShowImport(true)}>{translate("clsImport")}</button>}
		</>
	);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: COMPONENT, rows, columns, setColumns, isLoading,
		onReload: () => void refetch(), extraButtons: toolbar,
		search: { value: search, onChange: setSearch },
	}), [rows, columns, isLoading, refetch, toolbar, search]);

	return (
		<div className={styles.Wrapper}>
			<Notice items={notice ? [notice] : []} />
			<Table {...tableProps} />
			{showImport && (
				<Modal title={translate("clsImport")} onClose={closeImport} onApply={doImport}>
					<div className={styles.Hint}>{translate("clsImportFileHint")}</div>
					<input ref={fileRef} type="file" accept=".xml,text/xml" className={styles.File} disabled={busy}
						onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
					{file && <div className={styles.Count}>{file.name} — {(file.size / 1048576).toFixed(1)} MB</div>}
					<div className={styles.Hint}>{translate("clsImportHint")}</div>
					<textarea className={styles.ImportArea} value={importText} disabled={busy || !!file}
						placeholder='[{"code":"1234","name":"…","parentCode":"12"}]'
						onChange={(e) => setImportText(e.target.value)} />
					{busy && <div className={styles.Count}>{translate("clsImporting")}</div>}
				</Modal>
			)}
		</div>
	);
};
ClassifiersList.displayName = "ClassifiersList";
