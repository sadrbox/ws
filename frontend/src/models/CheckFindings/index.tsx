/**
 * «Проверки учёта 1С» (E17 СК2, пп. 7–18 и 37 стандарта): находки ночного прогона проверок
 * в базах 1С клиентов, карточка находки с решением главбуха и журнал прогонов.
 *
 * Откуда данные. Сервис `ai` ночью прогоняет проверки расширения `buhprof_api` по базам
 * клиентов и складывает находки в ERP (backend/api/router/accountingChecks.js). Находка живёт
 * по `fingerprint`: пропала в полном прогоне — устранена, и закрывает её база, а не исполнитель.
 * Руками здесь только одно действие — исключение с причиной (главбух, руководитель, админ).
 *
 * ПРОВЕРИТЬ ПОТОМ: сторона 1С ещё не сдала проверки (docs/TASK_EXTENSION_ACCOUNTING_CHECKS_*),
 * живого прогона не было — список наполнится после ответа 1С (docs/TASK_SERVICE_ACCOUNTING_CHECKS_*).
 */
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table, { type TTableVariant } from "src/components/Table";
import ModelList from "src/components/ModelList";
import ModelForm from "src/components/ModelForm";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { getFormatNumerical, getModelColumns } from "src/components/Table/services";
import { showToast } from "src/components/UIToast";
import { useAppContext } from "src/app/context";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { openFormByEndpoint } from "src/registry/formRegistry";
import { routeError } from "src/services/errors/route";
import { clearFindingException, type CheckFinding, type CheckRun } from "src/services/quality/api";
import { checkLabel, checkOptions, type QualityArea } from "src/services/quality/checkCatalog";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { withStableIds } from "src/utils/stableRowId";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import { getFormatDate, getFormatDateOnly } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import QualityChip from "src/models/_quality/QualityChip";
import { consumePaneFilter, requestPaneFilter, subscribePaneFilter } from "./paneFilterBus";
import {
	EMPTY_FINDINGS_FILTER, EMPTY_RUNS_FILTER, FINDINGS_FILTER_KEY, RUNS_FILTER_KEY,
	areaOptions, findingDocuments, findingObjects, findingStateLabel, findingStateTone, findingsQuery,
	formatDetails, objectKindLabel, pickFindingsFilter, pickRunsFilter, runStatusLabel, runStatusOptions,
	runStatusTone, runsQuery, severityLabel, severityOptions, severityTone, stateOptions,
	type FindingDocument, type FindingObject, type FindingSeverity, type FindingStateFilter,
	type FindingsFilter, type RunStatus, type RunsFilter,
} from "./findingsView";
import { FindingExceptionModal } from "./ExceptionModal";
import columnsJson from "./columns.json";
import runsColumnsJson from "./runsColumns.json";
import objectsColumnsJson from "./objectsColumns.json";
import documentsColumnsJson from "./documentsColumns.json";
import main from "src/styles/main.module.scss";
import styles from "./CheckFindings.module.scss";

const FINDINGS_ENDPOINT = "check-findings";
const FINDINGS_LIST = "CheckFindingsList";
const RUNS_ENDPOINT = "check-runs";
const RUNS_LIST = "CheckRunsList";

/** Пропы списка: из навбара/реестра (variant) и от PaneItem (data — отбор при открытии). */
interface ListProps {
	variant?: TTableVariant;
	data?: Partial<TDataItem>;
}

/** Сумма находки — два знака, как в учёте; пусто — прочерк. */
const fmtAmount = (v: unknown): string => {
	const n = Number(asText(v));
	return asText(v) !== "" && Number.isFinite(n) ? getFormatNumerical(n, 2) : "";
};

// ═══════════════════════════════════════════════════════════════════════════
// Находки
// ═══════════════════════════════════════════════════════════════════════════

export const CheckFindingsList: FC<ListProps> = ({ variant, data }) => {
	const { addPane } = useAppContext().windows;
	const [filter, setFilter] = useState<FindingsFilter>(() => ({
		...EMPTY_FINDINGS_FILTER,
		...pickFindingsFilter(data as Record<string, unknown> | undefined),
		...(consumePaneFilter<Partial<FindingsFilter>>(FINDINGS_FILTER_KEY) ?? {}),
	}));
	// Отбор «снаружи» (панель главбуха, пункт чек-листа) при уже открытом списке заменяет текущий.
	useEffect(() => subscribePaneFilter<Partial<FindingsFilter>>(FINDINGS_FILTER_KEY, (f) => setFilter({ ...EMPTY_FINDINGS_FILTER, ...f })), []);
	const patch = useCallback((p: Partial<FindingsFilter>) => setFilter((prev) => ({ ...prev, ...p })), []);
	const query = useMemo(() => findingsQuery(filter), [filter]);

	// Проверка вне каталога (пришла отбором снаружи) — отдельным вариантом, иначе селект её не покажет.
	const checks = useMemo(() => {
		const list = checkOptions(translate("findingsAllChecks"), filter.area);
		if (filter.checkCode && !list.some((o) => o.value === filter.checkCode)) list.push({ value: filter.checkCode, label: checkLabel(filter.checkCode) });
		return list;
	}, [filter.area, filter.checkCode]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		switch (col.identifier) {
			case "checkTitle": return <span>{checkLabel(asText(row.checkCode), asText(row.checkTitle))}</span>;
			case "severity": return <QualityChip tone={severityTone(asText(row.severity))}>{severityLabel(asText(row.severity))}</QualityChip>;
			case "state": return <QualityChip tone={findingStateTone(asText(row.state))}>{findingStateLabel(asText(row.state))}</QualityChip>;
			case "findingFirstSeen": return <span>{getFormatDate(asText(row.firstSeenAt))}</span>;
			case "findingLastSeen": return <span>{getFormatDate(asText(row.lastSeenAt))}</span>;
			default: return undefined;
		}
	}, []);

	const openRuns = useCallback(() => {
		const f: Partial<RunsFilter> = filter.organizationUuid ? { organizationUuid: filter.organizationUuid, organizationName: filter.organizationName } : {};
		requestPaneFilter(RUNS_FILTER_KEY, f);
		addPane({ component: CheckRunsList, label: translate(RUNS_LIST), data: f as Partial<TDataItem> });
	}, [addPane, filter.organizationUuid, filter.organizationName]);

	const toolbar = (
		<>
			<LookupField name="check_findings_org" endpoint="organizations" value={filter.organizationUuid} displayValue={filter.organizationName}
				onSelect={(uuid, display) => patch({ organizationUuid: uuid, organizationName: uuid ? display : "" })}
				placeholder={translate("organization")} allowCreate={false} visibleActions={["quickselect", "list", "clear"]} width={FIELD_WIDTH.wide} />
			<FieldSelect name="check_findings_state" size="sm" value={filter.state} options={stateOptions()}
				onChange={(e) => patch({ state: e.target.value as FindingStateFilter })} />
			<FieldSelect name="check_findings_severity" size="sm" value={filter.severity} options={severityOptions()}
				onChange={(e) => patch({ severity: e.target.value as FindingSeverity | "" })} />
			<FieldSelect name="check_findings_area" size="sm" value={filter.area} options={areaOptions()}
				onChange={(e) => patch({ area: e.target.value as QualityArea | "", checkCode: "" })} />
			<FieldSelect name="check_findings_check" size="sm" value={filter.checkCode} options={checks}
				onChange={(e) => patch({ checkCode: e.target.value })} />
			<Button onClick={openRuns}>{translate(RUNS_LIST)}</Button>
		</>
	);

	return (
		<>
			{/* Откуда данные и что ещё не проверено вживую — в области сообщений панели. */}
			<Notice items={[{ type: "info", text: translate("findingsSourceInfo") }, { type: "info", text: translate("findingsCheckLater") }]} />
			<ModelList endpoint={FINDINGS_ENDPOINT} listName={FINDINGS_LIST} columnsJson={columnsJson} FormComponent={CheckFindingsForm}
				getLabel={(d) => asText(d?.title).slice(0, 60) || "?"} variant={variant}
				defaultSort={{ firstSeenAt: "desc" }} hideAddDelete
				extraQueryParams={query.extraQueryParams} extraFilter={query.extraFilter}
				renderCell={renderCell} extraButtons={toolbar} />
		</>
	);
};
CheckFindingsList.displayName = "CheckFindingsList";

// ── Карточка находки ────────────────────────────────────────────────────────

interface TFields {
	id?: number;
	uuid?: string;
	organizationUuid: string;
	organizationName: string;
	checkCode: string;
	checkTitle: string;
	severity: string;
	title: string;
	factDate: string;
	amount: string;
	account: string;
	quantity: string;
	fingerprint: string;
	firstSeenAt: string;
	lastSeenAt: string;
	resolvedAt: string;
	state: string;
	exceptionReason: string;
	exceptionByName: string;
	exceptionAt: string;
	exceptionUntil: string;
	exceptionActive: boolean;
	todoUuid: string;
	canDecide: boolean;
	objects: FindingObject[];
	documents: FindingDocument[];
	details: string;
}

const DEFAULT_FIELDS: TFields = {
	organizationUuid: "", organizationName: "", checkCode: "", checkTitle: "", severity: "", title: "",
	factDate: "", amount: "", account: "", quantity: "", fingerprint: "",
	firstSeenAt: "", lastSeenAt: "", resolvedAt: "", state: "",
	exceptionReason: "", exceptionByName: "", exceptionAt: "", exceptionUntil: "", exceptionActive: false,
	todoUuid: "", canDecide: false, objects: [], documents: [], details: "",
};

export const CheckFindingsForm: FC<Partial<TPane>> = (paneProps) => {
	const { addPane } = useAppContext().windows;
	const { confirm } = useAppContext().actions;
	const queryClient = useQueryClient();
	const [showException, setShowException] = useState(false);
	const [actionNotices, setActionNotices] = useState<NoticeItem[]>([]);

	const form = useFormStore<TFields>({
		endpoint: FINDINGS_ENDPOINT, storageKey: "check-findings-form", paneProps, defaultFields: DEFAULT_FIELDS,
		mapServerToForm: (d: CheckFinding, prev) => ({
			...(prev ?? DEFAULT_FIELDS),
			id: d.id, uuid: d.uuid,
			organizationUuid: d.organizationUuid ?? "", organizationName: d.organizationName ?? "",
			checkCode: d.checkCode ?? "", checkTitle: d.checkTitle ?? "", severity: d.severity ?? "", title: d.title ?? "",
			factDate: d.factDate ?? "", amount: asText(d.amount), account: asText(d.data?.account), quantity: asText(d.data?.quantity),
			fingerprint: d.fingerprint ?? "", firstSeenAt: d.firstSeenAt ?? "", lastSeenAt: d.lastSeenAt ?? "",
			resolvedAt: d.resolvedAt ?? "", state: d.state ?? "",
			exceptionReason: d.exceptionReason ?? "", exceptionByName: d.exceptionByName ?? "",
			exceptionAt: d.exceptionAt ?? "", exceptionUntil: d.exceptionUntil ?? "", exceptionActive: !!d.exceptionActive,
			todoUuid: d.todoUuid ?? "", canDecide: !!d.canDecide,
			objects: findingObjects(d.data), documents: findingDocuments(d.data), details: formatDetails(d.data?.details),
		}),
		// Находку не пишут: её создаёт и закрывает прогон. Кнопок записи у карточки нет (readonly).
		buildPayload: () => translate("findingReadonly"),
		buildPaneLabel: (saved: LabelSource & { title?: string | null }) =>
			makePaneLabel(FINDINGS_LIST, translate("CheckFindingsForm"), saved, saved.title ? String(saved.title).slice(0, 60) : undefined),
	});
	const f = form.fields;
	const formNotices = useFormNotices(form);
	const notices = useMemo(() => [...formNotices, ...actionNotices], [formNotices, actionNotices]);

	const [objCols, setObjCols] = useState<TColumn[]>(() => getModelColumns(objectsColumnsJson as TColumn[], "CheckFindingObjects"));
	const [docCols, setDocCols] = useState<TColumn[]>(() => getModelColumns(documentsColumnsJson as TColumn[], "CheckFindingDocuments"));
	const objRows = useMemo(() => withStableIds(f.objects.map((o) => ({
		uuid: `${o.kind}:${o.id}:${o.name}`, findingObjKind: objectKindLabel(o.kind), name: o.name, findingOnecId: o.id,
	})), (r) => r.uuid), [f.objects]);
	const docRows = useMemo(() => withStableIds(f.documents.map((d) => ({
		uuid: `${d.kind}:${d.id}:${d.number}`,
		findingObjKind: d.documentType ? `${objectKindLabel(d.kind)} (${d.documentType})` : objectKindLabel(d.kind),
		findingDocNumber: d.number, date: d.date,
		findingDocPosted: d.posted === null ? "" : translate(d.posted ? "yes" : "no"),
		findingDocAuthor: d.author, findingOnecId: d.id,
	})), (r) => r.uuid), [f.documents]);
	const renderIdCell = useCallback((row: TDataItem, col: TColumn) =>
		(col.identifier === "findingOnecId" ? <span className={styles.Mono}>{asText(row.findingOnecId)}</span> : undefined), []);

	/** Решение по находке меняет и карточку, и списки, и светофор панели главбуха. */
	const refreshAll = useCallback(async () => {
		setActionNotices([]);
		await form.handleReload();
		void queryClient.invalidateQueries({ queryKey: [FINDINGS_ENDPOINT] });
		void queryClient.invalidateQueries({ queryKey: ["quality"] });
	}, [form, queryClient]);

	const clearException = useCallback(async () => {
		if (!f.uuid || !(await confirm(translate("findingExceptionClearConfirm")))) return;
		try {
			await clearFindingException(f.uuid);
			showToast(translate("findingExceptionCleared"), "success");
			await refreshAll();
		} catch (e) {
			setActionNotices(routeError(e, { source: translate("CheckFindingsForm") }));
		}
	}, [f.uuid, confirm, refreshAll]);

	const tabs = useMemo(() => [
		{
			id: "tab-details", label: translate("general"), component: (
				<div className={main.FormWrapper}>
					<div className={main.Form}>
						<GroupCol>
							<div className={styles.Chips}>
								{f.severity && <QualityChip tone={severityTone(f.severity)}>{severityLabel(f.severity)}</QualityChip>}
								{f.state && <QualityChip tone={findingStateTone(f.state)}>{findingStateLabel(f.state)}</QualityChip>}
							</div>
							<Group>
								<Field label={translate("organization")} name={`${form.formUid}_org`} value={f.organizationName} disabled minWidth={FIELD_WIDTH.lg} />
							</Group>
							<Group>
								<Field label={translate("checkTitle")} name={`${form.formUid}_check`} value={checkLabel(f.checkCode, f.checkTitle)} disabled minWidth={FIELD_WIDTH.lg} />
							</Group>
							<Group>
								<FieldTextarea label={translate("findingText")} name={`${form.formUid}_title`} value={f.title} disabled minWidth={FIELD_WIDTH.lg} rows={3} />
							</Group>
							<Group>
								<Field label={translate("amount")} name={`${form.formUid}_amount`} value={fmtAmount(f.amount)} disabled width={FIELD_WIDTH.amount} />
								<Field label={translate("factDate")} name={`${form.formUid}_factDate`} value={getFormatDateOnly(f.factDate)} disabled width={FIELD_WIDTH.date} />
							</Group>
							<Group>
								<Field label={translate("account")} name={`${form.formUid}_account`} value={f.account} disabled width={FIELD_WIDTH.sm} />
								<Field label={translate("quantity")} name={`${form.formUid}_quantity`} value={f.quantity} disabled width={FIELD_WIDTH.sm} />
							</Group>
							<Group>
								<Field label={translate("findingFirstSeen")} name={`${form.formUid}_first`} value={getFormatDate(f.firstSeenAt)} disabled width={FIELD_WIDTH.date} />
								<Field label={translate("findingLastSeen")} name={`${form.formUid}_last`} value={getFormatDate(f.lastSeenAt)} disabled width={FIELD_WIDTH.date} />
								<Field label={translate("findingResolvedAt")} name={`${form.formUid}_resolved`} value={getFormatDate(f.resolvedAt)} disabled width={FIELD_WIDTH.date} />
							</Group>
							<Group>
								<Field label={translate("fingerprint")} name={`${form.formUid}_fp`} value={f.fingerprint} title={f.fingerprint} disabled minWidth={FIELD_WIDTH.xl}
									hint={translate("fingerprintHint")} />
							</Group>
							<fieldset className={main.FormArea}>
								<legend className={main.FormAreaTitle}>{translate("findingExceptionTitle")}</legend>
								{f.exceptionAt ? (
									<GroupCol>
										<Group>
											<FieldTextarea label={translate("findingExceptionReason")} name={`${form.formUid}_exReason`} value={f.exceptionReason} disabled minWidth={FIELD_WIDTH.lg} rows={2} />
										</Group>
										<Group>
											<Field label={translate("findingExceptionBy")} name={`${form.formUid}_exBy`} value={f.exceptionByName} disabled width={FIELD_WIDTH.wide} />
											<Field label={translate("findingExceptionAt")} name={`${form.formUid}_exAt`} value={getFormatDate(f.exceptionAt)} disabled width={FIELD_WIDTH.date} />
										</Group>
										<Group>
											<Field label={translate("findingExceptionUntil")} name={`${form.formUid}_exUntil`}
												value={f.exceptionUntil ? getFormatDate(f.exceptionUntil) : translate("findingExceptionForever")} disabled width={FIELD_WIDTH.date} />
											<QualityChip tone={f.exceptionActive ? "info" : "muted"}>
												{translate(f.exceptionActive ? "findingExceptionActive" : "findingExceptionExpired")}
											</QualityChip>
										</Group>
									</GroupCol>
								) : (
									<span className={styles.Empty}>{translate("findingNoException")}</span>
								)}
							</fieldset>
						</GroupCol>
					</div>
					<GroupCol className={main.FormNotice}>
						<Notice items={notices} />
					</GroupCol>
				</div>
			),
		},
		{
			id: "tab-objects", label: translate("findingObjectsTab"), component: (
				<div className={styles.Stack}>
					<h4 className={styles.StackTitle}>{translate("findingObjectsTitle")}</h4>
					<Table {...buildStaticTableProps({
						componentName: "CheckFindingObjects", rows: objRows, columns: objCols, setColumns: setObjCols,
						fitHeight: true, emptyText: translate("findingNoObjects"), renderCell: renderIdCell,
					})} />
					<h4 className={styles.StackTitle}>{translate("findingDocumentsTitle")}</h4>
					<Table {...buildStaticTableProps({
						componentName: "CheckFindingDocuments", rows: docRows, columns: docCols, setColumns: setDocCols,
						fitHeight: true, emptyText: translate("findingNoDocuments"), renderCell: renderIdCell,
					})} />
				</div>
			),
		},
		{
			id: "tab-raw", label: translate("findingDetailsTab"), component: (
				<div className={styles.Pane}>
					{f.details
						? <pre className={styles.Details}>{f.details}</pre>
						: <span className={styles.Empty}>{translate("findingNoDetails")}</span>}
				</div>
			),
		},
	], [f, form.formUid, notices, objRows, objCols, docRows, docCols, renderIdCell]);

	// Задача — сводная на проверку у клиента (решено 25.09): одна задача на сотни находок одной проверки
	// читается, а сотня задач — нет. Кнопка открывает сводную.
	const actions = (
		<>
			{f.todoUuid && (
				<Button onClick={() => void openFormByEndpoint("todos", f.todoUuid, addPane)} title={translate("findingOpenTaskHint")}>
					{translate("findingOpenTask")}
				</Button>
			)}
			{f.canDecide && f.state !== "resolved" && !f.exceptionActive && (
				<Button onClick={() => setShowException(true)}>{translate("findingExceptionSet")}</Button>
			)}
			{f.canDecide && !!f.exceptionAt && (
				<Button onClick={() => void clearException()}>{translate("findingExceptionClear")}</Button>
			)}
		</>
	);

	return (
		<>
			<ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
				onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
				readonly afterCloseButtons={actions} />
			{showException && f.uuid && (
				<FindingExceptionModal findingUuid={f.uuid} onClose={() => setShowException(false)} onDone={() => void refreshAll()} />
			)}
		</>
	);
};
CheckFindingsForm.displayName = "CheckFindingsForm";

// ═══════════════════════════════════════════════════════════════════════════
// Журнал прогонов
// ═══════════════════════════════════════════════════════════════════════════

export const CheckRunsList: FC<ListProps> = ({ variant, data }) => {
	const [filter, setFilter] = useState<RunsFilter>(() => ({
		...EMPTY_RUNS_FILTER,
		...pickRunsFilter(data as Record<string, unknown> | undefined),
		...(consumePaneFilter<Partial<RunsFilter>>(RUNS_FILTER_KEY) ?? {}),
	}));
	useEffect(() => subscribePaneFilter<Partial<RunsFilter>>(RUNS_FILTER_KEY, (f) => setFilter({ ...EMPTY_RUNS_FILTER, ...f })), []);
	const query = useMemo(() => runsQuery(filter), [filter]);

	const renderCell = useCallback((row: TDataItem, col: TColumn) => {
		switch (col.identifier) {
			case "checkTitle": return <span>{checkLabel(asText(row.checkCode), asText(row.checkTitle))}</span>;
			case "status": return <QualityChip tone={runStatusTone(asText(row.status))}>{runStatusLabel(asText(row.status))}</QualityChip>;
			case "checkRunFound": return <span>{asText(row.total)}</span>;
			default: return undefined;
		}
	}, []);

	const toolbar = (
		<>
			<LookupField name="check_runs_org" endpoint="organizations" value={filter.organizationUuid} displayValue={filter.organizationName}
				onSelect={(uuid, display) => setFilter((prev) => ({ ...prev, organizationUuid: uuid, organizationName: uuid ? display : "" }))}
				placeholder={translate("organization")} allowCreate={false} visibleActions={["quickselect", "list", "clear"]} width={FIELD_WIDTH.wide} />
			<FieldSelect name="check_runs_status" size="sm" value={filter.status} options={runStatusOptions()}
				onChange={(e) => setFilter((prev) => ({ ...prev, status: e.target.value as RunStatus | "" }))} />
		</>
	);

	return (
		<>
			<Notice items={[{ type: "info", text: translate("checkRunsInfo") }]} />
			<ModelList endpoint={RUNS_ENDPOINT} listName={RUNS_LIST} columnsJson={runsColumnsJson} FormComponent={CheckRunForm}
				getLabel={(d) => checkLabel(asText(d?.checkCode), asText(d?.checkTitle))} variant={variant}
				defaultSort={{ createdAt: "desc" }} hideAddDelete
				extraQueryParams={query.extraQueryParams} extraFilter={query.extraFilter}
				renderCell={renderCell} extraButtons={toolbar} />
		</>
	);
};
CheckRunsList.displayName = "CheckRunsList";

/**
 * Карточка прогона — только чтение, из строки журнала (отдельного GET у прогона нет): длинный
 * текст отказа 1С в ячейке не прочитать. Отсюда же — находки этой проверки у клиента.
 */
export const CheckRunForm: FC<Partial<TPane>> = ({ uniqId, data }) => {
	const { addPane, requestClose } = useAppContext().windows;
	const run = useMemo(() => (data ?? {}) as Partial<CheckRun>, [data]);
	const summary = useMemo(() => run.summary ?? {}, [run]);
	const name = `check_run_${asText(run.uuid)}`;

	const openFindings = useCallback(() => {
		const f: Partial<FindingsFilter> = {
			organizationUuid: asText(run.organizationUuid), organizationName: asText(run.organizationName),
			checkCode: asText(run.checkCode), state: "all",
		};
		requestPaneFilter(FINDINGS_FILTER_KEY, f);
		addPane({ component: CheckFindingsList, label: translate(FINDINGS_LIST), data: f as Partial<TDataItem> });
	}, [addPane, run.organizationUuid, run.organizationName, run.checkCode]);

	const tabs = useMemo(() => [{
		id: "tab-run", label: translate("general"), component: (
			<div className={main.FormWrapper}>
				<div className={main.Form}>
					<GroupCol>
						<div className={styles.Chips}>
							{run.status && <QualityChip tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</QualityChip>}
							{run.truncated && <QualityChip tone="warn">{translate("truncated")}</QualityChip>}
						</div>
						<Group>
							<Field label={translate("organization")} name={`${name}_org`} value={asText(run.organizationName)} disabled minWidth={FIELD_WIDTH.lg} />
						</Group>
						<Group>
							<Field label={translate("checkTitle")} name={`${name}_check`} value={checkLabel(asText(run.checkCode), asText(run.checkTitle))} disabled minWidth={FIELD_WIDTH.lg} />
							<Field label={translate("checkCode")} name={`${name}_code`} value={asText(run.checkCode)} disabled width={FIELD_WIDTH.wide} />
						</Group>
						<Group>
							<Field label={translate("createdAt")} name={`${name}_at`} value={getFormatDate(asText(run.createdAt))} disabled width={FIELD_WIDTH.date} />
							<Field label={translate("durationMs")} name={`${name}_ms`} value={asText(run.durationMs)} disabled width={FIELD_WIDTH.sm} />
						</Group>
						<Group>
							<Field label={translate("checkRunFound")} name={`${name}_total`} value={asText(run.total)} disabled width={FIELD_WIDTH.sm} />
							<Field label={translate("findingSeverityError")} name={`${name}_err`} value={asText(summary.error ?? "")} disabled width={FIELD_WIDTH.sm} />
							<Field label={translate("findingSeverityWarning")} name={`${name}_warn`} value={asText(summary.warning ?? "")} disabled width={FIELD_WIDTH.sm} />
							<Field label={translate("findingSeverityInfo")} name={`${name}_info`} value={asText(summary.info ?? "")} disabled width={FIELD_WIDTH.sm} />
						</Group>
						{(run.errorCode || run.errorMessage) && (
							<Group>
								<Field label={translate("errorCode")} name={`${name}_ecode`} value={asText(run.errorCode)} disabled width={FIELD_WIDTH.wide} />
							</Group>
						)}
						{run.errorMessage && (
							<Group>
								<FieldTextarea label={translate("errorMessage")} name={`${name}_emsg`} value={asText(run.errorMessage)} disabled minWidth={FIELD_WIDTH.lg} rows={4} />
							</Group>
						)}
						{run.skipReason && (
							<Group>
								<FieldTextarea label={translate("skipReason")} name={`${name}_skip`} value={asText(run.skipReason)} disabled minWidth={FIELD_WIDTH.lg} rows={2} />
							</Group>
						)}
						{!run.uuid && <span className={styles.Empty}>{translate("checkRunNoData")}</span>}
					</GroupCol>
				</div>
			</div>
		),
	}], [run, summary, name]);

	return (
		<ModelForm paneId={uniqId} tabs={tabs} onSave={() => undefined} onSaveAndClose={() => undefined}
			onClose={() => { if (uniqId) void requestClose(uniqId); }} isLoading={false} readonly
			afterCloseButtons={run.organizationUuid ? <Button onClick={openFindings}>{translate("checkRunShowFindings")}</Button> : undefined} />
	);
};
CheckRunForm.displayName = "CheckRunForm";

