/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Справочник «План счетов» (ChartOfAccount). Поддерживает до трёх субконто.
 * Виды субконто загружаются из справочника /subkonto-types (расширяемо).
 */
import { FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { Field, FieldSelect, FieldTextarea } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import columnsJson from "./columns.json";

interface TFields {
  id?: number; uuid?: string;
  code: string; name: string; accountType: string; description: string;
  parentUuid: string; parentName: string;
  isActive: boolean; isCurrency: boolean; isQuantitative: boolean; isOffBalance: boolean;
  subkonto1Type: string; subkonto2Type: string; subkonto3Type: string;
}

const DEFAULT_FIELDS: TFields = {
  code: "", name: "", accountType: "active", description: "",
  parentUuid: "", parentName: "",
  isActive: true, isCurrency: false, isQuantitative: false, isOffBalance: false,
  subkonto1Type: "", subkonto2Type: "", subkonto3Type: "",
};

const ENDPOINT = "chart-of-accounts";

function useSubkontoOptions() {
  const { data } = useQuery<{ value: string; label: string }[]>({
    queryKey: ["subkonto-types-options"],
    queryFn: async () => {
      const resp = await api.get<any>("subkonto-types", { params: { limit: 200 } });
      const items = resp?.items ?? [];
      return [{ value: "", label: "—" }, ...items.map((t: any) => ({ value: t.code, label: t.name }))];
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? [{ value: "", label: "—" }];
}

const ChartOfAccountsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useUserAccessRight("ChartOfAccount");
  const subkontoOptions = useSubkontoOptions();

  const accountTypeOptions = [
    { value: "active", label: translate("accountTypeActive") },
    { value: "passive", label: translate("accountTypePassive") },
    { value: "active-passive", label: translate("accountTypeActivePassive") },
  ];

  const form = useFormStore<TFields>({
    endpoint: ENDPOINT,
    storageKey: "chart-of-accounts-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), ...d,
      code: d.code ?? "",
      name: d.name ?? "",
      accountType: d.accountType ?? "active",
      description: d.description ?? "",
      parentUuid: d.parentUuid ?? "",
      parentName: d.parent?.name ? `${d.parent.code} ${d.parent.name}` : "",
      isActive: d.isActive !== false,
      isCurrency: d.isCurrency === true,
      isQuantitative: d.isQuantitative === true,
      isOffBalance: d.isOffBalance === true,
      subkonto1Type: d.subkonto1Type ?? "",
      subkonto2Type: d.subkonto2Type ?? "",
      subkonto3Type: d.subkonto3Type ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.code?.trim()) return "Код счёта обязателен";
      if (!fd.name?.trim()) return "Наименование обязательно";
      return {
        code: fd.code.trim(),
        name: fd.name.trim(),
        accountType: fd.accountType || "active",
        description: fd.description?.trim() || null,
        parentUuid: fd.parentUuid || null,
        isActive: fd.isActive === true,
        isCurrency: fd.isCurrency === true,
        isQuantitative: fd.isQuantitative === true,
        isOffBalance: fd.isOffBalance === true,
        subkonto1Type: fd.subkonto1Type || null,
        subkonto2Type: fd.subkonto2Type || null,
        subkonto3Type: fd.subkonto3Type || null,
      };
    },
    buildPaneLabel: (saved) => makePaneLabel("ChartOfAccountsList", "План счетов", saved),
  });

  const tabs = useMemo(() => [{
    id: "tab-details",
    label: translate("general"),
    component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          <GroupCol>
            <GroupRow>
              <Field label={translate("code")} name={`${form.formUid}_code`} value={form.fields.code} onChange={e => form.setField("code", e.target.value)} disabled={form.isLoading} width="120px" />
              <Field label={translate("name")} name={`${form.formUid}_name`} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} minWidth="320px" />
            </GroupRow>
            <GroupRow>
              <FieldSelect label={translate("accountType")} name={`${form.formUid}_accountType`} options={accountTypeOptions} value={form.fields.accountType} onChange={e => form.setField("accountType", e.target.value)} disabled={form.isLoading} />
              <LookupField label={translate("parentAccount")} name={`${form.formUid}_parent`} value={form.fields.parentUuid} displayValue={form.fields.parentName} endpoint="chart-of-accounts" displayField="name"
                onSelect={(u, d) => form.setFields({ parentUuid: u, parentName: d } as Partial<TFields>)}
                onClear={() => form.setFields({ parentUuid: "", parentName: "" } as Partial<TFields>)}
                disabled={form.isLoading} />
            </GroupRow>
            <Group>
              <FieldSelect label={translate("subkonto1")} name={`${form.formUid}_sub1`} options={subkontoOptions} value={form.fields.subkonto1Type} onChange={e => form.setField("subkonto1Type", e.target.value)} disabled={form.isLoading} />
              <FieldSelect label={translate("subkonto2")} name={`${form.formUid}_sub2`} options={subkontoOptions} value={form.fields.subkonto2Type} onChange={e => form.setField("subkonto2Type", e.target.value)} disabled={form.isLoading} />
              <FieldSelect label={translate("subkonto3")} name={`${form.formUid}_sub3`} options={subkontoOptions} value={form.fields.subkonto3Type} onChange={e => form.setField("subkonto3Type", e.target.value)} disabled={form.isLoading} />
            </Group>
            <GroupRow className={styles.GroupRowWrap}>
              <FieldToggle name={`${form.formUid}_isActive`} label={translate("isActive")} value={form.fields.isActive === true} onChange={(v) => form.setField("isActive", v)} disabled={form.isLoading || !canWrite} variant="success" />
              <FieldToggle name={`${form.formUid}_isCurrency`} label={translate("accountIsCurrency")} value={form.fields.isCurrency === true} onChange={(v) => form.setField("isCurrency", v)} disabled={form.isLoading || !canWrite} variant="primary" />
              <FieldToggle name={`${form.formUid}_isQuantitative`} label={translate("accountIsQuantitative")} value={form.fields.isQuantitative === true} onChange={(v) => form.setField("isQuantitative", v)} disabled={form.isLoading || !canWrite} variant="primary" />
              <FieldToggle name={`${form.formUid}_isOffBalance`} label={translate("accountIsOffBalance")} value={form.fields.isOffBalance === true} onChange={(v) => form.setField("isOffBalance", v)} disabled={form.isLoading || !canWrite} variant="primary" />
            </GroupRow>
            <Group>
              <FieldTextarea label={translate("description")} name={`${form.formUid}_description`} value={form.fields.description} onChange={e => form.setField("description", e.target.value)} disabled={form.isLoading} />
            </Group>
          </GroupCol>
        </div>
      </div>
    ),
  }], [form.fields, form.formUid, form.isLoading, form.setField, form.setFields, canWrite, subkontoOptions]);

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
ChartOfAccountsForm.displayName = "ChartOfAccountsForm";

const ChartOfAccountsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = (
  { variant, onSelectItem, ownerUuid, ownerField }
) => (
  <ModelList
    endpoint={ENDPOINT} listName="ChartOfAccountsList" columnsJson={columnsJson} FormComponent={ChartOfAccountsForm}
    getLabel={(d) => (d?.code ? `${d.code} ${d.name ?? ""}`.trim() : "?")}
    variant={variant} onSelectItem={onSelectItem} ownerUuid={ownerUuid} ownerField={ownerField}
    defaultSort={{ code: "asc" }}
  />
);
ChartOfAccountsList.displayName = "ChartOfAccountsList";

export { ChartOfAccountsList, ChartOfAccountsForm };
