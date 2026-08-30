// Справочник классификаторов РК/ЕАЭС (страны/ТН ВЭД/КАТО/ГС ВС). Единый вид —
// стандартный компонент <Table/> (read-only) + тулбар: выбор типа, поиск, импорт
// официальных данных (суперадмин): из XML-файла гос-системы (КАТО/ГС ВС) или JSON.
// См. backend/api/router/classifiers.js.
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { consumePendingHighlight, subscribeHighlight } from "src/utils/listHighlight";
import { translate } from "src/i18";
import { getCurrentUser } from "src/services/auth";
import Table from "src/components/Table";
import Toolbar from "src/components/Toolbar";
import { FieldFastSearchInternal } from "src/components/Table/TableToolbarControls";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Modal from "src/components/Modal";
import { FieldSelect } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { fetchClassifiers, fetchClassifierCounts, importClassifiers, importClassifiersFile, CLASSIFIER_TYPES } from "src/services/classifiers/api";
import ClassifierTree, { buildNamePathTree, type TreeNode } from "./ClassifierTree";
import { TNVED_GROUPS } from "./tnvedGroups";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import styles from "./Classifiers.module.scss";
import main from "src/styles/main.module.scss";

const COLUMNS: TColumn[] = [
	{ identifier: "code", type: "string", width: "160px", minWidth: "80px", alignment: "left", hint: translate("code"), visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "400px", minWidth: "120px", alignment: "left", hint: translate("name"), visible: true, inlist: true },
	{ identifier: "parentCode", type: "string", width: "140px", minWidth: "80px", alignment: "left", hint: translate("parentCode"), visible: true, inlist: true },
] as unknown as TColumn[];

const COMPONENT = "ClassifiersList";

// Классификаторы крупные (ТН ВЭД ~14к, КАТО ~15к, ГС ВС ~8.5к), но короткие
// (код+имя) и виртуализируются в Table — грузим целиком, чтобы показывать ВСЁ, а
// не первую страницу. Поиск фильтрует на сервере. (Лукап-автокомплит — отдельный
// путь с малым лимитом.)
const VIEW_LIMIT = 100000;

// Классификаторы БЕЗ parentCode, но с иерархией В НАИМЕНОВАНИИ (сегменты через « / »):
// у ТН ВЭД имя листа = путь «позиция / субпозиция / … / вид», что даёт РЕАЛЬНЫЕ названия
// уровней. Такие строим buildNamePathTree; gsvs/country — по parentCode (как есть).
const NAMEPATH_TYPES = new Set<string>(["tnved"]);

/** Готовит узлы для дерева: по сегментам имени (ТН ВЭД, + группы сверху) либо по parentCode. */
function toTreeRows(type: string, rows: TreeNode[]): TreeNode[] {
	return NAMEPATH_TYPES.has(type) ? buildNamePathTree(rows, " / ", TNVED_GROUPS) : rows;
}

// РЕФЕРЕНС pane-toolbar (Идея 1): тулбар вынесен на уровень панели через
// usePaneToolbar, тело — единый .PaneFill со сменой Table↔Tree. Один каркас на
// оба режима, без .Root-асимметрии и без дублирования контролов. uniqId приходит
// от PaneItem ({...p}). Остальные списки НЕ затронуты (Table.hideToolbar=false).
export const ClassifiersList: FC<{ uniqId?: string }> = ({ uniqId }) => {
	const qc = useQueryClient();
	const isSuperAdmin = !!getCurrentUser()?.isSuperAdmin;
	const [type, setType] = useState<string>("country");
	const [search, setSearch] = useState("");
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, COMPONENT));
	const [showImport, setShowImport] = useState(false);
	const [importText, setImportText] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const [viewMode, setViewMode] = useState<"list" | "tree">("list");
	const [showSearch, setShowSearch] = useState(false); // поиск-тумблер, как в таблицах
	// В дереве нужен ВЕСЬ набор (предки совпадений), поэтому на сервер поиск не шлём —
	// фильтруем на клиенте. В списке поиск серверный (как было).
	const serverSearch = viewMode === "tree" ? "" : search;

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["classifiers", type, serverSearch],
		queryFn: async () => (await fetchClassifiers(type, serverSearch, undefined, VIEW_LIMIT)).items,
	});
	const rows = useMemo(() => (data ?? []).map((c, i) => ({ id: i + 1, uuid: c.code, ...c })), [data]);

	// Количества по ВСЕМ типам (для подписей опций селекта) — отдельный лёгкий запрос.
	const { data: countsResp } = useQuery({ queryKey: ["classifier-counts"], queryFn: fetchClassifierCounts, staleTime: 60_000 });
	const counts = countsResp?.counts ?? {};

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
				try { parsed = JSON.parse(importText) as { code: string; name: string; parentCode?: string }[]; if (!Array.isArray(parsed)) throw new Error(); }
				catch { showToast(translate("clsImportBadJson"), "error"); return; }
				const r = await importClassifiers(type, parsed);
				showToast(`${translate("clsImported")}: ${r.upserted}`, "success");
			}
			closeImport(); void refetch();
			void qc.invalidateQueries({ queryKey: ["classifier-counts"] }); // счётчики в опциях
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			showToast(a?.response?.data?.message || a?.message || "Ошибка импорта", "error");
		} finally { setBusy(false); }
	}, [busy, file, importText, type, refetch, closeImport, qc]);

	// Счётчик записей — в подписи КАЖДОЙ опции (количества по всем типам из
	// /classifiers/counts, отображаются постоянно).
	const typeSelect = (
		<FieldSelect name="cls-type" value={type}
			onChange={(e) => { setType(e.target.value); setSearch(""); }}
			options={CLASSIFIER_TYPES.map((t) => {
				const n = counts[t.type];
				return { value: t.type, label: (translate(t.i18) || t.type) + (n != null ? ` (${n})` : "") };
			})} />
	);
	// Кнопки — иконочные (Toolbar.IconButton), как reload/поиск в тулбаре.
	const importBtn = isSuperAdmin && (
		<Toolbar.IconButton icon="download" title={translate("clsImport")} onClick={() => setShowImport(true)} />
	);
	const viewToggle = (
		<Toolbar.IconButton
			icon={viewMode === "list" ? "tree" : "list"}
			active={viewMode === "tree"}
			title={viewMode === "list" ? translate("clsTreeView") : translate("clsListView")}
			onClick={() => setViewMode((m) => (m === "list" ? "tree" : "list"))} />
	);
	// Командная панель — СТАНДАРТНАЯ, как в обычных таблицах: используем тот же
	// <Toolbar> (components/Toolbar) + FieldFastSearchInternal + Toolbar.Reload/
	// SearchButton. Команды слева, reload + поиск-тумблер справа, строка поиска
	// в правой части по кнопке. Растянута на ширину слота (.PaneToolbarFill) —
	// работает space-between. Единый тулбар на оба режима (список/дерево).
	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar className={main.PaneToolbarFill}
			right={showSearch ? <FieldFastSearchInternal value={search} onChange={setSearch} /> : undefined}>
			{typeSelect}
			{viewToggle}
			{importBtn}
			<Toolbar.Divider />
			<Toolbar.ReloadButton onClick={() => void refetch()} disabled={isLoading} />
			<Toolbar.SearchButton onClick={() => setShowSearch((v) => !v)} active={showSearch} />
		</Toolbar>
	));

	// Table без собственной панели управления — тулбар на уровне пейна (см. выше).
	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: COMPONENT, rows, columns, setColumns, isLoading,
		onReload: () => void refetch(), hideToolbar: true,
	}), [rows, columns, isLoading, refetch]);

	// Единый каркас: тулбар — в пейне (paneToolbar), тело — общий .PaneFill,
	// внутри меняется ТОЛЬКО вид (Table ↔ Tree). Никакого .Root-разнобоя.
	return (
		<>
			{paneToolbar}
			<div className={main.PaneFill}>
				{viewMode === "list" ? (
					<Table {...tableProps} />
				) : isLoading ? (
					<div className={styles.Loading}><span className={styles.Spinner} />{translate("loading")}</div>
				) : (
					<ClassifierTree rows={toTreeRows(type, rows)} search={search} />
				)}
			</div>
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
	const [viewMode, setViewMode] = useState<"list" | "tree">("list");
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(COLUMNS, "ClassifierPicker"));
	const serverSearch = viewMode === "tree" ? "" : search;
	const { data, isLoading, refetch } = useQuery({
		queryKey: ["classifiers", type, serverSearch],
		queryFn: async () => (await fetchClassifiers(type, serverSearch, undefined, VIEW_LIMIT)).items,
	});
	const rows = useMemo(() => (data ?? []).map((c, i) => ({ id: i + 1, uuid: c.code, ...c })), [data]);
	const onClick = useCallback((d: Partial<TDataItem>) => { if (d?.code) onSelectItem?.(d as Record<string, unknown>); }, [onSelectItem]);

	// Подсветка/активация текущей строки при открытии «Выбор из списка» (по коду).
	const [highlight, setHighlight] = useState<{ uuid?: string; token: number }>(() => ({ uuid: consumePendingHighlight("classifiers"), token: 0 }));
	useEffect(() => subscribeHighlight("classifiers", (uuid) => setHighlight((h) => ({ uuid, token: h.token + 1 }))), []);

	const viewToggle = (
		<button type="button" className={styles.Btn}
			onClick={() => setViewMode((m) => (m === "list" ? "tree" : "list"))}>
			{viewMode === "list" ? translate("clsTreeView") : translate("clsListView")}
		</button>
	);

	const tableProps = useMemo(() => buildStaticTableProps({
		componentName: "ClassifierPicker", rows, columns, setColumns, isLoading,
		onReload: () => void refetch(), onRowClick: onClick, search: { value: search, onChange: setSearch },
		extraButtons: viewToggle, highlightUuid: highlight.uuid, highlightToken: highlight.token,
	}), [rows, columns, isLoading, refetch, onClick, search, highlight, viewToggle]);

	if (viewMode === "tree") {
		return (
			<div className={styles.Root}>
				<div className={main.Toolbar}>
					<input className={styles.Search} type="search" placeholder={translate("search")}
						value={search} onChange={(e) => setSearch(e.target.value)} />
					{viewToggle}
					<span className={styles.Count}>{isLoading ? "…" : rows.length}</span>
				</div>
				{isLoading ? (
					<div className={styles.Loading}><span className={styles.Spinner} />{translate("loading")}</div>
				) : (
					<ClassifierTree
						rows={toTreeRows(type, rows)}
						search={search}
						highlightCode={highlight.uuid}
						onSelect={(n) => onSelectItem?.({ code: n.code, name: n.name, uuid: n.code })}
					/>
				)}
			</div>
		);
	}
	return <Table {...tableProps} />;
};
ClassifierPicker.displayName = "ClassifierPicker";
