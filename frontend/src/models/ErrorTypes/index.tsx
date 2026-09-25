/**
 * Справочник типовых ошибок (E17 СК1.5): по типу ошибки ловится повтор уже разобранной ошибки
 * сотрудником (п. 6 стандарта).
 *
 * Ведут главбух, руководитель и администратор; остальные видят справочник только для чтения.
 * Роль — по группам сотрудников (useQualityMe), а не по правам на модель.
 */
import { type ComponentType, type FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import { Field, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { GroupCol } from "src/components/UI";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import Notice from "src/components/Notice";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { useQualityMe } from "src/hooks/useQualityMe";
import { asText } from "src/utils/asText";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import QualityListButtons from "src/models/_quality/ListButtons";
import { useQualityListActions } from "src/models/_quality/useQualityListActions";
import columnsJson from "./columns.json";
import main from "src/styles/main.module.scss";

const MODEL_ENDPOINT = "error-types";
const LIST_NAME = "ErrorTypesList";
const FORM_NAME = "ErrorTypesForm";

interface TFields {
	id?: number;
	uuid?: string;
	name: string;
	description: string;
}

const DEFAULT_FIELDS: TFields = { name: "", description: "" };

interface ErrorTypeRecord {
	id?: number;
	uuid?: string;
	name?: string | null;
	description?: string | null;
}

/** Ведут справочник главбух, руководитель и администратор (сервер: canManage || isHead). */
function useCanEditErrorTypes(): boolean {
	const { me, canManage } = useQualityMe();
	return canManage || !!me?.isHead;
}

const ErrorTypesForm: FC<Partial<TPane>> = (paneProps) => {
	const canEdit = useCanEditErrorTypes();
	const form = useFormStore<TFields>({
		endpoint: MODEL_ENDPOINT, storageKey: "error-types-form", defaultFields: DEFAULT_FIELDS, paneProps,
		mapServerToForm: (d: ErrorTypeRecord, prev) => ({
			...(prev ?? DEFAULT_FIELDS), id: d.id, uuid: d.uuid, name: d.name ?? "", description: d.description ?? "",
		}),
		buildPayload: (fd) => (fd.name.trim()
			? { name: fd.name.trim(), description: fd.description.trim() || null }
			: translate("errorTypeNeedName")),
		buildPaneLabel: (saved: LabelSource) => makePaneLabel(LIST_NAME, translate(FORM_NAME), saved),
	});
	const notices = useFormNotices(form);
	const off = form.isLoading || !canEdit;

	const tabs = [{
		id: "tab-details", label: translate("general"), component: (
			<div className={main.FormWrapper}>
				<div className={main.Form}>
					<GroupCol>
						<Field label={translate("name")} name={`${form.formUid}_name`} value={form.fields.name} disabled={off} required
							onChange={(e) => form.setField("name", e.target.value)} minWidth={FIELD_WIDTH.lg} />
						<FieldTextarea label={translate("description")} name={`${form.formUid}_description`} value={form.fields.description}
							disabled={off} onChange={(e) => form.setField("description", e.target.value)} rows={5} minWidth={FIELD_WIDTH.lg}
							hint={translate("errorTypeDescriptionHint")} />
					</GroupCol>
				</div>
				<GroupCol className={main.FormNotice}>
					<Notice items={notices} />
				</GroupCol>
			</div>
		),
	}];

	return (
		<ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs}
			onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
			onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
			readonly={!canEdit} />
	);
};
ErrorTypesForm.displayName = FORM_NAME;

interface ListProps {
	variant?: TTableVariant;
	onSelectItem?: (item: TDataItem) => void;
	extraQueryParams?: Record<string, string>;
}

const ErrorTypesList: FC<ListProps> = ({ variant, onSelectItem, extraQueryParams }) => {
	const canEdit = useCanEditErrorTypes();
	const actions = useQualityListActions(MODEL_ENDPOINT, LIST_NAME, ErrorTypesForm as ComponentType<Record<string, unknown>>);
	const buttons = useMemo(() => (canEdit
		? (selected: TDataItem[]) => (
			<QualityListButtons canAdd canDelete selected={selected} onAdd={() => actions.openNew()} onDelete={actions.deleteRows} />
		)
		: undefined), [canEdit, actions]);

	return (
		<ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson}
			FormComponent={ErrorTypesForm as ComponentType<Record<string, unknown>>}
			getLabel={(d) => asText(d?.name).slice(0, 50) || "?"} variant={variant} onSelectItem={onSelectItem}
			extraQueryParams={extraQueryParams} defaultSort={{ name: "asc" }} hideAddDelete extraButtons={buttons} />
	);
};
ErrorTypesList.displayName = LIST_NAME;

export { ErrorTypesList, ErrorTypesForm };
