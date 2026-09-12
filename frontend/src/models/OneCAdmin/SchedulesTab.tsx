/**
 * «Обслуживание» — выгрузка и проверка баз ПО РАСПИСАНИЮ (F2).
 *
 * ЗАЧЕМ. Обслуживание запускалось только руками, и копия базы существовала ровно тогда,
 * когда о ней кто-то вспомнил. Окно при этом одно — ночь: днём в базах работают, а выгрузка
 * сотни баз занимает часы.
 *
 * РАСПИСАНИЕ — НАСТРОЙКА, А ПРОГОН — ЗАДАНИЕ. Своей истории у расписания нет: ночной
 * прогон становится обычным заданием, и итог по каждой базе смотрят в «Заданиях» — там же,
 * где итоги ручных операций. Поэтому в таблице есть «Последний прогон», а кнопка «Показать
 * задание» открывает его на своей вкладке, а не рисует здесь второй журнал.
 *
 * «ЗАПУСТИТЬ СЕЙЧАС» — не украшение. Автоматику, которая срабатывает в 02:00, иначе нельзя
 * проверить: прогон настоящий, по тем же базам, и отметка о прогоне ставится — значит
 * ночью поверх него второй раз не пойдёт.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { Icon } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	createSchedule, deleteSchedule, fetchBases, fetchSchedules, runSchedule, updateSchedule,
	type OnecSchedule,
} from "src/services/onec/api";
import { CapabilityGuard, QueryError, reportBatchStart, useOnecWrite } from "./shared";
import { attachBatch, startOp } from "./progress";
import styles from "./OneCAdmin.module.scss";

/** Что умеет расписание. Оба типа — долгие операции над самой базой. */
const TYPES = ["IB_BACKUP", "IB_CHECK"] as const;
const TYPE_LABEL: Record<string, string> = { IB_BACKUP: "onecBackup", IB_CHECK: "onecMaintCheck" };

/** Дни недели, как их считает JS (0 — воскресенье) и как читает человек (с понедельника). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL: Record<number, string> = {
	1: "dayMon", 2: "dayTue", 3: "dayWed", 4: "dayThu", 5: "dayFri", 6: "daySat", 0: "daySun",
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Дни словами: пустой список — «каждый день», иначе сокращения по порядку недели. */
const weekdaysLabel = (days: number[]): string =>
	!days.length ? translate("onecSchedEveryDay") : WEEK.filter((d) => days.includes(d)).map((d) => translate(DAY_LABEL[d])).join(", ");

const columns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "220px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "typeLabel", type: "string", width: "150px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "atTime", type: "string", width: "90px", minWidth: "70px", alignment: "left", visible: true, inlist: true },
	{ identifier: "weekdaysLabel", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "basesLabel", type: "string", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "enabledLabel", type: "string", width: "120px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "lastRunLabel", type: "string", width: "180px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Пустая заготовка формы: ночь, каждый день, выгрузка — то, ради чего расписание и заводят. */
const blank = () => ({
	name: "", type: "IB_BACKUP" as string, atTime: "02:00",
	weekdays: [] as number[], dir: "", enabled: true, baseKeys: [] as string[],
});

export const SchedulesTab: FC = () => {
	const qc = useQueryClient();
	const canWrite = useOnecWrite();
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_schedules"));
	const [active, setActive] = useState<string>("");
	const [dialog, setDialog] = useState<null | "create" | "edit" | "delete">(null);
	const [form, setForm] = useState(blank);

	const list = useQuery({ queryKey: ["onec", "schedules"], queryFn: fetchSchedules });
	// Базы нужны для выбора целей. Реестр читается из БД сервиса и в 1С не ходит.
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases, enabled: dialog === "create" || dialog === "edit" });

	const items = list.data?.items ?? [];
	const current = items.find((s) => s.id === active) ?? null;

	const rows = items.map((s, i) => ({
		id: i + 1, uuid: s.id,
		name: s.name,
		typeLabel: translate(TYPE_LABEL[s.type] ?? s.type),
		atTime: s.atTime,
		weekdaysLabel: weekdaysLabel(s.weekdays),
		basesLabel: String(s.baseKeys.length),
		// «Выключено» важнее, чем «пора»: выключенное расписание не запустится никогда.
		enabledLabel: s.enabled
			? (s.due ? translate("onecSchedDueNow") : translate("onecSchedOn"))
			: translate("onecSchedOff"),
		lastRunLabel: s.lastRunAt ? getFormatDate(s.lastRunAt) : "—",
	}));
	const view = useStaticTableView(rows, { atTime: "asc" });

	const baseRows = (bases.data?.items ?? []).map((b, i) => ({
		id: i + 1, uuid: b.key, baseKey: b.key, name: b.name ?? "", serverName: b.serverName ?? "—",
	}));
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns([
		{ identifier: "baseKey", type: "string", width: "220px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
		{ identifier: "name", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
		{ identifier: "serverName", type: "string", width: "160px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	] as unknown as TColumn[], "OneCAdmin_schedBases"));
	const presetIds = useMemo(
		() => new Set(baseRows.filter((r) => form.baseKeys.includes(r.baseKey)).map((r) => r.id)),
		[baseRows, form.baseKeys],
	);

	const close = () => { setDialog(null); setForm(blank()); };
	const done = (text: string) => {
		showToast(text, "success");
		void qc.invalidateQueries({ queryKey: ["onec", "schedules"] });
		close();
	};

	/** Чего не хватает для записи — словами, до нажатия кнопки. */
	const missing = !form.name.trim()
		? translate("name")
		: !TIME_RE.test(form.atTime)
			? translate("onecSchedTime")
			: !form.baseKeys.length
				? translate("onecTabBases")
				: "";

	const payloadOf = () => (form.type === "IB_BACKUP" && form.dir.trim() ? { dir: form.dir.trim() } : {});

	const save = useMutation({
		mutationFn: async () => {
			const input = {
				name: form.name.trim(), type: form.type, baseKeys: form.baseKeys,
				atTime: form.atTime, weekdays: form.weekdays, payload: payloadOf(), enabled: form.enabled,
			};
			return dialog === "edit" && current
				? updateSchedule(current.id, input)
				: createSchedule(input);
		},
		onSuccess: () => done(translate(dialog === "edit" ? "saved" : "created")),
		onError: (e) => reportError(e, { source: translate("onecTabSchedules") }),
	});

	const remove = useMutation({
		mutationFn: () => deleteSchedule(current!.id),
		onSuccess: () => done(translate("deleted")),
		onError: (e) => reportError(e, { source: translate("onecTabSchedules") }),
	});

	/** Переключатель «включено» — прямо из списка: это самое частое действие. */
	const toggle = useMutation({
		mutationFn: (s: OnecSchedule) => updateSchedule(s.id, { enabled: !s.enabled }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["onec", "schedules"] }),
		onError: (e) => reportError(e, { source: translate("onecTabSchedules") }),
	});

	/**
	 * Прогон руками. Записывается в реестр операций, как любая долгая работа: задание идёт
	 * часами, и его прогресс должен быть виден с любой вкладки, а не только отсюда.
	 */
	const runNow = useMutation({
		mutationFn: async (s: OnecSchedule) => {
			const op = startOp({
				kind: "update", title: `${translate("onecSchedRunNow")}: ${s.name}`,
				target: `${translate("onecTabBases")}: ${s.baseKeys.length}`,
				total: s.baseKeys.length, scope: { bases: s.baseKeys },
			});
			const r = await runSchedule(s.id);
			attachBatch(op, r.batchId, r.total);
			reportBatchStart(r, translate("onecTabSchedules"));
			return r;
		},
		onSuccess: () => {
			showToast(translate("onecBatchQueued"), "success");
			void qc.invalidateQueries({ queryKey: ["onec", "schedules"] });
		},
		onError: (e) => reportError(e, { source: translate("onecTabSchedules") }),
	});

	const openEdit = (s: OnecSchedule) => {
		setForm({
			name: s.name, type: s.type, atTime: s.atTime, weekdays: s.weekdays,
			dir: asText((s.payload ?? {}).dir), enabled: s.enabled, baseKeys: s.baseKeys,
		});
		setActive(s.id);
		setDialog("edit");
	};

	return (
		<>
			{/* Обе операции расписания идут внутрь базы — без этой способности агента
			    расписание будет исправно ставить команды, которые никто не выполнит. */}
			<CapabilityGuard capability="ib.admin" />
			<QueryError error={list.error} noticeKey="schedules" source={translate("onecTabSchedules")} />

			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_schedules", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: list.isLoading,
				reloading: list.isFetching,
				onReload: () => void list.refetch(),
				// Пустая таблица молчит о главном: расписаний нет — значит обслуживание идёт
				// только руками, и об этом стоит сказать прямо.
				emptyText: translate("onecSchedNone"),
				onActiveRowChange: (r) => setActive(r ? asText(r.uuid) : ""),
				onRowClick: (r) => {
					const s = items.find((x) => x.id === asText(r.uuid));
					if (s && canWrite) openEdit(s);
				},
				extraButtons: !canWrite ? undefined : (
					<>
						<Button variant="secondary" onClick={() => { setForm(blank()); setDialog("create"); }}>
							<Icon name="plus" /> {translate("create")}
						</Button>
						<Button variant="secondary" disabled={!current}
							title={current ? translate("edit") : translate("onecSchedPickFirst")}
							onClick={() => current && openEdit(current)}>
							<Icon name="editInline" /> {translate("edit")}
						</Button>
						<Button variant="secondary" disabled={!current || toggle.isPending}
							title={current ? translate(current.enabled ? "onecSchedOff" : "onecSchedOn") : translate("onecSchedPickFirst")}
							onClick={() => current && toggle.mutate(current)}>
							<Icon name={current?.enabled ? "clear" : "restore"} />
							{" "}{translate(current?.enabled ? "onecSchedOff" : "onecSchedOn")}
						</Button>
						<Button variant="secondary" disabled={!current || runNow.isPending}
							title={current ? translate("onecSchedRunNowHint") : translate("onecSchedPickFirst")}
							onClick={() => current && runNow.mutate(current)}>
							<Icon name="recalc" /> {translate("onecSchedRunNow")}
						</Button>
						<Button variant="danger" disabled={!current}
							title={current ? translate("delete") : translate("onecSchedPickFirst")}
							onClick={() => setDialog("delete")}>
							<Icon name="trash" /> {translate("delete")}
						</Button>
					</>
				),
			})} />

			{(dialog === "create" || dialog === "edit") && (
				<Modal
					title={translate(dialog === "edit" ? "onecSchedEdit" : "onecSchedCreate")}
					onClose={close}
					onApply={() => { if (!missing) save.mutate(); }}
				>
					<GroupCol>
						<FormArea title={translate("onecSchedWhen")}>
							<GroupCol>
								<GroupRow>
									<Field name="sch_name" label={translate("name")} value={form.name} noAutofill
										width={FIELD_WIDTH.wide}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} />
									<FieldSelect name="sch_type" label={translate("onecSchedWhat")} value={form.type}
										options={TYPES.map((t) => ({ value: t, label: translate(TYPE_LABEL[t]) }))}
										onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} />
									{/* Время — «ЧЧ:ММ» в зоне сервера 1С: окно назначают по сменам, а не по UTC. */}
									<Field name="sch_time" label={translate("onecSchedTime")} value={form.atTime} noAutofill
										width={FIELD_WIDTH.sm} placeholder="02:00"
										error={!TIME_RE.test(form.atTime)}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, atTime: e.target.value }))} />
								</GroupRow>
								{/* Дни — кнопками: семь тумблеров заняли бы всё окно, а выбор здесь
								    почти всегда «каждый день» либо один-два дня. */}
								<GroupRow>
									<span className={styles.Hint}>{translate("onecSchedDays")}</span>
									{WEEK.map((d) => (
										<Button key={d} size="sm" variant="secondary" active={form.weekdays.includes(d)}
											onClick={() => setForm((f) => ({
												...f,
												weekdays: f.weekdays.includes(d)
													? f.weekdays.filter((x) => x !== d)
													: [...f.weekdays, d].sort(),
											}))}>
											{translate(DAY_LABEL[d])}
										</Button>
									))}
									<span className={styles.Hint}>{weekdaysLabel(form.weekdays)}</span>
								</GroupRow>
								<GroupRow>
									<FieldToggle name="sch_enabled" label={translate("onecSchedEnabled")} value={form.enabled}
										onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
									{form.type === "IB_BACKUP" && (
										<Field name="sch_dir" label={translate("onecBackupDir")} value={form.dir} noAutofill
											width={FIELD_WIDTH.lg}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, dir: e.target.value }))} />
									)}
								</GroupRow>
							</GroupCol>
						</FormArea>

						<FormArea title={translate("onecTabBases")}>
							<GroupCol>
								<Notice inline items={[{
									type: "info",
									text: form.type === "IB_BACKUP" ? translate("onecSchedBackupHint") : translate("onecSchedCheckHint"),
								}]} />
								<Table {...buildStaticTableProps({
									componentName: "OneCAdmin_schedBases", rows: baseView.rows, columns: baseCols,
									setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
									isLoading: bases.isLoading,
									selectable: true,
									presetSelectedRows: presetIds,
									onSelectionChange: (sel, all) => setForm((f) => ({
										...f,
										baseKeys: all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey)),
									})),
								})} />
							</GroupCol>
						</FormArea>

						{/* Чего не хватает — рядом с кнопкой, а не отказом после нажатия. */}
						{!!missing && (
							<Notice inline items={[{ type: "warning", text: `${translate("onecWizNeed")}: ${missing}` }]} />
						)}
					</GroupCol>
				</Modal>
			)}

			{dialog === "delete" && current && (
				<Modal title={translate("onecSchedDelete")} onClose={close} onApply={() => remove.mutate()}>
					<GroupCol>
						<div>{current.name} — {translate(TYPE_LABEL[current.type] ?? current.type)}, {current.atTime}</div>
						{/* Удаление расписания не отменяет уже начатых заданий: они идут своим ходом. */}
						<Notice inline items={[{ type: "attention", text: translate("onecSchedDeleteWarning") }]} />
					</GroupCol>
				</Modal>
			)}
		</>
	);
};

export default SchedulesTab;
