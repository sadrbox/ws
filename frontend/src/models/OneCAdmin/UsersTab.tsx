/**
 * Вкладка «Пользователи» (E15/A3-P1 + A4): пользователи ИБ по базам, групповое
 * создание и удаление, и ответ на вопрос «в каких базах есть этот человек».
 *
 * СЛЕВА ЭЛЕМЕНТ, СПРАВА БАЗЫ — как и во вкладке «Расширения». Главное здесь — человек, а
 * не база: щелчок по строке сводки оставляет справа только те базы, где он заведён.
 * Обратный порядок (слева базы) заставлял открывать базы по одной, чтобы понять, в каких
 * из них человек вообще есть.
 *
 * СВОДКА ЧИТАЕТСЯ ИЗ КЭША. Спрашивать сто баз на каждый показ — это сто подключений
 * и минуты ожидания, поэтому список пользователей базы, однажды прочитанный, оседает
 * в реестре сервиса. Кнопка «Проверить пользователей» — единственное, что идёт в 1С.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchBaseUsers, fetchUserOccurrences, fetchUserSummary, runBatch, type BatchType } from "src/services/onec/api";
import { CapabilityGuard, QueryError, VSplit, checkBases, useBaseTargets, useCheckParallel } from "./shared";
import ElementCard from "./ElementCard";
import styles from "./OneCAdmin.module.scss";


const baseUserColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fullName", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "disabledLabel", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "280px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Сводка по пользователям: в скольких базах заведён и где отключён. */
const summaryColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "bases", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "disabled", type: "number", width: "140px", minWidth: "90px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

export const UsersTab: FC<{ onBatchStarted: (id: string) => void }> = ({ onBatchStarted }) => {
	const qc = useQueryClient();
	const [openedBase, setOpenedBase] = useState("");
	const [checking, setChecking] = useState(false);
	const parallel = useCheckParallel();
	/** Выбранный в сводке пользователь: справа остаются только базы, где он заведён. */
	const [pickedUser, setPickedUser] = useState("");
	const [dialog, setDialog] = useState<null | "create" | "delete">(null);
	/** Карточка пользователя: реквизиты + базы, куда его завести. */
	const [card, setCard] = useState(false);
	const [form, setForm] = useState({ name: "", fullName: "", password: "" });

	const baseUsers = useQuery({
		queryKey: ["onec", "base-users", openedBase],
		queryFn: () => fetchBaseUsers(openedBase),
		enabled: !!openedBase, staleTime: 0,
	});
	// Сводка и «где заведён» читаются из кэша реестра: в 1С за ними никто не ходит.
	const summary = useQuery({ queryKey: ["onec", "user-summary"], queryFn: fetchUserSummary });
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", pickedUser],
		queryFn: () => fetchUserOccurrences(pickedUser),
		enabled: !!pickedUser,
	});

	const [sumColumns, setSumColumns] = useState<TColumn[]>(() => getModelColumns(summaryColumns(), "OneCAdmin_userSummary"));
	const [baseColumns, setBaseColumns] = useState<TColumn[]>(() => getModelColumns(baseUserColumns(), "OneCAdmin_baseUsers"));

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
		const r = await checkBases(keys, fetchBaseUsers, parallel);
		setChecking(false);
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${keys.length}. ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}`,
			r.failed.length ? "warning" : "success",
		);
	}, [qc, parallel]);

	/** Базы выбранного пользователя — по кэшу «где заведён». */
	const userBases = useMemo(
		() => new Set((occurrences.data?.items ?? []).map((o) => o.baseKey.toLowerCase())),
		[occurrences.data],
	);
	const userFilter = useCallback((b: { key: string }) => !pickedUser || userBases.has(b.key.toLowerCase()),
		[pickedUser, userBases]);

	const targets = useBaseTargets({
		componentName: "OneCAdmin_userTargets",
		onOpenBase: setOpenedBase,
		filter: userFilter,
		// Пользователей заводят внутри базы: пропавшая база команду не примет.
		applicableFor: "ib",
		extraButtons: (selected) => (
			<>
				{pickedUser && (
					<Button variant="secondary" onClick={() => setPickedUser("")}>{translate("onecExtAllBases")}</Button>
				)}
				<Button variant="secondary" disabled={!selected.length || checking}
					onClick={() => void checkSelected(selected)}>
					{translate("onecUsersCheck")}
				</Button>
				<Button variant="secondary" disabled={!selected.length}
					onClick={() => { setForm({ name: "", fullName: "", password: "" }); setDialog("create"); }}>
					{translate("onecUserCreate")}
				</Button>
				<Button variant="secondary" disabled={!selected.length}
					onClick={() => { setForm({ name: "", fullName: "", password: "" }); setDialog("delete"); }}>
					{translate("onecUserDelete")}
				</Button>
			</>
		),
	});


	const sumRows = (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, bases: x.bases, disabled: x.disabled,
	}));
	const sumView = useStaticTableView(sumRows, { name: "asc" });

	const baseRows = (baseUsers.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, fullName: x.fullName || "—",
		disabledLabel: x.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
		rolesLabel: (x.roles ?? []).join(", ") || "—",
	}));
	const baseSorted = useStaticTableView(baseRows, { name: "asc" });

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


	return (
		<>
			<CapabilityGuard capability="ib.admin" />
			<VSplit
				storageKey="users"
				main={
					<>
						<QueryError error={summary.error} />
						{/* Сводка по кэшу: сколько баз знают этого пользователя и где он отключён.
						    Щелчок по строке оставляет справа только его базы. */}
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_userSummary", rows: sumView.rows, columns: sumColumns,
							setColumns: setSumColumns, sorting: sumView.sorting, search: sumView.search,
							isLoading: summary.isLoading,
							onReload: () => void summary.refetch(),
							onRowClick: (row) => { setOpenedBase(""); setPickedUser(asText(row.name)); },
							extraButtons: (
								<>
									<Button variant="secondary" onClick={() => setCard(true)}>{translate("onecOpenCard")}</Button>
									{pickedUser && (
										<Button variant="secondary" onClick={() => setPickedUser("")}>{translate("onecExtAllBases")}</Button>
									)}
								</>
							),
						})} />
					</>
				}
				side={
					openedBase ? (
						<>
							<QueryError error={baseUsers.error} />
							<Table {...buildStaticTableProps({
								componentName: "OneCAdmin_baseUsers", rows: baseSorted.rows, columns: baseColumns,
								setColumns: setBaseColumns, sorting: baseSorted.sorting, search: baseSorted.search,
								isLoading: baseUsers.isLoading || baseUsers.isFetching,
								onReload: () => void baseUsers.refetch(),
								extraButtons: <Button variant="secondary" onClick={() => setOpenedBase("")}>{translate("onecBackToSummary")}</Button>,
							})} />
						</>
					) : (
						<>
							<QueryError error={occurrences.error} />
							{targets.table}
						</>
					)
				}
			/>

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
								<Field name="onec_user_full" autoComplete="off" label={translate("onecUserFullName")} value={form.fullName}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
								<Field name="onec_user_pwd" autoComplete="new-password" label={translate("onecUserPassword")} type="password" value={form.password}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))} />
							</>
						)}
						<div className={styles.ConfirmWarning}>
							{dialog === "create" ? translate("onecUserCreateWarning") : translate("onecUserDeleteWarning")}
						</div>
					</div>
				</Modal>
			)}
			{card && (
				<ElementCard
					kind="user"
					initialName={pickedUser}
					presentIn={(occurrences.data?.items ?? []).map((o) => o.baseKey)}
					onClose={() => setCard(false)}
					onBatchStarted={onBatchStarted}
				/>
			)}
		</>
	);
};

export default UsersTab;
