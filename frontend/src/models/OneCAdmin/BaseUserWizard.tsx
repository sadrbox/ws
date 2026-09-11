/**
 * Помощник группового редактирования пользователя баз — ТРИ ШАГА.
 *
 * ЗАЧЕМ ОН ЕСТЬ. Групповая правка — это три разных вопроса, и раньше они стояли вперемешку.
 * Карточка пары «человек + база» правила одну базу, но её вкладка «Права» незаметно
 * захватывала все остальные: строка роли считала «в скольких базах из скольких», а отдельная
 * база пряталась во вложенной строке. Человек, снявший галочку в карточке ОДНОЙ базы, не мог
 * сказать, где именно она снялась. Теперь карточка правит свою базу, а групповая правка
 * живёт здесь, где базы выбирают ЯВНЫМ первым шагом.
 *
 * ШАГ 1 — НАД ЧЕМ. Базы, где человек заведён. Ничего не выбрано — дальше не пускаем: команда
 * без цели бессмысленна.
 *
 * ШАГ 2 — ЧТО У НЕГО СЕЙЧАС. Одинаковые значения сведены в одну строку («Полное имя: Иванов
 * И.И. — во всех 5 базах»), различающиеся показаны по базам отдельными строками: именно
 * расхождения и есть то, ради чего сюда пришли. Двойной щелчок по строке базы открывает
 * карточку этой пары — поправить одну базу, не трогая остальные.
 *
 * ШАГ 3 — ПРАВА И РОЛИ. Те же вложенные строки, что были в карточке, но ТОЛЬКО по базам,
 * выбранным на первом шаге: даже если человек есть в других базах, здесь их нет — иначе
 * выбор первого шага ничего не значил бы.
 *
 * ЗАПИСЬ — ОДНА КОМАНДА НА БАЗУ, со всеми изменениями сразу (реквизиты и роли вместе):
 * порядок внутри одной команды — забота агента, а не гонка между двумя.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import Wizard, { type WizardStep } from "src/components/Wizard";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { useAppContext } from "src/app/context";
import {
	fetchRoles, fetchUserOccurrences, runBatch, type UserOccurrence,
} from "src/services/onec/api";
import { attachBatch, finishOp, startOp } from "./progress";
import { useOpenBaseUser } from "./BaseUserForm";
import main from "src/styles/main.module.scss";

/** Шаг 1: базы, где человек заведён. */
const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "260px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesCount", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "state", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Шаг 2: реквизит — значение — где оно такое. */
const dataColumns = (): TColumn[] => ([
	{ identifier: "attr", type: "string", width: "200px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "value", type: "string", width: "300px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
	{ identifier: "where", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "changedLabel", type: "string", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Шаг 3: роль — в скольких выбранных базах — пометка правки. */
const rightsColumns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "320px", minWidth: "180px", alignment: "left", visible: true, inlist: true },
	{ identifier: "inBases", type: "string", width: "150px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "changedLabel", type: "string", width: "150px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Ключ черновика роли: пара «база + роль» — правка всегда адресна. */
const draftKey = (base: string, role: string) => `${base.toLowerCase()}|${role}`;

/** Какие реквизиты правит помощник. Пароль — отдельно: его текущее значение не читается. */
type Attr = "fullName" | "disabled";

const ATTR_TITLE: Record<Attr, string> = {
	fullName: "onecUserFullName",
	disabled: "onecUserDisabled",
};

export const BaseUserWizard: FC<Partial<TPane>> = (paneProps) => {
	const row = (paneProps.data ?? {}) as TDataItem;
	const userName = asText(row.userName) || asText(row.name);
	const qc = useQueryClient();
	const { requestClose } = useAppContext().windows;
	const openCard = useOpenBaseUser();

	const occurrences = useQuery({
		queryKey: ["onec", "user-where", userName],
		queryFn: () => fetchUserOccurrences(userName),
		enabled: !!userName,
	});
	const occ = useMemo(() => occurrences.data?.items ?? [], [occurrences.data]);
	const roles = useQuery({ queryKey: ["onec", "roles", ""], queryFn: () => fetchRoles(), staleTime: 5 * 60_000 });

	// ── Шаг 1: выбранные базы ───────────────────────────────────────────────
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const chosen = useMemo(
		() => occ.filter((o) => picked.has(o.baseKey.toLowerCase())),
		[occ, picked],
	);

	// ── Шаг 2: черновик реквизитов (задаётся сразу всем выбранным базам) ────
	const [profile, setProfile] = useState<{ fullName?: string; disabled?: boolean; password?: string }>({});
	const [editing, setEditing] = useState<null | Attr | "password">(null);
	const [editValue, setEditValue] = useState("");
	const [editFlag, setEditFlag] = useState(false);

	// ── Шаг 3: черновик ролей ───────────────────────────────────────────────
	const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const rolesByBase = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const o of occ) m.set(o.baseKey.toLowerCase(), o.roles ?? []);
		return m;
	}, [occ]);

	const isOn = useCallback((base: string, role: string) => {
		const d = draft.get(draftKey(base, role));
		return d ?? (rolesByBase.get(base.toLowerCase()) ?? []).includes(role);
	}, [draft, rolesByBase]);

	const toggleRole = useCallback((base: string, role: string) => {
		setDraft((prev) => {
			const next = new Map(prev);
			const was = (rolesByBase.get(base.toLowerCase()) ?? []).includes(role);
			const now = !isOn(base, role);
			// Вернули как было — строка из черновика уходит: правка, равная исходному,
			// означала бы поход в базу зря.
			if (now === was) next.delete(draftKey(base, role));
			else next.set(draftKey(base, role), now);
			return next;
		});
	}, [rolesByBase, isOn]);

	// ── Таблица шага 1 ──────────────────────────────────────────────────────
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_wizBases"));
	const baseRows = useMemo(() => occ.map((o, i) => ({
		id: i + 1, uuid: o.baseKey, baseKey: o.baseKey, name: o.baseName || "—",
		rolesCount: (o.roles ?? []).length,
		state: o.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
	})), [occ]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });

	// ── Таблица шага 2: одинаковое сводим, различающееся разводим ───────────
	const [dataCols, setDataCols] = useState<TColumn[]>(() => getModelColumns(dataColumns(), "OneCAdmin_wizData"));

	/** Значение реквизита у одной базы — в том виде, в каком его показывают. */
	const valueOf = useCallback((o: UserOccurrence, attr: Attr): string => (
		attr === "fullName"
			? (o.fullName || "—")
			: (o.disabled ? translate("yes") : translate("no"))
	), []);

	const dataRows = useMemo(() => {
		const rows: TDataItem[] = [];
		let id = 0;
		for (const attr of ["fullName", "disabled"] as Attr[]) {
			const pending = attr === "fullName" ? profile.fullName : profile.disabled;
			const changedLabel = pending === undefined
				? ""
				: `${translate("onecWillBe")}: ${attr === "fullName"
					? (String(pending).trim() || "—")
					: (pending ? translate("yes") : translate("no"))}`;

			// Одинаковые значения — ОДНА строка: сорок одинаковых строк не сообщают ничего.
			const byValue = new Map<string, UserOccurrence[]>();
			for (const o of chosen) {
				const v = valueOf(o, attr);
				byValue.set(v, [...(byValue.get(v) ?? []), o]);
			}
			if (byValue.size <= 1) {
				const [value, list] = [...byValue.entries()][0] ?? ["—", []];
				rows.push({
					id: ++id, uuid: `${attr}|all`, attr: translate(ATTR_TITLE[attr]), value,
					where: `${translate("onecBases")}: ${list.length}`,
					changedLabel, __attr: attr, __base: "",
				});
				continue;
			}
			// Расхождение — ОТДЕЛЬНОЙ СТРОКОЙ ПО БАЗЕ: ради него сюда и приходят.
			for (const o of chosen) {
				rows.push({
					id: ++id, uuid: `${attr}|${o.baseKey}`, attr: translate(ATTR_TITLE[attr]),
					value: valueOf(o, attr), where: `${o.baseKey} — ${o.baseName || "—"}`,
					changedLabel, __attr: attr, __base: o.baseKey,
				});
			}
		}
		// Пароль: текущего значения не существует — в базе лежит только его проверочная
		// часть. Поэтому строка показывает не «что есть», а «что будет».
		rows.push({
			id: ++id, uuid: "password", attr: translate("onecUserPassword"),
			value: translate("onecPwdNotReadable"),
			where: `${translate("onecBases")}: ${chosen.length}`,
			changedLabel: profile.password ? translate("onecPwdWillChange") : "",
			__attr: "password", __base: "",
		});
		return rows;
	}, [chosen, profile, valueOf]);
	const dataView = useStaticTableView(dataRows, {});
	const [activeData, setActiveData] = useState<TDataItem | null>(null);

	// ── Таблица шага 3: роли по ВЫБРАННЫМ базам ─────────────────────────────
	const [rightsCols, setRightsCols] = useState<TColumn[]>(() => getModelColumns(rightsColumns(), "OneCAdmin_wizRights"));
	const allRoles = useMemo(() => {
		const own = [...new Set(chosen.flatMap((o) => o.roles ?? []))];
		const known = (roles.data?.items ?? []).map((r) => r.name);
		return [...new Set([...own, ...known])].sort((a, b) => a.localeCompare(b, "ru"));
	}, [chosen, roles.data]);

	const rightsRows = useMemo(() => allRoles.map((role, i) => {
		const changed = chosen.filter((o) => draft.has(draftKey(o.baseKey, role))).length;
		return {
			id: i + 1, uuid: role, role,
			inBases: `${chosen.filter((o) => isOn(o.baseKey, role)).length} / ${chosen.length}`,
			changedLabel: changed ? `${translate("onecChanged")}: ${changed}` : "",
		};
	}), [allRoles, chosen, isOn, draft]);
	const rightsView = useStaticTableView(rightsRows, { role: "asc" });

	/**
	 * Вложенные строки — ТОЛЬКО по выбранным базам. Даже если человек есть в других,
	 * здесь их нет: иначе выбор первого шага ничего не значил бы.
	 */
	const childRows = useCallback((r: TDataItem): TDataItem[] => {
		const role = asText(r.role);
		return chosen.map((o, i) => ({
			// Отрицательные идентификаторы: пространство строк у потомков своё и не должно
			// пересечься с идентификаторами ролей (по ним живут отметки).
			id: -(i + 1), uuid: `${role}|${o.baseKey}`,
			role: o.baseKey,
			inBases: o.baseName || "—",
			changedLabel: draft.has(draftKey(o.baseKey, role)) ? translate("onecChanged") : "",
			__selected: isOn(o.baseKey, role),
			__role: role, __base: o.baseKey,
		}));
	}, [chosen, draft, isOn]);

	// ── Что и куда уйдёт ────────────────────────────────────────────────────
	const changedByBase = useMemo(() => {
		const m = new Map<string, { add: string[]; remove: string[] }>();
		for (const [key, on] of draft) {
			const [base, role] = key.split("|");
			const real = chosen.find((o) => o.baseKey.toLowerCase() === base);
			if (!real) continue;
			const e = m.get(real.baseKey) ?? { add: [], remove: [] };
			(on ? e.add : e.remove).push(role);
			m.set(real.baseKey, e);
		}
		return m;
	}, [draft, chosen]);

	const profileChanged = profile.fullName !== undefined || profile.disabled !== undefined || !!profile.password;
	const changedBases = useMemo(() => {
		const keys = new Set(changedByBase.keys());
		if (profileChanged) for (const o of chosen) keys.add(o.baseKey);
		return [...keys];
	}, [changedByBase, profileChanged, chosen]);

	const apply = useMutation({
		mutationFn: async () => {
			/** База → что в ней изменить. Одна запись — одна команда (см. заголовок). */
			const plan = new Map<string, Record<string, unknown>>();
			for (const base of changedBases) {
				const entry: Record<string, unknown> = { name: userName };
				if (profile.fullName !== undefined && profile.fullName.trim()) entry.fullName = profile.fullName.trim();
				if (profile.disabled !== undefined) entry.disabled = profile.disabled;
				if (profile.password) entry.password = profile.password;
				const r = changedByBase.get(base);
				if (r?.add.length) entry.addRoles = r.add;
				if (r?.remove.length) entry.removeRoles = r.remove;
				plan.set(base, entry);
			}

			/*
			 * БАЗЫ С ОДИНАКОВЫМ ИЗМЕНЕНИЕМ — ОДНИМ ЗАДАНИЕМ.
			 *
			 * Реквизиты задаются сразу всем выбранным базам, а роли могут различаться —
			 * значит и полезная нагрузка у баз где-то одна, а где-то разная. Отправлять
			 * задание на каждую базу отдельно было бы расточительно, а одно задание на всех
			 * — неверно: в него не уложить разные наборы ролей.
			 *
			 * Поэтому группируем по СОДЕРЖИМОМУ команды. И заводим СВОЮ запись прогресса на
			 * каждое задание: одна запись, следящая за первым из нескольких заданий, врала
			 * бы — показывала бы «готово», когда остальные ещё идут.
			 */
			const byPayload = new Map<string, { bases: string[]; payload: Record<string, unknown> }>();
			for (const [base, payload] of plan) {
				// Имя базы в подпись не входит: оно и есть то, чем группы различают цели.
				const sig = JSON.stringify(payload);
				const g = byPayload.get(sig) ?? { bases: [], payload };
				g.bases.push(base);
				byPayload.set(sig, g);
			}

			let started = 0;
			for (const { bases: group, payload } of byPayload.values()) {
				const opId = startOp({
					kind: "update", title: translate("onecUserGroupEdit"),
					target: `${userName} · ${translate("onecBases")}: ${group.length}`,
					total: group.length, scope: { user: userName, bases: group },
				});
				try {
					const r = await runBatch("IB_UPDATE_USER", group, payload);
					attachBatch(opId, r.batchId, r.total,
						r.skipped.length ? `${translate("onecBatchSkipped")}: ${r.skipped.length}` : "");
					started += 1;
				} catch (e) {
					finishOp(opId, { failed: group.length, note: e instanceof Error ? e.message : String(e) });
					throw e;
				}
			}
			return started;
		},
		onSuccess: (n) => {
			showToast(`${translate("onecBatchQueued")}: ${n}`, "success");
			setDraft(new Map());
			setProfile({});
			void qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
			void qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
			if (paneProps.uniqId) void requestClose(paneProps.uniqId);
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	// ── Шаги ────────────────────────────────────────────────────────────────
	const steps: WizardStep[] = [
		{
			id: "bases",
			title: translate("onecWizStepBases"),
			hint: translate("onecWizStepBasesHint"),
			blockedReason: picked.size ? "" : translate("onecPickBasesFirst"),
			body: (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_wizBases", rows: baseView.rows, columns: baseCols,
					setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
					isLoading: occurrences.isLoading,
					reloading: occurrences.isFetching,
					onReload: () => void occurrences.refetch(),
					selectable: true,
					onSelectionChange: (sel, all) => setPicked(new Set(
						all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey).toLowerCase()),
					)),
					// Двойной щелчок — карточка пары: посмотреть базу, не выходя из выбора.
					onRowClick: (r) => openCard(userName, asText(r.baseKey)),
				})} />
			),
		},
		{
			id: "data",
			title: translate("onecWizStepData"),
			hint: translate("onecWizStepDataHint"),
			body: (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_wizData", rows: dataView.rows, columns: dataCols,
					setColumns: setDataCols, sorting: dataView.sorting, search: dataView.search,
					isLoading: false,
					onActiveRowChange: (r) => setActiveData(r ?? null),
					// Двойной щелчок по строке базы открывает карточку этой пары: поправить
					// одну базу, не трогая остальные.
					onRowClick: (r) => {
						const base = asText(r.__base);
						if (base) openCard(userName, base);
					},
					extraButtons: (
						<Button variant="primary" disabled={!activeData}
							title={activeData ? translate("onecWizSetForAll") : translate("onecWizPickAttr")}
							onClick={() => {
								const attr = asText(activeData?.__attr);
								if (attr === "password") { setEditValue(""); setEditing("password"); return; }
								if (attr === "fullName") {
									setEditValue(profile.fullName ?? "");
									setEditing("fullName");
									return;
								}
								setEditFlag(profile.disabled ?? false);
								setEditing("disabled");
							}}>
							<Icon name="editInline" /> {translate("onecWizSetForAll")}
						</Button>
					),
				})} />
			),
		},
		{
			id: "rights",
			title: translate("onecTabRights"),
			hint: translate("onecWizStepRightsHint"),
			body: (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_wizRights", rows: rightsView.rows, columns: rightsCols,
					setColumns: setRightsCols, sorting: rightsView.sorting, search: rightsView.search,
					isLoading: roles.isLoading,
					disableActiveRow: true,
					// Отметка роли — групповая по ВЫБРАННЫМ базам: полная, если роль есть во
					// всех, промежуточная — если в части. Отдельная база правится вложенной
					// строкой; обе отметки — одна и та же правка, просто разного охвата.
					selectable: true,
					expandedRowIds: expanded,
					onToggleExpand: (r) => setExpanded((prev) => {
						const key = asText(r.uuid);
						const next = new Set(prev);
						if (!next.delete(key)) next.add(key);
						return next;
					}),
					childRows,
					onChildToggle: (_parent, child, next) => {
						const base = asText(child.__base);
						const role = asText(child.__role);
						if (base && role && next !== isOn(base, role)) toggleRole(base, role);
					},
				})} />
			),
		},
	];

	return (
		<div className={main.PaneFill}>
			{!userName && <Notice inline items={[{ type: "attention", text: translate("onecWizNoUser") }]} />}

			<Wizard
				steps={steps}
				finishLabel={translate("apply")}
				finishBlockedReason={changedBases.length ? "" : translate("onecNothingToApply")}
				finishing={apply.isPending}
				onFinish={() => apply.mutate()}
				onCancel={paneProps.uniqId ? () => void requestClose(paneProps.uniqId!) : undefined}
			/>

			{editing && (
				<Modal
					title={translate("onecWizSetForAll")}
					onClose={() => setEditing(null)}
					onApply={() => {
						if (editing === "fullName") setProfile((p) => ({ ...p, fullName: editValue }));
						else if (editing === "password") setProfile((p) => ({ ...p, password: editValue }));
						else setProfile((p) => ({ ...p, disabled: editFlag }));
						setEditing(null);
					}}
				>
					<div className={main.Form}>
						<div>{translate("onecBases")}: {chosen.length}</div>
						{editing === "fullName" && (
							<Field name="wiz_full" label={translate("onecUserFullName")} value={editValue} noAutofill
								width={FIELD_WIDTH.wide}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value)} />
						)}
						{editing === "password" && (
							<Field name="wiz_pwd" label={translate("onecUserPassword")} type="password" value={editValue}
								width={FIELD_WIDTH.wide}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value)} />
						)}
						{editing === "disabled" && (
							<FieldToggle name="wiz_disabled" label={translate("onecUserDisabled")}
								value={editFlag} onChange={setEditFlag} />
						)}
						<Notice inline items={[{ type: "warning", text: translate("onecWizSetForAllWarning") }]} />
					</div>
				</Modal>
			)}
		</div>
	);
};
BaseUserWizard.displayName = "BaseUserWizard";

/** Открыть помощник группового редактирования отдельным пейном. */
export function useOpenBaseUserWizard() {
	const { addPane } = useAppContext().windows;
	return (userName: string) => {
		if (!userName) return;
		addPane({
			label: `${translate("onecUserGroupEdit")}: ${userName}`,
			component: BaseUserWizard as never,
			data: { userName } as unknown as TDataItem,
		});
	};
}

export default BaseUserWizard;
