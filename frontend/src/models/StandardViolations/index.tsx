/**
 * Реестр нарушений стандарта качества БухПроф (E17 СК5).
 *
 * СПИСОК — все видимые записи: сотрудник видит свои, главбух — своей группы, руководитель и
 * администратор — всех (отбор делает сервер). Быстрые отборы: «Мои», «Решить» (кандидаты и
 * возражения тех, по кому я решаю), статус, месяц бонуса.
 *
 * ФОРМА. Новая запись — ручная фиксация факта главбухом, руководителем или администратором:
 * сотрудник, пункт, дата факта, клиент или участок, суть (правила применения бонуса требуют
 * всё это). Сохранённая — карточка только для чтения: факт, доказательства, решение и история.
 * Правила применения бонуса: один подтверждённый факт — бонус за месяц выявления не начисляется;
 * самовыявленная и своевременно исправленная ошибка нарушением не считается.
 */
import { type ComponentType, type FC, type ReactNode, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate, getLanguage } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import { Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { Button } from "src/components/Button";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice, { type NoticeItem } from "src/components/Notice";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { useQualityMe } from "src/hooks/useQualityMe";
import { asText } from "src/utils/asText";
import { getAppUtcOffset } from "src/utils/datetime";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import { fetchStandardItems, type EvidenceRow, type Violation, type ViolationStatus } from "src/services/quality/api";
import QualityChip from "src/models/_quality/QualityChip";
import QualityListButtons from "src/models/_quality/ListButtons";
import { useQualityListActions } from "src/models/_quality/useQualityListActions";
import { userDisplayName } from "src/models/_quality/people";
import { currentMonth, localYmd, monthLabel, recentMonths } from "src/models/_quality/month";
import ViolationView, { type ViolationViewData } from "./ViolationView";
import {
	VIOLATION_STATUSES, isFutureDate, itemCaption, listFilter, missingViolationFacts, newViolationPayload, scopeQueryParams,
	sourceKey, statusLabel, statusTone, violationArea, type ViolationScope,
} from "./violations";
import columnsJson from "./columns.json";
import main from "src/styles/main.module.scss";
import styles from "./StandardViolations.module.scss";

const MODEL_ENDPOINT = "standard-violations";
const LIST_NAME = "StandardViolationsList";
const FORM_NAME = "StandardViolationsForm";

/** Смещение местного времени приложения, минут: текущий месяц и «сегодня» — местные. */
const offsetMinutes = () => getAppUtcOffset() * 60;

interface TFields extends Omit<ViolationViewData, "uuid"> {
	id?: number;
	uuid?: string;
	// ── Ввод новой записи ──
	userUuid: string;
	clientOrganizationUuid: string;
	area: string;
}

const DEFAULT_FIELDS: TFields = {
	userUuid: "", userName: "", itemNumber: "", itemTitle: "", occurredAt: "",
	clientOrganizationUuid: "", clientName: "", area: "", description: "",
	// Ручная запись руководителя по умолчанию — подтверждённая (так же решает сервер).
	status: "confirmed" as ViolationStatus,
	detectedAt: "", bonusMonth: "", evidence: [], source: "", selfDetected: false,
	createdByName: "", decidedByName: "", decidedAt: "", decisionNote: "",
	disputeText: "", disputedAt: "", disputeDecision: "", disputeDecidedByName: "", disputeDecidedAt: "",
	canDecide: false, isMine: false,
};

type ViolationRecord = Partial<Violation> & { disputeDecidedAt?: string | null };

/** Подпись записи: сотрудник и пункт — по ним запись узнают в списке вкладок. */
const recordCaption = (d: Record<string, unknown> | undefined): string =>
	[asText(d?.userName), itemCaption(d?.itemNumber)].filter(Boolean).join(" · ");

// ═══════════════════════════════════════════════════════════════════════════
// ФОРМА
// ═══════════════════════════════════════════════════════════════════════════

const StandardViolationsForm: FC<Partial<TPane>> = (paneProps) => {
	const [actionNotices, setActionNotices] = useState<NoticeItem[]>([]);

	const form = useFormStore<TFields>({
		endpoint: MODEL_ENDPOINT, storageKey: "standard-violations-form", defaultFields: DEFAULT_FIELDS, paneProps,
		mapServerToForm: (d: ViolationRecord, prev) => ({
			...(prev ?? DEFAULT_FIELDS),
			id: d.id, uuid: d.uuid,
			userUuid: d.userUuid ?? "", userName: d.userName ?? "",
			itemNumber: d.itemNumber != null ? String(d.itemNumber) : "", itemTitle: d.itemTitle ?? "",
			// Даты записи — как их отдал сервер (ISO): карточка форматирует их сама.
			occurredAt: d.occurredAt ?? "", detectedAt: d.detectedAt ?? "", bonusMonth: d.bonusMonth ?? "",
			clientOrganizationUuid: d.clientOrganizationUuid ?? "", clientName: d.clientName ?? "",
			area: violationArea(d.evidence),
			description: d.description ?? "",
			evidence: Array.isArray(d.evidence) ? d.evidence : [],
			source: d.source ?? "", status: d.status ?? "candidate", selfDetected: !!d.selfDetected,
			createdByName: d.createdByName ?? "", decidedByName: d.decidedByName ?? "", decidedAt: d.decidedAt ?? "",
			decisionNote: d.decisionNote ?? "", disputeText: d.disputeText ?? "", disputedAt: d.disputedAt ?? "",
			disputeDecision: d.disputeDecision ?? "", disputeDecidedByName: d.disputeDecidedByName ?? "",
			disputeDecidedAt: d.disputeDecidedAt ?? "",
			// Признаки решения отдаёт только GET /:id. Ответ на создание их не несёт, но завести запись
			// сервер дал именно тому, кто решает по этому сотруднику, — значит, и решать ему.
			canDecide: d.canDecide ?? !prev?.uuid,
			isMine: d.isMine ?? false,
		}),
		buildPayload: (fd) => {
			const missing = missingViolationFacts(fd);
			if (missing.length) return `${translate("violationNeedFacts")}: ${missing.map((k) => translate(k)).join(", ")}`;
			if (isFutureDate(fd.occurredAt, localYmd(offsetMinutes()))) return translate("violationOccurredInFuture");
			return newViolationPayload(fd);
		},
		buildPaneLabel: (saved: LabelSource) => makePaneLabel(LIST_NAME, translate(FORM_NAME), saved, recordCaption(saved) || undefined),
	});

	const formNotices = useFormNotices(form);
	const notices = useMemo(() => [...formNotices, ...actionNotices], [formNotices, actionNotices]);

	// Пункты стандарта — только для новой записи (у сохранённой пункт показан подписью).
	const itemsQ = useQuery({
		queryKey: ["standard-items", "options"],
		queryFn: async () => (await fetchStandardItems()).items ?? [],
		enabled: !form.isEditMode,
		staleTime: 60_000,
	});
	const itemOptions = useMemo(() => [
		{ value: "", label: translate("violationPickItem") },
		// Выключенный пункт фирма не применяет — в выбор его не даём (кроме уже выбранного).
		...(itemsQ.data ?? [])
			.filter((i) => i.isActive || String(i.number) === form.fields.itemNumber)
			.map((i) => ({ value: String(i.number), label: `${i.number}. ${i.title}` })),
	], [itemsQ.data, form.fields.itemNumber]);
	const pickedItem = (itemsQ.data ?? []).find((i) => String(i.number) === form.fields.itemNumber);

	const { store, loadFromServer } = form;
	const reload = useCallback(async () => {
		const uuid = store.getSnapshot().meta.uuid;
		if (uuid) await loadFromServer(uuid, { noCache: true });
	}, [store, loadFromServer]);

	const f = form.fields;
	const off = form.isLoading;

	const createFields = (
		<GroupCol>
			<Group>
				<FormLookup form={form} field="user" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
					label={translate("violationFieldEmployee")} minWidth={FIELD_WIDTH.lg} required allowCreate={false}
					onSelect={(uuid, display, item) => form.setFields({ userUuid: uuid, userName: uuid ? userDisplayName(item, display) : "" })} />
			</Group>
			<Group>
				<FieldSelect label={translate("violationFieldItem")} name={`${form.formUid}_itemNumber`} value={f.itemNumber}
					options={itemOptions} disabled={off} required
					onChange={(e) => form.setField("itemNumber", e.target.value)} />
			</Group>
			{pickedItem?.text && <div className={styles.ItemText}>{pickedItem.text}</div>}
			<Group>
				<FieldDate label={translate("violationFieldOccurredAt")} name={`${form.formUid}_occurredAt`} width={FIELD_WIDTH.date}
					value={f.occurredAt} onChange={(e) => form.setField("occurredAt", e.target.value)} disabled={off} required
					hint={translate("violationOccurredAtHint")} />
				<FieldSelect label={translate("status")} name={`${form.formUid}_status`} value={f.status} disabled={off}
					onChange={(e) => form.setField("status", e.target.value as ViolationStatus)}
					hint={translate("violationNewStatusHint")}
					options={[
						{ value: "confirmed", label: statusLabel("confirmed") },
						{ value: "candidate", label: statusLabel("candidate") },
					]} />
			</Group>
			<Group>
				<FormLookup form={form} field="clientOrganization" uuidField="clientOrganizationUuid" nameField="clientName"
					endpoint="organizations" label={translate("clientName")} minWidth={FIELD_WIDTH.md} allowCreate={false} />
				<Field label={translate("violationFieldArea")} name={`${form.formUid}_area`} value={f.area} disabled={off}
					onChange={(e) => form.setField("area", e.target.value)} minWidth={FIELD_WIDTH.md}
					hint={translate("violationAreaHint")} />
			</Group>
			<FieldTextarea label={translate("violationFieldDescription")} name={`${form.formUid}_description`} value={f.description}
				onChange={(e) => form.setField("description", e.target.value)} disabled={off} required rows={5}
				hint={translate("violationDescriptionHint")} />
		</GroupCol>
	);

	const view = form.isEditMode && f.uuid ? (
		<ViolationView v={{ ...f, uuid: f.uuid }} formUid={form.formUid} disabled={off} source={translate(FORM_NAME)}
			onReload={reload} onNotices={setActionNotices} />
	) : null;

	const tabs = [{
		id: "tab-details", label: translate("general"), component: (
			<div className={main.FormWrapper}>
				<div className={main.Form}>{view ?? createFields}</div>
				<GroupCol className={main.FormNotice}>
					<Notice items={notices} />
				</GroupCol>
			</div>
		),
	}];

	// Сохранённая запись не правится: факт спорят возражением, а не правкой (см. ViolationView).
	return (
		<ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={f.uuid} tabs={tabs}
			onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
			onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
			readonly={form.isEditMode} />
	);
};
StandardViolationsForm.displayName = FORM_NAME;

// ═══════════════════════════════════════════════════════════════════════════
// СПИСОК
// ═══════════════════════════════════════════════════════════════════════════

const renderCell = (row: TDataItem, col: TColumn): ReactNode | undefined => {
	switch (col.identifier) {
		case "itemNumber":
			return <span title={asText(row.itemTitle)}>{itemCaption(row.itemNumber, row.itemTitle)}</span>;
		case "status":
			return <QualityChip tone={statusTone(row.status)}>{statusLabel(row.status)}</QualityChip>;
		case "source":
			return <span title={asText(row.source)}>{translate(sourceKey(row.source))}</span>;
		case "clientName":
			// Клиента нет — нарушение по участку работы: он записан в доказательствах.
			return <span>{asText(row.clientName) || violationArea(row.evidence as EvidenceRow[] | undefined) || "—"}</span>;
		default:
			return undefined;
	}
};

interface ListProps {
	variant?: TTableVariant;
	onSelectItem?: (item: TDataItem) => void;
	extraQueryParams?: Record<string, string>;
}

const StandardViolationsList: FC<ListProps> = ({ variant, onSelectItem, extraQueryParams }) => {
	const { me } = useQualityMe();
	const [scope, setScope] = useState<ViolationScope>("");
	const [status, setStatus] = useState("");
	const [month, setMonth] = useState("");
	const months = useMemo(() => recentMonths(12, currentMonth(offsetMinutes())), []);
	const actions = useQualityListActions(MODEL_ENDPOINT, LIST_NAME, StandardViolationsForm as ComponentType<Record<string, unknown>>);

	const queryParams = useMemo(() => {
		const scoped = scopeQueryParams(scope);
		return extraQueryParams || scoped ? { ...(extraQueryParams ?? {}), ...(scoped ?? {}) } : undefined;
	}, [extraQueryParams, scope]);
	const filter = useMemo(() => listFilter(status, month), [status, month]);

	// Заводит нарушение тот, кто решает (главбух, руководитель, администратор); удаляет ошибочную
	// запись только администратор — обычный путь «отклонить с причиной».
	const canAdd = !!me?.canDecide;
	const canDelete = !!me?.isAdmin;
	const toggle = (next: ViolationScope) => setScope((s) => (s === next ? "" : next));

	const filters = (
		<>
			<Button active={scope === "mine"} onClick={() => toggle("mine")} title={translate("violationScopeMineHint")}>
				{translate("violationScopeMine")}
			</Button>
			{me?.canDecide && (
				<Button active={scope === "toDecide"} onClick={() => toggle("toDecide")} title={translate("violationScopeToDecideHint")}>
					{translate("violationScopeToDecide")}
				</Button>
			)}
			<FieldSelect name="standard_violations_status" size="sm" value={status} onChange={(e) => setStatus(e.target.value)}
				options={[
					{ value: "", label: translate("violationAllStatuses") },
					...VIOLATION_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
				]} />
			<FieldSelect name="standard_violations_month" size="sm" value={month} onChange={(e) => setMonth(e.target.value)}
				options={[
					{ value: "", label: translate("violationAllMonths") },
					...months.map((m) => ({ value: m, label: monthLabel(m, getLanguage()) })),
				]} />
		</>
	);

	const buttons = canDelete
		? (selected: TDataItem[]) => (
			<QualityListButtons canAdd={canAdd} canDelete selected={selected} onAdd={() => actions.openNew()} onDelete={actions.deleteRows}>
				{filters}
			</QualityListButtons>
		)
		: <QualityListButtons canAdd={canAdd} canDelete={false} onAdd={() => actions.openNew()}>{filters}</QualityListButtons>;

	return (
		<ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson}
			FormComponent={StandardViolationsForm as ComponentType<Record<string, unknown>>}
			getLabel={(d) => recordCaption(d) || "?"} variant={variant} onSelectItem={onSelectItem}
			extraQueryParams={queryParams} extraFilter={filter} defaultSort={{ detectedAt: "desc" }}
			renderCell={renderCell} renderPreviewValue={renderCell} hideAddDelete extraButtons={buttons} />
	);
};
StandardViolationsList.displayName = LIST_NAME;

export { StandardViolationsList, StandardViolationsForm };
