/**
 * Вкладка «Пользователи баз» (E15/A3, A4): реквизиты, роли и базы одного человека —
 * на одном экране, командами из панелей таблиц.
 *
 * ПОЧЕМУ ТАК. Прежний экран задавал режим («добавить / убрать / заменить») сразу на весь
 * набор ролей, и что именно произойдёт с каждой ролью, приходилось держать в голове.
 * Теперь роль — строка таблицы со своим действием: оставить, назначить, снять. Решение
 * принимается по строке и видно целиком.
 *
 * ЧТО ЧЕМ СОБРАНО (только штатные компоненты):
 *   • списки со множественным выбором — `Table` с отметками строк; все команды живут в её
 *     командной панели, кнопок внутри строк нет;
 *   • роли — `SubTable` с правкой в строках и штатными «Добавить»/«Удалить» её панели;
 *   • реквизиты — `Field`/`FieldToggle` в `GroupRow`/`GroupCol`;
 *   • предупреждения формы — `Notice`, итоги операций — `UIToast`.
 *
 * ЗАЩИТЫ. База, где снятие «ПолныеПрава» оставит её без единого администратора,
 * исключается из операции и названа в предпросмотре. Служебные пользователи платформы
 * не удаляются и не отключаются. Ничего не уходит в 1С, пока не нажата команда.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import SubTable from "src/components/SubTable";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBases, fetchRoleHolders, fetchRoles, fetchUserOccurrences, fetchUserSummary,
	runBatch, type BatchType,
} from "src/services/onec/api";
import { CapabilityGuard, QueryError, isApplicable } from "./shared";
import styles from "./OneCAdmin.module.scss";

/** Роль, снятие которой способно оставить базу без администратора. */
const ADMIN_ROLE = "ПолныеПрава";

/** Пользователи платформы: их не удаляют и не отключают — на них держатся задания базы. */
const SYSTEM_USERS = ["ОтправкаСерверныхОповещений", "СлужебныйПользовательДляОбновленияПредставлений"];
const isSystemUser = (name: string) => SYSTEM_USERS.some((s) => s.toLowerCase() === name.toLowerCase());

const userColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "bases", type: "number", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
	{ identifier: "disabled", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "presence", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "300px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Роли: строка = роль + что с ней сделать. Правится в самой таблице. */
const roleColumns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "300px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
	{ identifier: "act", type: "string", width: "160px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "inBases", type: "string", width: "150px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

type RoleAct = "keep" | "grant" | "revoke";

export const UsersTab: FC<{ onBatchStarted: (id: string) => void }> = ({ onBatchStarted }) => {
	const qc = useQueryClient();

	// Отметки строк — единственный способ выбрать цель: команды живут в панелях таблиц.
	const [pickedUsers, setPickedUsers] = useState<string[]>([]);
	const [pickedBases, setPickedBases] = useState<string[]>([]);
	const [roleRows, setRoleRows] = useState<TDataItem[]>([]);
	const [dialog, setDialog] = useState<null | "apply" | "delete" | "create">(null);

	// Реквизиты. Пустое поле означает «не трогать» — это же правило у команды изменения.
	const [form, setForm] = useState({ name: "", fullName: "", password: "", disabled: false, showInList: true });

	const summary = useQuery({ queryKey: ["onec", "user-summary"], queryFn: fetchUserSummary });
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const roles = useQuery({ queryKey: ["onec", "roles", ""], queryFn: () => fetchRoles(), staleTime: 5 * 60_000 });
	const holders = useQuery({ queryKey: ["onec", "role-holders", ADMIN_ROLE], queryFn: () => fetchRoleHolders(ADMIN_ROLE) });

	/** Карточку показываем для ПЕРВОГО отмеченного: остальные — цели той же команды. */
	const current = pickedUsers[0] ?? "";
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", current],
		queryFn: () => fetchUserOccurrences(current),
		enabled: !!current,
	});

	const [userCols, setUserCols] = useState<TColumn[]>(() => getModelColumns(userColumns(), "OneCAdmin_userSummary"));
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_userBases"));

	// ── Список пользователей ────────────────────────────────────────────────
	const userRows = useMemo(() => (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, bases: x.bases, disabled: x.disabled,
	})), [summary.data]);
	const userView = useStaticTableView(userRows, { name: "asc" });

	// ── Базы: где пользователь есть и какие у него там роли ─────────────────
	const occByBase = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const o of occurrences.data?.items ?? []) m.set(o.baseKey.toLowerCase(), o.roles ?? []);
		return m;
	}, [occurrences.data]);

	const adminsByBase = useMemo(() => {
		const m = new Map<string, number>();
		for (const h of holders.data?.items ?? []) m.set(h.baseKey.toLowerCase(), h.users);
		return m;
	}, [holders.data]);

	const baseRows = useMemo(() => (bases.data?.items ?? [])
		.filter((b) => isApplicable(b, "ib"))
		.map((b, i) => {
			const has = occByBase.get(b.key.toLowerCase());
			return {
				id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
				presence: has ? translate("onecPresent") : translate("onecAbsent"),
				rolesLabel: has?.length ? has.join(", ") : "—",
			};
		}), [bases.data, occByBase]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });

	// ── Роли: строки SubTable ───────────────────────────────────────────────
	const roleOptions = useMemo(() => {
		const known = (roles.data?.items ?? []).map((r) => r.name);
		const own = [...new Set([...occByBase.values()].flat())];
		return [...new Set([...own, ...known])].sort((a, b) => a.localeCompare(b, "ru"));
	}, [roles.data, occByBase]);

	/** Заполнить строки ролями, которые у человека уже есть в отмеченных базах. */
	const fillRoles = useCallback(() => {
		const src = pickedBases.length
			? pickedBases.flatMap((k) => occByBase.get(k.toLowerCase()) ?? [])
			: [...occByBase.values()].flat();
		const uniq = [...new Set(src)].sort((a, b) => a.localeCompare(b, "ru"));
		setRoleRows(uniq.map((role, i) => ({ id: i + 1, uuid: role, role, act: "keep" as RoleAct })));
	}, [pickedBases, occByBase]);

	/** Сколько отмеченных баз уже имеют эту роль — видно до применения. */
	const inBasesLabel = useCallback((role: string) => {
		if (!pickedBases.length) return "—";
		const n = pickedBases.filter((k) => (occByBase.get(k.toLowerCase()) ?? []).includes(role)).length;
		return `${n} / ${pickedBases.length}`;
	}, [pickedBases, occByBase]);

	// ── Что произойдёт ──────────────────────────────────────────────────────
	const plan = useMemo(() => pickedBases.map((key) => {
		const has = new Set(occByBase.get(key.toLowerCase()) ?? []);
		const add = roleRows.filter((r) => r.act === "grant" && !has.has(asText(r.role))).map((r) => asText(r.role));
		const del = roleRows.filter((r) => r.act === "revoke" && has.has(asText(r.role))).map((r) => asText(r.role));
		// Единственный администратор: снятие оставило бы базу без администратора вовсе.
		const lastAdmin = del.includes(ADMIN_ROLE) && (adminsByBase.get(key.toLowerCase()) ?? 0) <= 1;
		return { key, add, del, blocked: lastAdmin ? translate("onecLastAdminBlock") : null };
	}), [pickedBases, roleRows, occByBase, adminsByBase]);

	const targets = plan.filter((p) => !p.blocked && (p.add.length || p.del.length || form.fullName.trim() || form.password));
	const blocked = plan.filter((p) => p.blocked);

	// ── Команды ─────────────────────────────────────────────────────────────
	const batch = useMutation({
		mutationFn: (p: { type: BatchType; keys: string[]; payload: Record<string, unknown> }) =>
			runBatch(p.type, p.keys, p.payload),
		onSuccess: (d) => {
			setDialog(null);
			const skipped = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${skipped}`, d.skipped.length ? "warning" : "success");
			void qc.invalidateQueries({ queryKey: ["onec"] });
			onBatchStarted(d.batchId);
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const apply = useCallback(() => {
		if (!current || !targets.length) return;
		// Роли уходят полным набором «после изменения»: команда заменяет набор, поэтому
		// считаем его здесь — из того, что есть в базе, плюс назначенное, минус снятое.
		const keys = targets.map((t) => t.key);
		const grant = roleRows.filter((r) => r.act === "grant").map((r) => asText(r.role));
		const revoke = new Set(roleRows.filter((r) => r.act === "revoke").map((r) => asText(r.role)));
		const first = occByBase.get(keys[0].toLowerCase()) ?? [];
		const nextRoles = [...new Set([...first.filter((r) => !revoke.has(r)), ...grant])];

		batch.mutate({
			type: "IB_UPDATE_USER", keys,
			payload: {
				name: current,
				...(form.name.trim() && form.name.trim() !== current ? { newName: form.name.trim() } : {}),
				...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
				...(form.password ? { password: form.password } : {}),
				...(grant.length || revoke.size ? { roles: nextRoles } : {}),
				disabled: form.disabled,
				showInList: form.showInList,
			},
		});
	}, [batch, current, targets, roleRows, occByBase, form]);

	const removeUser = useCallback(() => {
		if (!current || !pickedBases.length) return;
		batch.mutate({ type: "IB_DELETE_USER", keys: pickedBases, payload: { name: current } });
	}, [batch, current, pickedBases]);

	const createUser = useCallback(() => {
		if (!form.name.trim() || !pickedBases.length) return;
		batch.mutate({
			type: "IB_CREATE_USER", keys: pickedBases,
			payload: {
				name: form.name.trim(),
				...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
				...(form.password ? { password: form.password } : {}),
				...(roleRows.some((r) => r.act === "grant")
					? { roles: roleRows.filter((r) => r.act === "grant").map((r) => asText(r.role)) } : {}),
			},
		});
	}, [batch, form, pickedBases, roleRows]);

	const systemPicked = pickedUsers.some(isSystemUser);

	return (
		<>
			<CapabilityGuard capability="ib.admin" />

			<div className={styles.UsersLayout}>
				{/* ── Слева: кого меняем. Команды — в панели таблицы ───────────── */}
				<div className={styles.UsersList}>
					<QueryError error={summary.error} />
					<Table {...buildStaticTableProps({
						componentName: "OneCAdmin_userSummary", rows: userView.rows, columns: userCols,
						setColumns: setUserCols, sorting: userView.sorting, search: userView.search,
						isLoading: summary.isLoading,
						onReload: () => void summary.refetch(),
						selectable: true,
						onSelectionChange: (sel, all) => {
							const names = all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.name));
							setPickedUsers(names);
							// Реквизиты подставляем от первого отмеченного: он же в карточке.
							if (names[0]) setForm((f) => ({ ...f, name: names[0], fullName: "", password: "" }));
						},
						extraButtons: (
							<Button variant="secondary" disabled={!pickedBases.length}
								title={pickedBases.length ? undefined : translate("onecPickBasesFirst")}
								onClick={() => { setForm({ name: "", fullName: "", password: "", disabled: false, showInList: true }); setDialog("create"); }}>
								{translate("onecUserCreateInBases")}
							</Button>
						),
					})} />
				</div>

				{/* ── Справа: карточка. Секции идут вплотную, без воздуха ──────── */}
				<div className={styles.UsersCard}>
					{!current ? (
						<Notice items={[{ type: "info", text: translate("onecPickUserFirst") }]} />
					) : (
						<>
							<div className={styles.SecHead}>
								{translate("onecUserCard")}: {current}
								{pickedUsers.length > 1 && ` · ${translate("onecBatchTargets")}: ${pickedUsers.length}`}
							</div>
							<div className={styles.SecBody}>
								{systemPicked && <Notice items={[{ type: "warning", text: translate("onecSystemUserWarn") }]} />}
								<GroupCol>
									<GroupRow>
										<Field name="ou_name" label={translate("onecUserName")} value={form.name} width="220px"
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} />
										<Field name="ou_full" label={translate("onecUserFullName")} value={form.fullName} width="220px"
											autoComplete="off" placeholder={translate("onecKeepAsIs")}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
										<Field name="ou_pwd" label={translate("onecUserPassword")} type="password" value={form.password}
											width="190px" autoComplete="new-password" placeholder={translate("onecKeepAsIs")}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))} />
									</GroupRow>
									<GroupRow>
										<FieldToggle name="ou_show" label={translate("onecShowInList")} value={form.showInList}
											onChange={(v) => setForm((f) => ({ ...f, showInList: v }))} />
										<FieldToggle name="ou_disabled" label={translate("onecUserDisabled")} value={form.disabled}
											onChange={(v) => setForm((f) => ({ ...f, disabled: v }))} />
									</GroupRow>
								</GroupCol>
							</div>

							{/* ── Роли: правка в строках, команды — в панели SubTable ── */}
							<div className={styles.SecHead}>{translate("roles")}</div>
							<SubTable
								model="onec-user-roles"
								componentName="OneCAdmin_userRoles"
								columnsJson={roleColumns()}
								parentKey="role"
								parentUuid=""
								deferRemoteChanges
								clientSort
								defaultInlineEditing
								showEditModeToggle={false}
								selectable
								hideReload
								initialPendingRows={roleRows}
								defaultNewRow={{ role: roleOptions[0] ?? "", act: "grant" }}
								onAllItemsChange={setRoleRows}
								emptyMessage={translate("onecRolesEmptyRows")}
								extraButtons={
									<Button variant="secondary" onClick={fillRoles} disabled={!occByBase.size}>
										{translate("onecRolesFillFromBases")}
									</Button>
								}
								renderCell={(row, col, ctx) => {
									if (col.identifier === "role") {
										return (
											<FieldSelect name={`role_${asText(row.id)}`} value={asText(row.role)} variant="table"
												options={roleOptions.map((r) => ({ value: r, label: r }))}
												onChange={(e) => void ctx.handleInlineChange(row, "role", e.target.value)} />
										);
									}
									if (col.identifier === "act") {
										return (
											<FieldSelect name={`act_${asText(row.id)}`} value={asText(row.act) || "keep"} variant="table"
												options={[
													{ value: "keep", label: translate("onecRoleKeep") },
													{ value: "grant", label: translate("onecRoleGrant") },
													{ value: "revoke", label: translate("onecRoleRevoke") },
												]}
												onChange={(e) => void ctx.handleInlineChange(row, "act", e.target.value)} />
										);
									}
									if (col.identifier === "inBases") return <span>{inBasesLabel(asText(row.role))}</span>;
									return undefined;
								}}
							/>

							{/* ── Базы: цель команды. Все действия — в её панели ────── */}
							<div className={styles.SecHead}>{translate("onecTabBases")}</div>
							<Table {...buildStaticTableProps({
								componentName: "OneCAdmin_userBases", rows: baseView.rows, columns: baseCols,
								setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
								isLoading: bases.isLoading,
								onReload: () => void bases.refetch(),
								selectable: true,
								onSelectionChange: (sel, all) =>
									setPickedBases(all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey))),
								extraButtons: (
									<>
										<Button variant="primary" disabled={!targets.length} onClick={() => setDialog("apply")}>
											{translate("apply")}
										</Button>
										<Button variant="danger" disabled={!pickedBases.length || systemPicked}
											title={systemPicked ? translate("onecSystemUserWarn") : undefined}
											onClick={() => setDialog("delete")}>
											{translate("onecUserDelete")}
										</Button>
									</>
								),
							})} />

							{/* ── Что произойдёт ───────────────────────────────────── */}
							<div className={styles.SecHead}>{translate("onecWhatHappens")}</div>
							<div className={styles.SecBody}>
								{!pickedBases.length && <Notice items={[{ type: "info", text: translate("onecPickBasesFirst") }]} />}
								{blocked.length > 0 && (
									<Notice items={[{ type: "warning",
										text: `${translate("onecSkippedBases")}: ${blocked.map((b) => b.key).join(", ")} — ${translate("onecLastAdminBlock")}` }]} />
								)}
								{plan.filter((p) => !p.blocked).map((p) => (
									<div key={p.key} className={styles.PlanRow}>
										<span className={styles.PlanBase}>{p.key}</span>
										{p.add.length > 0 && <span className={styles.PlanAdd}>+ {p.add.join(", ")}</span>}
										{p.del.length > 0 && <span className={styles.PlanDel}>− {p.del.join(", ")}</span>}
										{!p.add.length && !p.del.length && <span className={styles.Hint}>{translate("onecNoChanges")}</span>}
									</div>
								))}
							</div>
						</>
					)}
				</div>
			</div>

			{dialog && (
				<Modal
					title={dialog === "delete" ? translate("onecUserDelete")
						: dialog === "create" ? translate("onecUserCreateInBases") : translate("apply")}
					onClose={() => setDialog(null)}
					onApply={dialog === "delete" ? removeUser : dialog === "create" ? createUser : apply}
				>
					<div className={styles.ModalForm}>
						<div>{translate("onecUserName")}: {dialog === "create" ? form.name : current}</div>
						<div>{translate("onecBatchTargets")}: {dialog === "apply" ? targets.length : pickedBases.length}</div>
						<div className={styles.ConfirmWarning}>
							{dialog === "delete" ? translate("onecUserDeleteWarning")
								: dialog === "create" ? translate("onecUserCreateWarning") : translate("onecUserUpdateWarning")}
						</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default UsersTab;
