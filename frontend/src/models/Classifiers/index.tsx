// Справочник классификаторов РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС). Единый вид —
// стандартный компонент <Table/> (read-only) + тулбар: выбор типа, поиск, импорт
// официальных данных (суперадмин): из XML-файла гос-системы (КАТО/ГС ВС) или JSON.
// См. backend/api/router/classifiers.js.
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { consumePendingHighlight, subscribeHighlight } from "src/utils/listHighlight";
import { translate } from "src/i18";
import { getCurrentUser } from "src/services/auth";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Modal from "src/components/Modal";
import { FieldSelect } from "src/components/Field";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
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
	const fileRef = useRef<HTMLInputElement>(null);

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["classifiers", type, search],
		queryFn: async () => (await fetchClassifiers(type, search)).items,
	});
	const rows = useMemo(() => (data ?? []).map((c, i) => ({ id: i + 1, uuid: c.code, ...c })), [data]);

	const closeImport = useCallback(() => { setShowImport(false); setImportText(""); setFile(null); }, []);

	const doImport = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		try {
			if (file) {
				const r = await importClassifiersFile(file);
				const detail = Object.entries(r.counts).map(([t, n]) => `${t}: ${n}`).join(", ");
				showToast(`${translate("clsImported")} (${detail})`, "success");
			} else {
				let parsed: { code: string; name: string; parentCode?: string }[];
				try { parsed = JSON.parse(importText); if (!Array.isArray(parsed)) throw new Error(); }
				catch { showToast(translate("clsImportBadJson"), "error"); return; }
				const r = await importClassifiers(type, parsed);
				showToast(`${translate("clsImported")}: ${r.upserted}`, "success");
			}
			closeImport(); void refetch();
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			showToast(a?.response?.data?.message || a?.message || "Ошибка импорта", "error");
		} finally { setBusy(false); }
	}, [busy, file, importText, type, refetch, closeImport]);

	const toolbar = (
		<>
			<FieldSelect name="cls-type" size="sm" value={type}
				onChange={(e) => { setType(e.target.value); setSearch(""); }}
				options={CLASSIFIER_TYPES.map((t) => ({ value: t.type, label: translate(t.i18) || t.type }))} />
			{isSuperAdmin && <Button variant="secondary" onClick={() => setShowImport(true)}>{translate("clsImport")}</Button>}
		</>
	);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: COMPONENT, rows, columns, setColumns, isLoading,
		onReload: () => void refetch(), extraButtons: toolbar,
		search: { value: search, onChange: setSearch },
	}), [rows, columns, isLoading, refetch, toolbar, search]);

	// Разметка как у обычного *List: <Table/> заполняет панель (без паддинг-обёртки).
	// Модалка импорта — портал (в body), рендерится сиблингом.
	return (
		<>
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
		</>
	);
};
ClassifiersList.displayName = "ClassifiersList";

// ── Пикер классификатора для «Выбора из списка» (LookupField → SelectPaneWrapper).
// Тип классификатора приходит через extraParams/extraQueryParams.type.
interface PickerProps {
	onSelectItem?: (item: Record<string, unknown>) => void;
	extraParams?: Record<string, string>;
	extraQueryParams?: Record<string, string>;
}

export const ClassifierPicker: FC<PickerProps> = ({ onSelectItem, extraParams, extraQueryParams }) => {
	const type = extraParams?.type || extraQueryParams?.type || "country";
	const [search, setSearch] = useState("");
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, "ClassifierPicker"));
	const { data, isLoading, refetch } = useQuery({
		queryKey: ["classifiers", type, search],
		queryFn: async () => (await fetchClassifiers(type, search)).items,
	});
	const rows = useMemo(() => (data ?? []).map((c, i) => ({ id: i + 1, uuid: c.code, ...c })), [data]);
	const onClick = useCallback((d: Partial<TDataItem>) => { if (d?.code) onSelectItem?.(d as Record<string, unknown>); }, [onSelectItem]);

	// Подсветка/активация текущей строки при открытии «Выбор из списка» (по коду).
	const [highlight, setHighlight] = useState<{ uuid?: string; token: number }>(() => ({ uuid: consumePendingHighlight("classifiers"), token: 0 }));
	useEffect(() => subscribeHighlight("classifiers", (uuid) => setHighlight((h) => ({ uuid, token: h.token + 1 }))), []);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: "ClassifierPicker", rows, columns, setColumns, isLoading,
		onReload: () => void refetch(), onRowClick: onClick, search: { value: search, onChange: setSearch },
		highlightUuid: highlight.uuid, highlightToken: highlight.token,
	}), [rows, columns, isLoading, refetch, onClick, search, highlight]);
	return <Table {...tableProps} />;
};
ClassifierPicker.displayName = "ClassifierPicker";
