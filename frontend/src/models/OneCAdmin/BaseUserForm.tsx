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
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
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
	fetchBaseUsers, fetchBaseUsersCached, fetchRoles, fetchUserOccurrences, runBatch,
} from "src/services/onec/api";
import { formStoreAPI } from "src/hooks/useFormStore";
import { setPaneBusy, setPaneIsEditMode } from "src/hooks/paneFormState";
import { Icon } from "src/components/IconButton/icons";
import { QueryError } from "./shared";
import { attachBatch, finishOp, opBlocks, startOp, useBatchWatch, useOnecOps } from "./progress";

const rightsColumns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "320px", minWidth: "180px", alignment: "left", visible: true, inlist: true },
	{ identifier: "inBases", type: "string", width: "140px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "changedLabel", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
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
	const { addPane, requestClose } = useAppContext().windows;

	const [baseKey, setBaseKey] = useState(asText(row.baseKey));
	const [draft, setDraft] = useState<Draft>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [form, setForm] = useState({ fullName: "", password: "", disabled: false, showInList: true });

	// Где заведён и с какими ролями — из кэша реестра, без обращения к 1С.
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", userName],
		queryFn: () => fetchUserOccurrences(userName),
		enabled: !!userName.trim(),
	});
	// Пользователи выбранной базы: из них берём реквизиты именно в этой базе.
	const baseUsers = useQuery({
		queryKey: ["onec", "base-users-cached", baseKey],
		queryFn: () => fetchBaseUsersCached(baseKey),
		enabled: !!baseKey,
	});
	const roles = useQuery({ queryKey: ["onec", "roles", ""], queryFn: () => fetchRoles(), staleTime: 5 * 60_000 });

	/**
	 * ПОКА ПО ОБЪЕКТУ ИДЁТ ОПЕРАЦИЯ, КАРТОЧКА ТОЛЬКО ЧИТАЕТСЯ.
	 *
	 * Значения меняются прямо сейчас — в 1С или в кэше реестра. Форма, позволяющая править
	 * поверх, отправила бы команду по данным, которых уже нет: человек снял бы роль, которую
	 * выполняющаяся команда только что добавила, и результат зависел бы от того, кто успел
	 * раньше. Поэтому на время операции поля и отметки заблокированы, а когда она закончится,
	 * свежие значения приходят сами (useBatchWatch перечитывает реестр).
	 */
	// Хук ведёт опрос заданий: карточка может остаться единственным открытым пейном.
	useBatchWatch();
	const ops = useOnecOps();
	const busy = useMemo(
		() => ops.find((o) => opBlocks(o, userName, baseKey)) ?? null,
		[ops, userName, baseKey],
	);
	const locked = !!busy;

	// Спиннер на ⟳ в шапке панели: пока идёт операция по объекту карточки, кнопка
	// крутится и не принимает нажатие — свежих значений всё равно ещё нет.
	useEffect(() => {
		const uniqId = paneProps.uniqId;
		if (!uniqId) return;
		setPaneBusy(uniqId, locked);
		return () => setPaneBusy(uniqId, false);
	}, [paneProps.uniqId, locked]);

	/**
	 * Строки без `baseKey` отбрасываем.
	 *
	 * Панель падала на них при отрисовке: запрос с пустым именем попадал в сводку
	 * пользователей (Express не различает `/users` и `/users/`), а у её строк базы нет.
	 * Сервис теперь такой запрос отвергает, но верить форме чужого ответа вслепую
	 * всё равно нельзя — падение из-за одной кривой строки роняло весь пейн.
	 */
	const occ = useMemo(
		() => (occurrences.data?.items ?? []).filter((o) => typeof o?.baseKey === "string" && !!o.baseKey),
		[occurrences.data],
	);
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
		inBases: `${occ.filter((o) => isOn(o.baseKey, role)).length} / ${occ.length}`,
		changedLabel: baseKey && draft.has(draftKey(baseKey, role)) ? translate("onecChanged") : "",
	})), [allRoles, baseKey, occ, isOn, draft]);
	const rightsView = useStaticTableView(rightsRows, { role: "asc" });

	/**
	 * Отметки строк = «роль есть в выбранной базе».
	 *
	 * Галочка здесь — не выбор строк для команды, а СОСТОЯНИЕ данных, поэтому таблице она
	 * отдаётся готовой (presetSelectedRows), а снятие/установка возвращаются черновиком.
	 * Своя колонка с чекбоксом делала то же самое, но мимо клавиатуры и «отметить всё»,
	 * которые в таблице уже есть.
	 */
	const rightsSelected = useMemo(() => {
		const set = new Set<number>();
		if (!baseKey) return set;
		for (const r of rightsRows) if (isOn(baseKey, asText(r.role))) set.add(r.id);
		return set;
	}, [rightsRows, baseKey, isOn]);

	/**
	 * Раскрытие роли — СТРОКИ ТАБЛИЦЫ, а не врезка.
	 *
	 * Потомки рисуются тем же TableBodyRow и в тех же колонках: «Роль» показывает базу,
	 * «Есть в базах» — её название, «Изменение» — пометку правки. Отметка потомка живёт
	 * в его данных (`__selected`), переключение приходит обратно колбэком.
	 */
	const childRows = useCallback((r: TDataItem): TDataItem[] => {
		const role = asText(r.role);
		return occ.map((o, i) => ({
			// Отрицательные идентификаторы: пространство строк у потомков своё, и они не
			// должны совпасть с идентификаторами ролей (отметки/активная строка — по ним).
			id: -(i + 1), uuid: `${role}|${o.baseKey}`,
			role: o.baseKey,
			inBases: o.baseName || "—",
			changedLabel: draft.has(draftKey(o.baseKey, role)) ? translate("onecChanged") : "",
			__selected: isOn(o.baseKey, role),
			__role: role, __base: o.baseKey,
		}));
	}, [occ, draft, isOn]);

	const toggleChild = useCallback((child: TDataItem, next: boolean) => {
		const base = asText(child.__base);
		const role = asText(child.__role);
		if (!base || !role || next === isOn(base, role)) return;
		toggle(base, role);
	}, [isOn, toggle]);

	const applySelection = useCallback((selected: Set<number>, rows: TDataItem[]) => {
		if (!baseKey) return;
		setDraft((prev) => {
			const next = new Map(prev);
			const have = rolesByBase.get(baseKey.toLowerCase()) ?? [];
			for (const r of rows) {
				const role = asText(r.role);
				const want = selected.has(Number(r.id));
				// Совпало с тем, что в базе, — записи в черновике не место.
				if (want === have.includes(role)) next.delete(draftKey(baseKey, role));
				else next.set(draftKey(baseKey, role), want);
			}
			return next;
		});
	}, [baseKey, rolesByBase]);

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

	/**
	 * Постановка команды сразу попадает в реестр операций: запись прав на десятке баз
	 * идёт минутами, и человеку нужен не только тост «поставлено», но и место, где видно,
	 * чем это кончилось. Вкладка «Прогресс запросов и команд» читает тот же реестр.
	 */
	const enqueue = useCallback(async (title: string, target: string, bases: string[], payload: Record<string, unknown>) => {
		const op = startOp({
			kind: "update", title, target, total: bases.length,
			// Пока команда идёт, карточка этой пары только читается: значения меняются в 1С.
			scope: { user: userName, bases },
		});
		try {
			const r = await runBatch("IB_UPDATE_USER", bases, payload);
			attachBatch(op, r.batchId, r.total, r.skipped.length ? `${translate("onecSkipped")}: ${r.skipped.length}` : "");
			return r;
		} catch (e) {
			// Команда даже не встала в очередь: без этого запись осталась бы «выполняется»
			// навсегда — задания, за которым следить, у неё нет.
			finishOp(op, { failed: bases.length, note: e instanceof Error ? e.message : String(e) });
			throw e;
		}
	}, [userName]);

	const save = useMutation({
		mutationFn: async () => {
			const results = [];
			// Реквизиты пишутся только в ТЕКУЩУЮ базу: карточка про пару «человек + база».
			if (dirtyProfile && baseKey) {
				results.push(await enqueue(translate("onecUserUpdate"), `${userName} — ${baseKey}`, [baseKey], {
					name: userName,
					...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
					...(form.password ? { password: form.password } : {}),
					disabled: form.disabled,
					showInList: form.showInList,
				}));
			}
			for (const [base, { add, remove }] of changedByBase) {
				results.push(await enqueue(translate("onecRolesUpdate"), `${userName} — ${base}`, [base], {
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

	/**
	 * ПОЛНАЯ АКТУАЛИЗАЦИЯ карточки — кнопка ⟳ в шапке панели.
	 *
	 * Это единственное место карточки, которое СПРАШИВАЕТ 1С: читает пользователей базы
	 * командой агенту и затем перечитывает реестр. «Обновить» в командной панели таблиц
	 * так не делает намеренно — она перечитывает тот же источник, из которого таблица
	 * читала (кэш реестра сервиса), и стоит доли секунды вместо десятков.
	 */
	const refreshLive = useCallback(async () => {
		if (!baseKey) { await occurrences.refetch(); return; }
		const op = startOp({
			kind: "read", title: translate("onecCardRefresh"), target: `${userName} — ${baseKey}`,
			total: 1, scope: { user: userName, bases: [baseKey] },
		});
		try {
			await fetchBaseUsers(baseKey);
			finishOp(op);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			finishOp(op, { failed: 1, note: msg });
			showToast(msg, "error");
		}
		await Promise.all([occurrences.refetch(), baseUsers.refetch(), roles.refetch()]);
	}, [baseKey, userName, occurrences, baseUsers, roles]);

	// Кнопка ⟳ в шапке панели ищет обработчик в formStoreAPI, а доступной становится
	// только у панели «с записью» — карточка пары именно такая.
	useEffect(() => {
		const uniqId = paneProps.uniqId;
		if (!uniqId) return;
		setPaneIsEditMode(uniqId, true);
		formStoreAPI.register(uniqId, { reload: refreshLive });
		return () => {
			formStoreAPI.unregister(uniqId);
			setPaneIsEditMode(uniqId, false);
		};
	}, [paneProps.uniqId, refreshLive]);

	const openBase = useCallback((r: Partial<TDataItem>) => addPane({
		label: `${translate("onecBaseUserCard")}: ${userName} — ${asText(r.baseKey)}`,
		component: BaseUserForm as never,
		data: { userName, baseKey: asText(r.baseKey) } as unknown as TDataItem,
	}), [addPane, userName]);

	const changedCount = draft.size + (dirtyProfile ? 1 : 0);

	// «Закрыть» — штатное закрытие пейна (с проверкой несохранённого), а не пустышка.
	const close = useCallback(() => {
		if (paneProps.uniqId) void requestClose(paneProps.uniqId);
	}, [requestClose, paneProps.uniqId]);

	return (
		<ModelForm
			paneId={paneProps.uniqId}
			// Пока по паре идёт операция, кнопки формы заблокированы вместе с полями.
			isLoading={occurrences.isLoading || locked || save.isPending}
			onSave={() => save.mutate()}
			onSaveAndClose={() => { save.mutate(undefined, { onSuccess: close }); }}
			onClose={close}
			tabs={[
				{
					id: "main", label: translate("general"),
					component: (
						<GroupCol>
							<QueryError error={occurrences.error ?? baseUsers.error} />

							{/*
							 * ВЛАДЕЛЕЦ — база: не реквизит человека, а область действия карточки.
							 * Отдельная рамка отделяет «где» от «что»: смена базы меняет всё
							 * содержимое ниже, и это должно быть видно до щелчка.
							 */}
							<FormArea title={translate("onecAreaOwner")}>
								<GroupRow>
									<FieldSelect name="buf_base" label={translate("onecBase")} value={baseKey}
										disabled={locked}
										onChange={(e) => setBaseKey(e.target.value)}
										options={occ.map((o) => ({ value: o.baseKey, label: `${o.baseKey} — ${o.baseName || "—"}` }))} />
									<Field name="buf_seen" label={translate("onecDataFrom")}
										value={occ.find((o) => o.baseKey === baseKey)?.seenAt
											? getFormatDate(occ.find((o) => o.baseKey === baseKey)!.seenAt) : "—"}
										disabled width="170px" onChange={() => {}} />
									<Field name="buf_roles" label={translate("roles")}
										value={String((rolesByBase.get(baseKey.toLowerCase()) ?? []).length)}
										disabled width="90px" onChange={() => {}} />
								</GroupRow>
							</FormArea>

							<FormArea title={translate("onecAreaUserData")}>
								<GroupCol>
									<GroupRow>
										<Field name="buf_user" label={translate("onecUserName")} value={userName} disabled width="220px" onChange={() => {}} />
										<Field name="buf_full" label={translate("onecUserFullName")} value={form.fullName} width="240px"
											autoComplete="off" disabled={locked} placeholder={here?.fullName || translate("onecKeepAsIs")}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
										<Field name="buf_pwd" label={translate("onecUserPassword")} type="password" value={form.password}
											width="190px" autoComplete="new-password" disabled={locked} placeholder={translate("onecKeepAsIs")}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))} />
									</GroupRow>
									<GroupRow>
										<FieldToggle name="buf_show" label={translate("onecShowInList")} value={form.showInList}
											disabled={locked}
											onChange={(v) => setForm((f) => ({ ...f, showInList: v }))} />
										<FieldToggle name="buf_disabled" label={translate("onecUserDisabled")} value={form.disabled}
											disabled={locked}
											onChange={(v) => setForm((f) => ({ ...f, disabled: v }))} />
									</GroupRow>
								</GroupCol>
							</FormArea>

							{busy && (
								<Notice items={[{
									type: "info",
									text: `${translate("onecObjectBusy")}: ${busy.title} — ${busy.target}`,
								}]} />
							)}
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
							reloadTitle: translate("onecReloadCached"),
							// Отметка строки = «роль есть в выбранной базе»: штатный чекбокс таблицы,
							// а не своя колонка — с ним работают клавиатура и «отметить всё».
							selectable: !!baseKey && !locked,
							presetSelectedRows: rightsSelected,
							onSelectionChange: applySelection,
							// Одиночный клик раскрывает роль базами — второй разрез той же картины.
							onActiveRowChange: (r) => setExpanded(r ? new Set([asText(r.uuid)]) : new Set()),
							expandedRowIds: expanded,
							childRows,
							onChildToggle: (_parent, child, next) => toggleChild(child, next),
							extraButtons: (
								<>
									<Button variant="secondary" disabled={!draft.size || locked}
										title={draft.size ? translate("onecResetDraft") : translate("onecNoChanges")}
										onClick={() => setDraft(new Map())}>
										<Icon name="restore" /> {translate("onecResetDraft")}
									</Button>
									<Button variant="primary" disabled={!changedCount || save.isPending || locked}
										title={changedCount ? `${translate("onecUnsavedChanges")}: ${changedCount}` : translate("onecNothingToApply")}
										onClick={() => save.mutate()}>
										<Icon name="save" /> {translate("apply")}
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
							reloadTitle: translate("onecReloadCached"),
							// Двойной щелчок — карточка того же человека в другой базе.
							onRowClick: openBase,
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
