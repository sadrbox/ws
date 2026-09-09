/**
 * Карточка «Пользователь базы» — отдельный пейн, открывается двойным щелчком по строке.
 *
 * ЦЕНТРАЛЬНЫЙ ОБЪЕКТ — пара «человек + база». Один и тот же человек в разных базах имеет
 * разные права, и карточка, притворяющаяся общей, врала бы: показывала бы одни роли, а
 * меняла другие. Поэтому база выбирается прямо в шапке, и всё содержимое следует за ней.
 *
 * ПРАВА ПРАВЯТСЯ ОТМЕТКАМИ, А ПИШУТСЯ РАЗНИЦЕЙ. В таблице прав отметка означает «роль
 * есть»; при записи уходит только то, что ИЗМЕНИЛИ (addRoles/removeRoles). Неотмеченное,
 * которого и не было, не пишется вовсе: иначе команда трогала бы то, чего её не просили,
 * и на сотне баз это разошлось бы с ожиданиями молча.
 *
 * РАСКРЫТИЕ СТРОКИ ПРАВА даёт второй разрез той же картины: щёлкнули роль — увидели все
 * базы человека и где она есть. Правку в этих строках делать можно: она копится тем же
 * черновиком, что и отметки на текущей базе.
 */
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import ModelForm from "src/components/ModelForm";
import Table from "src/components/Table";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBaseUsersCached, fetchRoles, fetchUserOccurrences, runBatch,
} from "src/services/onec/api";
import { QueryError } from "./shared";
import styles from "./OneCAdmin.module.scss";

const rightsColumns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "320px", minWidth: "180px", alignment: "left", visible: true, inlist: true },
	{ identifier: "hereLabel", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "inBases", type: "string", width: "140px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const basesColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "baseName", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesCount", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "seenAt", type: "string", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Черновик: роль → должна ли она быть в базе. Только изменённое попадёт в команду. */
type Draft = Map<string, boolean>;
const draftKey = (baseKey: string, role: string) => `${baseKey.toLowerCase()}|${role}`;

export const BaseUserForm: FC<Partial<TPane>> = (paneProps) => {
	const row = (paneProps.data ?? {}) as TDataItem;
	const userName = asText(row.userName) || asText(row.name);
	const qc = useQueryClient();
	const { addPane } = useAppContext().windows;

	const [baseKey, setBaseKey] = useState(asText(row.baseKey));
	const [draft, setDraft] = useState<Draft>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [form, setForm] = useState({ fullName: "", password: "", disabled: false, showInList: true });

	// Где заведён и с какими ролями — из кэша реестра, без обращения к 1С.
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", userName],
		queryFn: () => fetchUserOccurrences(userName),
		enabled: !!userName,
	});
	// Пользователи выбранной базы: из них берём реквизиты именно в этой базе.
	const baseUsers = useQuery({
		queryKey: ["onec", "base-users-cached", baseKey],
		queryFn: () => fetchBaseUsersCached(baseKey),
		enabled: !!baseKey,
	});
	const roles = useQuery({ queryKey: ["onec", "roles", ""], queryFn: () => fetchRoles(), staleTime: 5 * 60_000 });

	const occ = occurrences.data?.items ?? [];
	const here = useMemo(
		() => (baseUsers.data?.items ?? []).find((u) => u.name.toLowerCase() === userName.toLowerCase()) ?? null,
		[baseUsers.data, userName],
	);

	// Реквизиты следуют за выбранной базой: в другой базе у человека своё полное имя.
	useEffect(() => {
		setForm({ fullName: "", password: "", disabled: here?.disabled ?? false, showInList: true });
	}, [here]);

	const rolesByBase = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const o of occ) m.set(o.baseKey.toLowerCase(), o.roles ?? []);
		return m;
	}, [occ]);

	/** Есть ли роль в базе с учётом черновика. */
	const isOn = useCallback((base: string, role: string) => {
		const d = draft.get(draftKey(base, role));
		return d ?? (rolesByBase.get(base.toLowerCase()) ?? []).includes(role);
	}, [draft, rolesByBase]);

	const toggle = useCallback((base: string, role: string) => {
		setDraft((prev) => {
			const next = new Map(prev);
			const was = (rolesByBase.get(base.toLowerCase()) ?? []).includes(role);
			const now = !isOn(base, role);
			// Вернули как было — строка из черновика уходит: писать «изменение», равное
			// исходному, значит трогать базу зря.
			if (now === was) next.delete(draftKey(base, role));
			else next.set(draftKey(base, role), now);
			return next;
		});
	}, [rolesByBase, isOn]);

	// ── Права: строки = роли, раскрытие = базы ──────────────────────────────
	const allRoles = useMemo(() => {
		const own = [...new Set(occ.flatMap((o) => o.roles ?? []))];
		const known = (roles.data?.items ?? []).map((r) => r.name);
		return [...new Set([...own, ...known])].sort((a, b) => a.localeCompare(b, "ru"));
	}, [occ, roles.data]);

	const [rightsCols, setRightsCols] = useState<TColumn[]>(() => getModelColumns(rightsColumns(), "OneCAdmin_bufRights"));
	const rightsRows = useMemo(() => allRoles.map((role, i) => ({
		id: i + 1, uuid: role, role,
		hereLabel: baseKey ? (isOn(baseKey, role) ? translate("yes") : translate("no")) : "—",
		inBases: `${occ.filter((o) => isOn(o.baseKey, role)).length} / ${occ.length}`,
	})), [allRoles, baseKey, occ, isOn]);
	const rightsView = useStaticTableView(rightsRows, { role: "asc" });

	const [basesCols, setBasesCols] = useState<TColumn[]>(() => getModelColumns(basesColumns(), "OneCAdmin_bufBases"));
	const basesRows = useMemo(() => occ.map((o, i) => ({
		id: i + 1, uuid: o.baseKey, baseKey: o.baseKey, baseName: o.baseName || "—",
		rolesCount: (o.roles ?? []).length, seenAt: o.seenAt ? getFormatDate(o.seenAt) : "—",
	})), [occ]);
	const basesView = useStaticTableView(basesRows, { baseKey: "asc" });

	// ── Запись: только изменённое, по каждой затронутой базе ────────────────
	const changedByBase = useMemo(() => {
		const m = new Map<string, { add: string[]; remove: string[] }>();
		for (const [key, value] of draft) {
			const [base, role] = key.split("|");
			const real = occ.find((o) => o.baseKey.toLowerCase() === base);
			const target = real?.baseKey ?? base;
			const entry = m.get(target) ?? { add: [], remove: [] };
			(value ? entry.add : entry.remove).push(role);
			m.set(target, entry);
		}
		return m;
	}, [draft, occ]);

	const dirtyProfile = !!form.fullName.trim() || !!form.password
		|| form.disabled !== (here?.disabled ?? false);

	const save = useMutation({
		mutationFn: async () => {
			const results = [];
			// Реквизиты пишутся только в ТЕКУЩУЮ базу: карточка про пару «человек + база».
			if (dirtyProfile && baseKey) {
				results.push(await runBatch("IB_UPDATE_USER", [baseKey], {
					name: userName,
					...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
					...(form.password ? { password: form.password } : {}),
					disabled: form.disabled,
					showInList: form.showInList,
				}));
			}
			for (const [base, { add, remove }] of changedByBase) {
				results.push(await runBatch("IB_UPDATE_USER", [base], {
					name: userName,
					...(add.length ? { addRoles: add } : {}),
					...(remove.length ? { removeRoles: remove } : {}),
				}));
			}
			return results;
		},
		onSuccess: (r) => {
			showToast(`${translate("onecBatchQueued")}: ${r.length}`, "success");
			setDraft(new Map());
			void qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
			void qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const openBase = useCallback((r: Partial<TDataItem>) => addPane({
		label: `${translate("onecBaseUserCard")}: ${userName} — ${asText(r.baseKey)}`,
		component: BaseUserForm as never,
		data: { userName, baseKey: asText(r.baseKey) } as unknown as TDataItem,
	}), [addPane, userName]);

	const changedCount = draft.size + (dirtyProfile ? 1 : 0);

	return (
		<ModelForm
			paneId={paneProps.uniqId}
			readonly
			isLoading={occurrences.isLoading}
			onSave={() => save.mutate()} onSaveAndClose={() => save.mutate()} onClose={() => {}}
			tabs={[
				{
					id: "main", label: translate("general"),
					component: (
						<GroupCol>
							<QueryError error={occurrences.error ?? baseUsers.error} />
							{/* Шапка: база — не реквизит, а ОБЛАСТЬ ДЕЙСТВИЯ карточки. */}
							<GroupRow>
								<FieldSelect name="buf_base" label={translate("onecBase")} value={baseKey}
									onChange={(e) => setBaseKey(e.target.value)}
									options={occ.map((o) => ({ value: o.baseKey, label: `${o.baseKey} — ${o.baseName || "—"}` }))} />
								<Field name="buf_user" label={translate("onecUserName")} value={userName} disabled width="220px" onChange={() => {}} />
								<Field name="buf_seen" label={translate("onecDataFrom")}
									value={occ.find((o) => o.baseKey === baseKey)?.seenAt
										? getFormatDate(occ.find((o) => o.baseKey === baseKey)!.seenAt) : "—"}
									disabled width="170px" onChange={() => {}} />
							</GroupRow>
							<GroupRow>
								<Field name="buf_full" label={translate("onecUserFullName")} value={form.fullName} width="240px"
									autoComplete="off" placeholder={here?.fullName || translate("onecKeepAsIs")}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
								<Field name="buf_pwd" label={translate("onecUserPassword")} type="password" value={form.password}
									width="190px" autoComplete="new-password" placeholder={translate("onecKeepAsIs")}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))} />
								<FieldToggle name="buf_show" label={translate("onecShowInList")} value={form.showInList}
									onChange={(v) => setForm((f) => ({ ...f, showInList: v }))} />
								<FieldToggle name="buf_disabled" label={translate("onecUserDisabled")} value={form.disabled}
									onChange={(v) => setForm((f) => ({ ...f, disabled: v }))} />
							</GroupRow>
							{!baseKey && <Notice items={[{ type: "info", text: translate("onecPickBaseInHeader") }]} />}
							{changedCount > 0 && (
								<Notice items={[{ type: "info", text: `${translate("onecUnsavedChanges")}: ${changedCount}` }]} />
							)}
						</GroupCol>
					),
				},
				{
					id: "rights", label: translate("onecTabRights"),
					component: (
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_bufRights", rows: rightsView.rows, columns: rightsCols,
							setColumns: setRightsCols, sorting: rightsView.sorting, search: rightsView.search,
							isLoading: occurrences.isLoading,
							onReload: () => void occurrences.refetch(),
							// Одиночный клик раскрывает роль базами — второй разрез той же картины.
							onActiveRowChange: (r) => setExpanded(r ? new Set([asText(r.uuid)]) : new Set()),
							expandedRowIds: expanded,
							renderExpandedRow: (r) => {
								const role = asText(r.role);
								return (
									<div className={styles.SubRows}>
										{occ.map((o) => (
											<label key={o.baseKey} className={styles.SubRow}>
												<input type="checkbox" checked={isOn(o.baseKey, role)}
													onChange={() => toggle(o.baseKey, role)} />
												<span className={styles.SubRowBase}>{o.baseKey}</span>
												<span className={styles.Hint}>{o.baseName || "—"}</span>
												{draft.has(draftKey(o.baseKey, role)) && (
													<span className={styles.PlanAdd}>{translate("onecChanged")}</span>
												)}
											</label>
										))}
										{!occ.length && <span className={styles.Hint}>{translate("onecUserNeverRead")}</span>}
									</div>
								);
							},
							renderCell: (r, col) => {
								// Отметка «право в текущей базе» — прямо в строке, без раскрытия.
								if (col.identifier === "hereLabel" && baseKey) {
									const role = asText(r.role);
									return (
										<input type="checkbox" checked={isOn(baseKey, role)}
											onChange={() => toggle(baseKey, role)} />
									);
								}
								return undefined;
							},
							extraButtons: (
								<>
									<span className={styles.Hint}>
										{changedCount ? `${translate("onecUnsavedChanges")}: ${changedCount}` : translate("onecNoChanges")}
									</span>
									<Button variant="secondary" disabled={!draft.size}
										title={draft.size ? translate("onecResetDraft") : translate("onecNoChanges")}
										onClick={() => setDraft(new Map())}>
										{translate("onecResetDraft")}
									</Button>
									<Button variant="primary" disabled={!changedCount || save.isPending}
										title={changedCount ? translate("apply") : translate("onecNothingToApply")}
										onClick={() => save.mutate()}>
										{translate("apply")}
									</Button>
								</>
							),
						})} />
					),
				},
				{
					id: "bases", label: translate("onecTabBases"),
					component: (
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_bufBases", rows: basesView.rows, columns: basesCols,
							setColumns: setBasesCols, sorting: basesView.sorting, search: basesView.search,
							isLoading: occurrences.isLoading,
							onReload: () => void occurrences.refetch(),
							// Двойной щелчок — карточка того же человека в другой базе.
							onRowClick: openBase,
							extraButtons: <span className={styles.Hint}>{translate("onecOpenInOtherBase")}</span>,
						})} />
					),
				},
			]}
		/>
	);
};
BaseUserForm.displayName = "BaseUserForm";

/** Открыть карточку «Пользователь базы» отдельным пейном. */
export function useOpenBaseUser() {
	const { addPane } = useAppContext().windows;
	return (userName: string, baseKey: string) => addPane({
		label: `${translate("onecBaseUserCard")}: ${userName}${baseKey ? ` — ${baseKey}` : ""}`,
		component: BaseUserForm as never,
		data: { userName, baseKey } as unknown as TDataItem,
	});
}

export default BaseUserForm;
