// Вкладки карточки лицензии ЭСФ: установки (базы 1С) и журнал обращений.
// Обе панели — только чтение (данные порождает 1С), кроме отвязки установки.
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import Table from "src/components/Table";
import type { TableProps } from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { Button } from "src/components/Button";
import ConfirmModal from "src/components/ConfirmModal";
import { useConfirm } from "src/hooks/useConfirm";
import { showToast } from "src/components/UIToast";
import apiClient from "src/services/api/client";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import styles from "src/styles/main.module.scss";
import installsColumnsJson from "./installs.columns.json";
import logsColumnsJson from "./logs.columns.json";

const MODEL_ENDPOINT = "esf-licenses";

interface PanelProps {
	/** uuid лицензии; пока форма не сохранена — панели не грузятся. */
	licenseUuid?: string;
}

/** Общие пропсы Table для read-only панели (пагинация/фильтры не нужны). */
function readonlyTableProps(args: {
	componentName: string;
	rows: TDataItem[];
	columns: TColumn[];
	setColumns: (c: TColumn[]) => void;
	isLoading: boolean;
	refetch: () => void;
	renderCell?: (row: TDataItem, col: TColumn) => React.ReactNode | undefined;
}) {
	return {
		variant: "default" as const,
		selectable: false,
		enableDateRange: false,
		componentName: args.componentName,
		rows: args.rows,
		columns: args.columns,
		total: args.rows.length,
		isLoading: args.isLoading,
		error: undefined,
		readonly: true,
		hideAddDelete: true,
		pagination: { page: 1, limit: args.rows.length || 50, onPageChange: () => { }, onLimitChange: () => { } },
		sorting: { sort: {}, onSortChange: () => { } },
		filtering: { filters: undefined, onFilterChange: () => { }, onClearAll: () => { } },
		search: { value: "", onChange: () => { } },
		actions: {
			openModelForm: () => { },
			refetch: args.refetch,
			setColumns: args.setColumns,
			fetchNextPage: () => { },
			setAdaptiveLimit: () => { },
		},
		renderCell: args.renderCell,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// УСТАНОВКИ (S-07): базы 1С, приславшие heartbeat/заявку под этим БИН
// ═══════════════════════════════════════════════════════════════════════════

const INSTALLS_COMPONENT = "EsfLicenseInstalls_part";

interface InstallsResponse {
	items?: TDataItem[];
	activeCount?: number;
	limit?: number;
	enforced?: boolean;
}

const InstallsPanel: FC<PanelProps> = ({ licenseUuid }) => {
	const [rows, setRows] = useState<TDataItem[]>([]);
	const [summary, setSummary] = useState<{ activeCount: number; limit: number; enforced: boolean }>({ activeCount: 0, limit: 0, enforced: false });
	const [isLoading, setIsLoading] = useState(false);
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(installsColumnsJson as TColumn[], INSTALLS_COMPONENT, "part"));
	const { confirm, confirmState } = useConfirm();

	const load = useCallback(async () => {
		if (!licenseUuid) { setRows([]); return; }
		setIsLoading(true);
		try {
			const res = await apiClient.get<InstallsResponse>(`/${MODEL_ENDPOINT}/${licenseUuid}/installs`);
			setRows(res.data?.items ?? []);
			setSummary({ activeCount: res.data?.activeCount ?? 0, limit: res.data?.limit ?? 0, enforced: res.data?.enforced === true });
		} catch {
			showToast(translate("esfLoadError"), "error");
		} finally {
			setIsLoading(false);
		}
	}, [licenseUuid]);

	useEffect(() => { void load(); }, [load]);

	const release = useCallback(async (row: TDataItem) => {
		if (!licenseUuid) return;
		if (!(await confirm(translate("esfInstallReleaseConfirm")))) return;
		try {
			await apiClient.delete(`/${MODEL_ENDPOINT}/${licenseUuid}/installs/${asText(row.uuid)}`);
			showToast(translate("esfInstallReleased"), "success");
			await load();
		} catch {
			showToast(translate("esfLoadError"), "error");
		}
	}, [confirm, licenseUuid, load]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "status") {
			const status = asText(row.status);
			const key = status === "active" ? "esfInstallActive" : status === "released" ? "esfInstallReleasedStatus" : "esfInstallStale";
			const color = status === "active" ? "var(--success)" : status === "released" ? "var(--text-muted)" : "var(--warning)";
			return <span style={{ color, fontWeight: 600 }}>{translate(key)}</span>;
		}
		if (col.identifier === "__release") {
			if (row.releasedAt) return <span style={{ color: "var(--text-muted)" }}>—</span>;
			return <Button size="sm" variant="secondary" onClick={() => void release(row)}>{translate("esfInstallRelease")}</Button>;
		}
		return undefined;
	}, [release]);

	const tableProps = useMemo(
		() => readonlyTableProps({ componentName: INSTALLS_COMPONENT, rows, columns, setColumns, isLoading, refetch: () => void load(), renderCell }),
		[rows, columns, isLoading, load, renderCell],
	);

	// Итог по лимиту: цифры видны админу даже когда отказ выключен (учёт без блокировки).
	const overLimit = summary.limit > 0 && summary.activeCount > summary.limit;
	return (
		<div className={styles.FormWrapper}>
			<div style={{ padding: "4px 8px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
				<span>
					{translate("esfInstallsActive")}: <b style={{ color: overLimit ? "var(--danger)" : undefined }}>{summary.activeCount}</b>
					{summary.limit > 0 ? ` / ${summary.limit}` : ""}
				</span>
				{overLimit && <span style={{ color: "var(--danger)" }}>{translate("esfInstallLimitExceeded")}</span>}
				{!summary.enforced && <span style={{ color: "var(--text-muted)" }}>{translate("esfInstallLimitCountOnly")}</span>}
			</div>
			<Table {...(tableProps as unknown as TableProps)} />
			<ConfirmModal {...confirmState} />
		</div>
	);
};
InstallsPanel.displayName = "EsfLicenseInstallsPanel";

// ═══════════════════════════════════════════════════════════════════════════
// ЖУРНАЛ ОБРАЩЕНИЙ (S-06): кто и когда получал токен, кому отказали, отзывы
// ═══════════════════════════════════════════════════════════════════════════

const LOGS_COMPONENT = "EsfLicenseLogs_part";

// Цвет результата: выдан/ок — норма, отказ/отзыв — внимание.
const RESULT_COLORS: Record<string, string> = {
	issued: "var(--success)",
	ok: "var(--success)",
	denied: "var(--danger)",
	invalid: "var(--danger)",
	revoked: "var(--warning)",
	error: "var(--danger)",
};

const LogPanel: FC<PanelProps> = ({ licenseUuid }) => {
	const [rows, setRows] = useState<TDataItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(logsColumnsJson as TColumn[], LOGS_COMPONENT, "part"));

	const load = useCallback(async () => {
		if (!licenseUuid) { setRows([]); return; }
		setIsLoading(true);
		try {
			const res = await apiClient.get<{ items?: TDataItem[] }>(`/${MODEL_ENDPOINT}/${licenseUuid}/logs?limit=200`);
			setRows(res.data?.items ?? []);
		} catch {
			showToast(translate("esfLoadError"), "error");
		} finally {
			setIsLoading(false);
		}
	}, [licenseUuid]);

	useEffect(() => { void load(); }, [load]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		if (col.identifier === "result") {
			const result = asText(row.result);
			return <span style={{ color: RESULT_COLORS[result] ?? undefined, fontWeight: 600 }}>{translate(`esfLogResult_${result}`)}</span>;
		}
		if (col.identifier === "reason") {
			const reason = asText(row.reason);
			return reason ? <span>{translate(`esfLogReason_${reason}`)}</span> : <span style={{ color: "var(--text-muted)" }}>—</span>;
		}
		return undefined;
	}, []);

	const tableProps = useMemo(
		() => readonlyTableProps({ componentName: LOGS_COMPONENT, rows, columns, setColumns, isLoading, refetch: () => void load(), renderCell }),
		[rows, columns, isLoading, load, renderCell],
	);

	return (
		<div className={styles.FormWrapper}>
			<Table {...(tableProps as unknown as TableProps)} />
		</div>
	);
};
LogPanel.displayName = "EsfLicenseLogPanel";

export { InstallsPanel, LogPanel };
