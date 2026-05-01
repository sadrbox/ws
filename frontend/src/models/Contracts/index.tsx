import { FC, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import FilesPanel from "src/components/FilesPanel";
import PrintPreview from "src/components/PrintPreview";
import { Field, FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { getFormatDateOnly } from "src/utils/main.module";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";

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
  const { canWrite } = useAccessRight("Contract");
  const data = paneProps.data;
  const defaultOrg = useDefaultOrganization();
  const [filesRevision, setFilesRevision] = useState(0);
  const handleFilesChange = useCallback(() => setFilesRevision(r => r + 1), []);

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
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.shortName ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.shortName ?? "",
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
      makePaneLabel("ContractsList", "Договора", saved, saved.shortName || saved.contractNumber),
  });

  const tabs = useMemo(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              {form.isEditMode && (
                <GroupRow>
                  <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                  <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                </GroupRow>
              )}
              <GroupCol>
                <Field label="Наименование *" name={`${form.formUid}_shortName`} minWidth="339px" value={form.fields.shortName} onChange={e => form.setField("shortName", e.target.value)} disabled={form.isLoading} />
                  <Field label="Номер договора" name={`${form.formUid}_contractNumber`} minWidth="339px" value={form.fields.contractNumber} onChange={e => form.setField("contractNumber", e.target.value)} disabled={form.isLoading} />
                  <FieldDate label="Дата начала" name={`${form.formUid}_startDate`} minWidth="200px" value={form.fields.startDate} onChange={e => form.setField("startDate", e.target.value)} disabled={form.isLoading} />
                  <FieldDate label="Дата окончания" name={`${form.formUid}_endDate`} minWidth="200px" value={form.fields.endDate} onChange={e => form.setField("endDate", e.target.value)} disabled={form.isLoading} />
                  <LookupField label="Организация (владелец)" name={`${form.formUid}_org`} value={form.fields.organizationUuid} displayValue={form.fields.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => form.setFields({ organizationUuid: u, organizationName: d } as Partial<TFields>)} onClear={() => form.setFields({ organizationUuid: "", organizationName: "" } as Partial<TFields>)} disabled={form.isLoading} minWidth="339px" />
                  <LookupField label="Контрагент" name={`${form.formUid}_cpty`} value={form.fields.counterpartyUuid} displayValue={form.fields.counterpartyName} endpoint="counterparties" displayField="shortName" onSelect={(u, d) => form.setFields({ counterpartyUuid: u, counterpartyName: d } as Partial<TFields>)} onClear={() => form.setFields({ counterpartyUuid: "", counterpartyName: "" } as Partial<TFields>)} disabled={form.isLoading} minWidth="339px" />
              </GroupCol>
            </div>
          </div>
        ),
      },
    ];
    if (form.isEditMode && form.fields.uuid) {
      t.push({ id: "files", label: translate("files"), component: <FilesPanel ownerType="contract" ownerUuid={form.fields.uuid} onFilesChange={handleFilesChange} /> });
      t.push({ id: "print", label: "Печать", component: <PrintPreview ownerUuid={form.fields.uuid} filesRevision={filesRevision} /> });
    }
    return t;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, filesRevision, handleFilesChange]);

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

const ContractsList: FC<ContractsListProps> = ({ variant, onSelectItem, ownerUuid, ownerField, extraParams }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName="ContractsList"
    columnsJson={columnsJson}
    FormComponent={ContractsForm}
    getLabel={(d) => String(d?.shortName || d?.contractNumber || "")}
    variant={variant}
    onSelectItem={onSelectItem}
    ownerUuid={ownerUuid}
    ownerField={ownerField}
    extraFilter={extraParams}
  />
);

ContractsList.displayName = "ContractsList";

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable для вложенного списка договоров
// ═══════════════════════════════════════════════════════════════════════════

const CR_TABLE_ENDPOINT = "contracts";
const CR_TABLE_COMPONENT = "ContractsList_part";

export interface ContractsTableProps {
  /** Ключ FK — "organizationUuid" или "counterpartyUuid" */
  parentKey: "organizationUuid" | "counterpartyUuid";
  /** UUID владельца */
  parentUuid: string;
  /** Имя владельца */
  parentName?: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const ContractsTable: FC<ContractsTableProps> = ({
  parentKey, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "shortName") {
      if (ctx.inlineEditing) return <Field label="" name={`ct_shortName_${row.id}`} value={(row.shortName as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "shortName", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.shortName as string) ?? ""}</span>;
    }
    if (col.identifier === "contractNumber") {
      if (ctx.inlineEditing) return <Field label="" name={`ct_num_${row.id}`} value={(row.contractNumber as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "contractNumber", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.contractNumber as string) ?? ""}</span>;
    }
    if (col.identifier === "startDate") {
      const val = typeof row.startDate === "string" ? row.startDate.slice(0, 10) : "";
      if (ctx.inlineEditing) return <input type="date" value={val} onChange={e => ctx.handleInlineChange(row, "startDate", e.target.value)} disabled={ctx.disabled} style={{ border: "none", background: "transparent", padding: "2px 4px", width: "100%", fontSize: 13 }} />;
      return <span>{val ? getFormatDateOnly(val) : ""}</span>;
    }
    if (col.identifier === "endDate") {
      const val = typeof row.endDate === "string" ? row.endDate.slice(0, 10) : "";
      if (ctx.inlineEditing) return <input type="date" value={val} onChange={e => ctx.handleInlineChange(row, "endDate", e.target.value)} disabled={ctx.disabled} style={{ border: "none", background: "transparent", padding: "2px 4px", width: "100%", fontSize: 13 }} />;
      return <span>{val ? getFormatDateOnly(val) : ""}</span>;
    }
    if (col.identifier === "counterparty.shortName") {
      if (ctx.inlineEditing) return (
        <LookupField label="" name={`ct_cpty_${row.id}`} value={(row.counterpartyUuid as string) ?? ""} displayValue={(row.counterparty as any)?.shortName ?? ""} endpoint="counterparties" displayField="shortName"
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "counterpartyUuid", uuid, { counterparty: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null })}
          onClear={() => ctx.handleLookupChange(row, "counterpartyUuid", null, { counterparty: null })}
          disabled={ctx.disabled} width="100%" variant="table" />
      );
      return <span>{(row.counterparty as any)?.shortName ?? ""}</span>;
    }
    if (col.identifier === "organization.shortName") {
      if (ctx.inlineEditing) return (
        <LookupField label="" name={`ct_org_${row.id}`} value={(row.organizationUuid as string) ?? ""} displayValue={(row.organization as any)?.shortName ?? ""} endpoint="organizations" displayField="shortName"
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "organizationUuid", uuid, { organization: item && uuid ? { uuid, shortName: item.shortName ?? "" } : null })}
          onClear={() => ctx.handleLookupChange(row, "organizationUuid", null, { organization: null })}
          disabled={ctx.disabled} width="100%" variant="table" />
      );
      return <span>{(row.organization as any)?.shortName ?? ""}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [CR_TABLE_ENDPOINT] });
      _ctx.refetch();
    };
    const nameKey = parentKey.replace(/Uuid$/, "Name");
    addPane({
      label: makePaneLabelFromData("ContractsList", "Договора", isEdit ? data as any : null, (data?.shortName || data?.contractNumber) as string),
      component: ContractsForm,
      data: isEdit ? data : { [parentKey]: parentUuid, [nameKey]: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, parentKey, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({
    shortName: "", contractNumber: "", startDate: null, endDate: null,
  }), []);

  // Скрываем колонку «другой стороны» — родительская и так известна
  const adjustedColumns = useMemo(() => {
    const hideId = parentKey === "organizationUuid" ? "organization.shortName" : "counterparty.shortName";
    const showId = parentKey === "organizationUuid" ? "counterparty.shortName" : "organization.shortName";
    return (columnsJson as any[]).map((col: any) => {
      if (col.identifier === hideId) return { ...col, visible: false, inlist: false };
      if (col.identifier === showId) return { ...col, visible: true, inlist: true };
      return col;
    });
  }, [parentKey]);

  return (
    <SubTable
      model={CR_TABLE_ENDPOINT}
      componentName={CR_TABLE_COMPONENT}
      columnsJson={adjustedColumns}
      parentKey={parentKey}
      parentUuid={parentUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage={translate("saveToContracts")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

ContractsTable.displayName = "ContractsTable";
export { ContractsList, ContractsForm, ContractsTable };
