/**
 * Вкладка «Пользователи» (E15/A3-P1 + A4): пользователи ИБ по базам, групповое
 * создание и удаление, и ответ на вопрос «в каких базах есть этот человек».
 *
 * СВОДКА ЧИТАЕТСЯ ИЗ КЭША. Спрашивать сто баз на каждый показ — это сто подключений
 * и минуты ожидания, поэтому список пользователей базы, однажды прочитанный, оседает
 * в реестре сервиса. Рядом всегда видно, когда его последний раз видели: источник
 * истины — сама 1С, а не наш кэш.
 */
import { FC, useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { fetchBaseUsers, fetchUserOccurrences, fetchUserSummary, runBatch, type BatchType } from "src/services/onec/api";
import { CapabilityGuard, QueryError, SectionTitle, checkBases, useBaseTargets } from "./shared";
import styles from "./OneCAdmin.module.scss";

const summaryColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "260px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "basesCount", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "disabledCount", type: "number", width: "140px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const baseUserColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fullName", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "disabledLabel", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "280px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const occurrenceColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "baseName", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fullName", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "disabledLabel", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "seenAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const UsersTab: FC<{ onBatchStarted: (id: string) => void }> = ({ onBatchStarted }) => {
	const qc = useQueryClient();
	const [openedBase, setOpenedBase] = useState("");
	const [checking, setChecking] = useState(false);
	const [lookupName, setLookupName] = useState("");
	const [dialog, setDialog] = useState<null | "create" | "delete">(null);
	const [form, setForm] = useState({ name: "", fullName: "", password: "" });

	const summary = useQuery({ queryKey: ["onec", "user-summary"], queryFn: fetchUserSummary });
	const baseUsers = useQuery({
		queryKey: ["onec", "base-users", openedBase],
		queryFn: () => fetchBaseUsers(openedBase),
		enabled: !!openedBase, staleTime: 0,
	});
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", lookupName],
		queryFn: () => fetchUserOccurrences(lookupName),
		enabled: !!lookupName,
	});

	const [sumColumns, setSumColumns] = useState<TColumn[]>(() => getModelColumns(summaryColumns(), "OneCAdmin_userSummary"));
	const [baseColumns, setBaseColumns] = useState<TColumn[]>(() => getModelColumns(baseUserColumns(), "OneCAdmin_baseUsers"));
	const [occColumns, setOccColumns] = useState<TColumn[]>(() => getModelColumns(occurrenceColumns(), "OneCAdmin_userWhere"));

	const batch = useMutation({
		mutationFn: (p: { type: BatchType; keys: string[]; payload: Record<string, unknown> }) =>
			runBatch(p.type, p.keys, p.payload),
		onSuccess: (d) => {
			setDialog(null);
			const skipped = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${skipped}`, d.skipped.length ? "warning" : "success");
			onBatchStarted(d.batchId);
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	/** Чтение списка пользователей выбранных баз — прямыми запросами, без задания. */
	const checkSelected = useCallback(async (keys: string[]) => {
		setChecking(true);
		const r = await checkBases(keys, fetchBaseUsers);
		setChecking(false);
		await qc.invalidateQueries({ queryKey: ["onec", "user-summary"] });
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${keys.length}. ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}`,
			r.failed.length ? "warning" : "success",
		);
	}, [qc]);

	const targets = useBaseTargets({
		componentName: "OneCAdmin_userTargets",
		onOpenBase: setOpenedBase,
		extraButtons: (selected) => (
			<>
				<Button size="sm" disabled={!selected.length || checking}
					onClick={() => void checkSelected(selected)}>
					{translate("onecUsersCheck")}
				</Button>
				<Button size="sm" disabled={!selected.length}
					onClick={() => { setForm({ name: "", fullName: "", password: "" }); setDialog("create"); }}>
					{translate("onecUserCreate")}
				</Button>
				<Button size="sm" disabled={!selected.length}
					onClick={() => { setForm({ name: "", fullName: "", password: "" }); setDialog("delete"); }}>
					{translate("onecUserDelete")}
				</Button>
			</>
		),
	});

	const summaryRows = (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, basesCount: x.bases, disabledCount: x.disabled,
	}));
	const sumSorted = useStaticTableView(summaryRows, { name: "asc" });

	const baseRows = (baseUsers.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, fullName: x.fullName || "—",
		disabledLabel: x.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
		rolesLabel: (x.roles ?? []).join(", ") || "—",
	}));
	const baseSorted = useStaticTableView(baseRows, { name: "asc" });

	const occRowsRaw = (occurrences.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: `${x.baseKey}:${x.fullName}`, baseKey: x.baseKey,
		baseName: x.baseName || "—", fullName: x.fullName || "—",
		disabledLabel: x.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
		seenAt: x.seenAt,
	}));
	const occSorted = useStaticTableView(occRowsRaw, { baseKey: "asc" });
	const occRows = occSorted.rows.map((r) => ({ ...r, seenAt: r.seenAt ? getFormatDate(r.seenAt) : "—" }));

	const apply = useCallback(() => {
		const keys = targets.selectedKeys;
		if (!keys.length || !form.name.trim()) return;
		if (dialog === "delete") {
			batch.mutate({ type: "IB_DELETE_USER", keys, payload: { name: form.name.trim() } });
			return;
		}
		batch.mutate({
			type: "IB_CREATE_USER", keys,
			payload: {
				name: form.name.trim(),
				...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
				...(form.password ? { password: form.password } : {}),
			},
		});
	}, [batch, dialog, form, targets.selectedKeys]);

	/** Клик по имени в сводке — «покажи его во всех базах». */
	const lookup = useCallback((row: Partial<TDataItem>) => setLookupName(asText(row.name)), []);

	return (
		<>
			<CapabilityGuard capability="ib.admin" />
			<SectionTitle>{translate("onecUserTargetsHint")}</SectionTitle>
			{targets.table}

			<SectionTitle>
				{openedBase
					? `${translate("onecUsersOfBase")}: ${openedBase}`
					: lookupName
						? `${translate("onecUserWhere")}: ${lookupName}`
						: translate("onecUserSummary")}
			</SectionTitle>

			<QueryError error={openedBase ? baseUsers.error : lookupName ? occurrences.error : summary.error} />

			{openedBase ? (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_baseUsers", rows: baseSorted.rows, columns: baseColumns,
					setColumns: setBaseColumns, sorting: baseSorted.sorting, search: baseSorted.search,
					isLoading: baseUsers.isLoading || baseUsers.isFetching,
					onReload: () => void baseUsers.refetch(),
					extraButtons: <Button size="sm" onClick={() => setOpenedBase("")}>{translate("onecBackToSummary")}</Button>,
				})} />
			) : lookupName ? (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_userWhere", rows: occRows, columns: occColumns,
					setColumns: setOccColumns, sorting: occSorted.sorting, search: occSorted.search,
					isLoading: occurrences.isLoading,
					onReload: () => void occurrences.refetch(),
					extraButtons: <Button size="sm" onClick={() => setLookupName("")}>{translate("onecBackToSummary")}</Button>,
				})} />
			) : (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_userSummary", rows: sumSorted.rows, columns: sumColumns,
					setColumns: setSumColumns, sorting: sumSorted.sorting, search: sumSorted.search,
					isLoading: summary.isLoading, onReload: () => void summary.refetch(),
					onRowClick: lookup,
				})} />
			)}

			{dialog && (
				<Modal
					title={dialog === "create" ? translate("onecUserCreate") : translate("onecUserDelete")}
					onClose={() => setDialog(null)}
					onApply={apply}
				>
					<div className={styles.ModalForm}>
						<div>{translate("onecBatchTargets")}: {targets.selectedKeys.length}</div>
						<Field name="onec_user_name" label={translate("onecUserName")} value={form.name}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} />
						{dialog === "create" && (
							<>
								<Field name="onec_user_full" label={translate("onecUserFullName")} value={form.fullName}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
								<Field name="onec_user_pwd" label={translate("onecUserPassword")} type="password" value={form.password}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))} />
							</>
						)}
						<div className={styles.ConfirmWarning}>
							{dialog === "create" ? translate("onecUserCreateWarning") : translate("onecUserDeleteWarning")}
						</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default UsersTab;
