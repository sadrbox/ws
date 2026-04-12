import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "brands";
const LIST_NAME = "BrandsList";

interface TFields { id?: number; uuid?: string; shortName: string; }
const DEFAULT_FIELDS: TFields = { shortName: "" };

const BrandsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Brand");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "brands-form", defaultFields: DEFAULT_FIELDS, paneProps,
    mapServerToForm: (d, prev) => ({ ...(prev ?? DEFAULT_FIELDS), ...d, shortName: d.shortName ?? "" }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      return { shortName: fd.shortName.trim() };
    },
    buildPaneLabel: (saved) => `${translate(LIST_NAME) || "Бренды"}: ${saved.shortName || "?"} • ${saved.id ?? "?"}`,
  });

  const tabs = useMemo(() => [
    { id: "general", label: translate("general") || "Общие сведения", component: (
      <div className={styles.FormBodyParts}>
        <Group align="row" gap="12px" className={styles.Form}>
          <Field label="Наименование *" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
        </Group>
        {form.isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
          <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
          <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
        </div></Group></>}
      </div>
    )},
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField]);

  return (
    <ModelFormWrapper tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading} showReload={form.isEditMode}
      error={form.error} errorRevision={form.errorRevision} onErrorDismiss={() => form.setError(null)} readonly={!canWrite} />
  );
};
BrandsForm.displayName = "BrandsForm";

const BrandsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={BrandsForm}
    getLabel={(d) => d?.shortName as string || "?"} variant={variant} onSelectItem={onSelectItem} />
);
BrandsList.displayName = "BrandsList";
export { BrandsList, BrandsForm };
