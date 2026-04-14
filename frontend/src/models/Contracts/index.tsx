import { FC, useMemo, useCallback } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import FilesPanel from "src/models/Files";
import { Divider, Field, FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

import { useFormStore } from "src/hooks/useFormStore";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "contracts";
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  shortName: string;
  contractNumber: string;
  contractText: string;
  startDate: string;
  endDate: string;
  organizationUuid: string;
  organizationName: string;
  counterpartyUuid: string;
  counterpartyName: string;
}

const DEFAULT_FIELDS: TFields = {
  shortName: "", contractNumber: "", contractText: "",
  startDate: "", endDate: "",
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
};

const ContractsForm: FC<Partial<TPane>> = (paneProps) => {
  const data = paneProps.data;
  const defaultOrg = useDefaultOrganization();

  const initialFields: TFields | undefined = (() => {
    if (!data || data.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data.organizationUuid) {
      init.organizationUuid = data.organizationUuid as string;
      init.organizationName = (data.organizationName as string) || "";
    } else if (defaultOrg.organizationUuid) {
      init.organizationUuid = defaultOrg.organizationUuid;
      init.organizationName = defaultOrg.organizationName;
    }
    if (data.counterpartyUuid) {
      init.counterpartyUuid = data.counterpartyUuid as string;
      init.counterpartyName = (data.counterpartyName as string) || "";
    }
    return init;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "contracts-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      shortName: d.shortName ?? "",
      contractNumber: d.contractNumber ?? "",
      contractText: d.contractText ?? "",
      startDate: d.startDate?.slice(0, 10) ?? "",
      endDate: d.endDate?.slice(0, 10) ?? "",
      organizationUuid: d.organizationUuid ?? prev?.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? prev?.organizationName ?? "",
      counterpartyUuid: d.counterpartyUuid ?? prev?.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.shortName ?? prev?.counterpartyName ?? "",
      id: d.id,
      uuid: d.uuid,
    }),
    buildPayload: (fd) => {
      if (!fd.shortName?.trim()) return "Наименование обязательно";
      return {
        shortName: fd.shortName.trim(),
        contractNumber: fd.contractNumber?.trim() || null,
        contractText: fd.contractText?.trim() || null,
        startDate: fd.startDate || null,
        endDate: fd.endDate || null,
        organizationUuid: fd.organizationUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
      };
    },
    buildPaneLabel: (saved) =>
      `${translate("ContractsList") || "ContractsList"}: ${saved.shortName || saved.contractNumber || "?"} • ${saved.id ?? "?"}`,
  });

  const tabs = useMemo(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general", label: translate("general") || "Общие сведения", component: (
          <div className={styles.FormBodyParts}>
            <Group align="row" gap="12px" className={styles.Form}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                <Field label="Наименование *" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
                <Field label="Номер договора" name={`${form.formUid}_contractNumber`} minWidth="339px" value={form.fields.contractNumber} onChange={e => form.setField("contractNumber", e.target.value)} disabled={form.isLoading} />
                <FieldDate label="Дата начала" name={`${form.formUid}_startDate`} minWidth="200px" value={form.fields.startDate} onChange={e => form.setField("startDate", e.target.value)} disabled={form.isLoading} />
                <FieldDate label="Дата окончания" name={`${form.formUid}_endDate`} minWidth="200px" value={form.fields.endDate} onChange={e => form.setField("endDate", e.target.value)} disabled={form.isLoading} />
                <LookupField label="Организация (владелец)" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} minWidth="339px" />
                <LookupField label="Контрагент" name={`${form.formUid}_cpty`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName" onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)} onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)} disabled={form.isLoading} minWidth="339px" />
              </div>
            </Group>
            {form.isEditMode && (
              <>
                <Divider />
                <Group align="row" gap="12px" className={styles.Form}>
                  <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                    <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                    <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                  </div>
                </Group>
              </>
            )}
          </div>
        ),
      },
    ];
    if (form.isEditMode && form.fields.uuid) {
      t.push({ id: "files", label: translate("files") || "Файлы", component: <FilesPanel ownerType="contract" ownerUuid={form.fields.uuid} /> });
    }
    return t;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields]);

  return (
    <ModelFormWrapper
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      showReload={form.isEditMode}
      error={form.error}
      errorRevision={form.errorRevision}
      onErrorDismiss={() => form.setError(null)}
      isDirty={form.isDirty}
    />
  );
};
ContractsForm.displayName = "ContractsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface ContractsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
  /** Дополнительные query-параметры (от LookupField extraParams) */
  extraParams?: Record<string, string>;
}

const ContractsList: FC<ContractsListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField, extraParams } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ContractsList_part" : "ContractsList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const ownerFilter = useMemo(() => {
    const f: Record<string, { value: unknown; operator: string }> = {};
    if (ownerUuid && ownerField) {
      f[ownerField] = { value: ownerUuid, operator: "equals" };
    }
    // extraParams → превращаем в ownerFilter (напр. organizationUuid=abc → filter)
    if (extraParams) {
      for (const [key, val] of Object.entries(extraParams)) {
        if (val) f[key] = { value: val, operator: "equals" };
      }
    }
    return Object.keys(f).length > 0 ? f : undefined;
  }, [ownerUuid, ownerField, extraParams]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT, componentName, columnsJson,
    defaultSort: { id: "asc" },
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField
      ? { [ownerField]: ownerUuid } as unknown as TDataItem
      : d;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.shortName || d?.contractNumber || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: ContractsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};

ContractsList.displayName = "ContractsList";
export { ContractsList, ContractsForm };
// export default memo(ContractsList);
