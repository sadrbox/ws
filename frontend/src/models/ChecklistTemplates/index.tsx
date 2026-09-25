/**
 * Шаблоны чек-листов самопроверки (E17 СК3.1, пп. 26–28 стандарта).
 *
 * Шаблон — упорядоченные пункты; у пункта может быть привязка к проверке учёта в 1С и к пункту
 * стандарта. По шаблону создаются чек-листы по клиентам за период (раздел «Чек-листы»).
 * Ведут шаблоны главбух, руководитель или администратор; сервер проверяет это сам, панель лишь
 * прячет кнопки (useQualityMe), права на модели у E17 нет.
 */
import { FC, useMemo, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import ModelList from "src/components/ModelList";
import ModelForm from "src/components/ModelForm";
import Notice from "src/components/Notice";
import { Field, FieldSelect, FieldTextarea } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { useFormStore } from "src/hooks/useFormStore";
import { useFormNotices } from "src/hooks/useFormNotices";
import { useQualityMe } from "src/hooks/useQualityMe";
import { fetchStandardItems, type ChecklistTemplate } from "src/services/quality/api";
import { makePaneLabel, type LabelSource } from "src/utils/buildPaneLabel";
import { asText } from "src/utils/asText";
import { translate } from "src/i18";
import { useQualityListActions } from "src/models/_quality/useQualityListActions";
import { QualityListButtons } from "src/models/_quality/ListButtons";
import { ChecklistItemsEditor } from "./ItemsEditor";
import { PERIODICITIES, draftsToPayload, itemsErrorText, periodicityLabel, toDrafts, type TemplateItemDraft } from "./templateItems";
import columnsJson from "./columns.json";
import main from "src/styles/main.module.scss";

const MODEL_ENDPOINT = "checklist-templates";
const LIST_NAME = "ChecklistTemplatesList";

interface TFields {
	id?: number;
	uuid?: string;
	name: string;
	description: string;
	periodicity: string;
	isActive: boolean;
	items: TemplateItemDraft[];
	canEdit: boolean;
}

const DEFAULT_FIELDS: TFields = { name: "", description: "", periodicity: "month", isActive: true, items: [], canEdit: false };

/** Шаблоны ведут главбух, руководитель, администратор (canEditTemplates на сервере). */
function useMayEditTemplates(): boolean {
	const { me } = useQualityMe();
	return !!me && (me.canManage || me.isHead);
}

export const ChecklistTemplatesForm: FC<Partial<TPane>> = (paneProps) => {
	const mayEdit = useMayEditTemplates();
	const standard = useQuery({
		queryKey: ["quality", "standard-items"],
		queryFn: async () => (await fetchStandardItems()).items ?? [],
		staleTime: 5 * 60_000,
	});

	const form = useFormStore<TFields>({
		endpoint: MODEL_ENDPOINT, storageKey: "checklist-templates-form", paneProps, defaultFields: DEFAULT_FIELDS,
		mapServerToForm: (d: ChecklistTemplate, prev) => ({
			...(prev ?? DEFAULT_FIELDS),
			id: d.id, uuid: d.uuid,
			name: d.name ?? "", description: d.description ?? "",
			periodicity: d.periodicity ?? "month", isActive: d.isActive !== false,
			items: toDrafts(d.items),
			// После записи сервер отдаёт шаблон без canEdit — прежнее значение не теряем.
			canEdit: d.canEdit ?? prev?.canEdit ?? false,
		}),
		buildPayload: (fd) => {
			if (!fd.name.trim()) return translate("checklistTplNameRequired");
			const items = draftsToPayload(fd.items);
			if (!items.ok) return itemsErrorText(items);
			return {
				name: fd.name.trim(),
				description: fd.description.trim() || null,
				periodicity: fd.periodicity,
				isActive: fd.isActive,
				items: items.items,
			};
		},
		buildPaneLabel: (saved: LabelSource) => makePaneLabel(LIST_NAME, translate("ChecklistTemplatesForm"), saved),
	});
	const f = form.fields;
	const notices = useFormNotices(form);
	const readonly = !(f.canEdit || mayEdit);
	const disabled = form.isLoading || readonly;
	const periodicityOptions = useMemo(() => PERIODICITIES.map((p) => ({ value: p, label: periodicityLabel(p) })), []);

	const tabs = useMemo(() => [
		{
			id: "tab-details", label: translate("general"), component: (
				<div className={main.FormWrapper}>
					<div className={main.Form}>
						<GroupCol>
							<Group>
								<Field label={translate("name")} name={`${form.formUid}_name`} value={f.name} required
									onChange={(e) => form.setField("name", e.target.value)} disabled={disabled} minWidth={FIELD_WIDTH.lg} />
							</Group>
							<Group>
								<FieldSelect label={translate("periodicity")} name={`${form.formUid}_periodicity`} value={f.periodicity} options={periodicityOptions}
									onChange={(e) => form.setField("periodicity", e.target.value)} disabled={disabled}
									hint={translate("checklistTplPeriodicityHint")} />
								<FieldToggle label={translate("isActive")} value={f.isActive} onChange={(v) => form.setField("isActive", v)} disabled={disabled} />
							</Group>
							<Group>
								<FieldTextarea label={translate("description")} name={`${form.formUid}_description`} value={f.description}
									onChange={(e) => form.setField("description", e.target.value)} disabled={disabled} minWidth={FIELD_WIDTH.lg} rows={4} />
							</Group>
						</GroupCol>
					</div>
					<GroupCol className={main.FormNotice}>
						<Notice items={notices} />
						{readonly && !form.isLoading && <Notice items={[{ type: "info", text: translate("checklistTplReadonlyInfo") }]} />}
					</GroupCol>
				</div>
			),
		},
		{
			id: "tab-items", label: `${translate("checklistTplItemsTab")} (${f.items.length})`, component: (
				<ChecklistItemsEditor items={f.items} onChange={(items) => form.setField("items", items)} disabled={disabled}
					standardItems={standard.data} namePrefix={form.formUid} />
			),
		},
	], [f, form, disabled, readonly, notices, periodicityOptions, standard.data]);

	return (
		<ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
			onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
			readonly={readonly} />
	);
};
ChecklistTemplatesForm.displayName = "ChecklistTemplatesForm";

export const ChecklistTemplatesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => {
	const mayEdit = useMayEditTemplates();
	const { openNew, deleteRows } = useQualityListActions(MODEL_ENDPOINT, LIST_NAME, ChecklistTemplatesForm as ComponentType<Record<string, unknown>>);
	return (
		<ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={ChecklistTemplatesForm}
			getLabel={(d) => asText(d?.name).slice(0, 50) || "?"} variant={variant} onSelectItem={onSelectItem}
			defaultSort={{ name: "asc" }} hideAddDelete
			renderCell={(row: TDataItem, col: TColumn) => (col.identifier === "periodicity" ? <span>{periodicityLabel(asText(row.periodicity))}</span> : undefined)}
			extraButtons={mayEdit && !onSelectItem
				? (selected: TDataItem[]) => <QualityListButtons canAdd canDelete selected={selected} onAdd={() => openNew()} onDelete={deleteRows} />
				: undefined} />
	);
};
ChecklistTemplatesList.displayName = "ChecklistTemplatesList";
