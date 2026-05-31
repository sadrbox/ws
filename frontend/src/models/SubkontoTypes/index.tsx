/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Справочник «Виды субконто» (типы аналитики проводок).
 * Новые виды добавляются записями — структура таблиц не меняется.
 */
import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Field, FieldNumber } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import columnsJson from "./columns.json";

interface TFields {
  id?: number; uuid?: string;
  code: string; name: string;
  referenceEndpoint: string; referenceModel: string;
  isActive: boolean; sortOrder: string;
}

const DEFAULT_FIELDS: TFields = {
  code: "", name: "", referenceEndpoint: "", referenceModel: "", isActive: true, sortOrder: "0",
};

const ENDPOINT = "subkonto-types";

const SubkontoTypesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("SubkontoType");

  const form = useFormStore<TFields>({
    endpoint: ENDPOINT,
    storageKey: "subkonto-types-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      code: d.code ?? "",
      name: d.name ?? "",
      referenceEndpoint: d.referenceEndpoint ?? "",
      referenceModel: d.referenceModel ?? "",
      isActive: d.isActive !== false,
      sortOrder: d.sortOrder != null ? String(d.sortOrder) : "0",
    }),
    buildPayload: (fd) => {
      if (!fd.code?.trim()) return "Код обязателен";
      if (!fd.name?.trim()) return "Наименование обязательно";
      return {
        code: fd.code.trim(),
        name: fd.name.trim(),
        referenceEndpoint: fd.referenceEndpoint?.trim() || null,
        referenceModel: fd.referenceModel?.trim() || null,
        isActive: fd.isActive === true,
        sortOrder: fd.sortOrder ? parseInt(fd.sortOrder, 10) || 0 : 0,
      };
    },
    buildPaneLabel: (saved) => makePaneLabel("SubkontoTypesList", "Виды субконто", saved),
  });

  const tabs = useMemo(() => [{
    id: "tab-details",
    label: translate("general"),
    component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          <GroupCol>
            <GroupRow>
              <Field label={translate("code")} name={`${form.formUid}_code`} value={form.fields.code} onChange={e => form.setField("code", e.target.value)} disabled={form.isLoading} width="180px" />
              <Field label={translate("name")} name={`${form.formUid}_name`} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} minWidth="260px" />
            </GroupRow>
            <GroupRow>
              <Field label={translate("subkontoReferenceEndpoint")} name={`${form.formUid}_refEndpoint`} value={form.fields.referenceEndpoint} onChange={e => form.setField("referenceEndpoint", e.target.value)} disabled={form.isLoading} width="200px" placeholder="products" />
              <Field label={translate("subkontoReferenceModel")} name={`${form.formUid}_refModel`} value={form.fields.referenceModel} onChange={e => form.setField("referenceModel", e.target.value)} disabled={form.isLoading} width="200px" placeholder="product" />
            </GroupRow>
            <GroupRow>
              <FieldNumber label={translate("sortOrder")} name={`${form.formUid}_sortOrder`} value={form.fields.sortOrder} onChange={e => form.setField("sortOrder", e.target.value)} disabled={form.isLoading} width="120px" />
              <FieldToggle name={`${form.formUid}_isActive`} label={translate("isActive")} value={form.fields.isActive === true} onChange={(v) => form.setField("isActive", v)} disabled={form.isLoading || !canWrite} variant="success" />
            </GroupRow>
          </GroupCol>
        </div>
      </div>
    ),
  }], [form.fields, form.formUid, form.isLoading, form.setField, canWrite]);

  return (
    <FormRequiredScope requiredKeys={["code", "name"]}>
      <FormDirtyScope dirtyKeys={form.unsavedFields}>
        <ModelForm
          paneId={form.paneId} tabs={tabs}
          onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
          onReload={form.isEditMode ? form.handleReload : undefined}
          isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
          readonly={!canWrite}
        />
      </FormDirtyScope>
    </FormRequiredScope>
  );
};
SubkontoTypesForm.displayName = "SubkontoTypesForm";

const SubkontoTypesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={ENDPOINT} listName="SubkontoTypesList" columnsJson={columnsJson} FormComponent={SubkontoTypesForm}
    getLabel={(d) => (d?.name ? String(d.name) : "?")}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ sortOrder: "asc" }}
  />
);
SubkontoTypesList.displayName = "SubkontoTypesList";

export { SubkontoTypesList, SubkontoTypesForm };
