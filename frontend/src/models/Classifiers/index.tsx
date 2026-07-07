// Справочник классификаторов РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС). Единый вид —
// стандартный компонент <Table/> (read-only) + тулбар: выбор типа, импорт
// официальных данных (суперадмин). См. backend/api/router/classifiers.js.
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { getCurrentUser } from "src/services/auth";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { fetchClassifiers, importClassifiers, CLASSIFIER_TYPES } from "src/services/classifiers/api";
import styles from "./Classifiers.module.scss";

const COLUMNS: TColumn[] = [
	{ identifier: "code", type: "string", width: "160px", minWidth: "80px", alignment: "left", hint: "Код", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "400px", minWidth: "120px", alignment: "left", hint: "Наименование", visible: true, inlist: true },
] as unknown as TColumn[];

const COMPONENT = "ClassifiersList";

export const ClassifiersList: FC = () => {
	const isSuperAdmin = !!getCurrentUser()?.isSuperAdmin;
	const [type, setType] = useState<string>("country");
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, COMPONENT));
	const [showImport, setShowImport] = useState(false);
	const [importText, setImportText] = useState("");
	const [notice, setNotice] = useState<NoticeItem | null>(null);

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["classifiers", type],
		queryFn: async () => (await fetchClassifiers(type)).items,
	});
	const rows = useMemo(() => (data ?? []).map((c, i) => ({ id: i + 1, uuid: c.code, ...c })), [data]);

	const doImport = useCallback(async () => {
		setNotice(null);
		let parsed: { code: string; name: string; parentCode?: string }[];
		try { parsed = JSON.parse(importText); if (!Array.isArray(parsed)) throw new Error(); }
		catch { setNotice({ type: "attention", text: translate("clsImportBadJson") }); return; }
		try {
			const r = await importClassifiers(type, parsed);
			setNotice({ type: "success", text: `${translate("clsImported")}: ${r.upserted}` });
			setShowImport(false); setImportText(""); void refetch();
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			setNotice({ type: "attention", text: a?.response?.data?.message || a?.message || "Ошибка импорта" });
		}
	}, [importText, type, refetch]);

	const toolbar = (
		<>
			<select className={styles.Select} value={type} onChange={(e) => setType(e.target.value)}>
				{CLASSIFIER_TYPES.map((t) => <option key={t.type} value={t.type}>{translate(t.i18) || t.type}</option>)}
			</select>
			{isSuperAdmin && <button className={styles.Btn} onClick={() => setShowImport(true)}>{translate("clsImport")}</button>}
		</>
	);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: COMPONENT, rows, columns, setColumns, isLoading, onReload: () => void refetch(), extraButtons: toolbar,
	}), [rows, columns, isLoading, refetch, toolbar]);

	return (
		<div className={styles.Wrapper}>
			<Notice items={notice ? [notice] : []} />
			<Table {...tableProps} />
			{showImport && (
				<Modal title={translate("clsImport")} onClose={() => setShowImport(false)} onApply={doImport}>
					<div className={styles.Hint}>{translate("clsImportHint")}</div>
					<textarea className={styles.ImportArea} value={importText} placeholder='[{"code":"1234","name":"…","parentCode":"12"}]'
						onChange={(e) => setImportText(e.target.value)} />
				</Modal>
			)}
		</div>
	);
};
ClassifiersList.displayName = "ClassifiersList";
