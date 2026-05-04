import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";

import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "contacttypes";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  shortName: string;
}

const DEFAULT_FIELDS: TFields = { shortName: "" };

const ContactTypesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("ContactType");

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "contact-types-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      shortName: d.shortName ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      return { shortName: fd.shortName.trim() };
    },
    buildPaneLabel: (saved) => makePaneLabel("ContactTypesList", "Типы контактов", saved),
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general"), component: (
        <div className={styles.Form}>
          {form.isEditMode && (
            <GroupRow>
            </GroupRow>
          )}
          <GroupCol>
            <Field label="Наименование *" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
          </GroupCol>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
     
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};
ContactTypesForm.displayName = "ContactTypesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const ContactTypesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName="ContactTypesList"
    columnsJson={columnsJson}
    FormComponent={ContactTypesForm}
    getLabel={(d) => String(d?.shortName || "")}
    variant={variant}
    onSelectItem={onSelectItem}
  />
);

ContactTypesList.displayName = "ContactTypesList";
export { ContactTypesList, ContactTypesForm };
