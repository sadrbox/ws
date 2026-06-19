import { FC, useCallback, useMemo, useState } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import FilesPanel from "src/components/FilesPanel";
import PrintPreview from "src/components/PrintPreview";
import { Field, FieldDate } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { FormLookup } from "src/components/Field/FormLookup";
import PrimaryToolbarButton from "src/components/PrimaryToolbarButton";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { getFormatDateOnly } from "src/utils/datetime";
import { makePaneLabelFromData } from "src/utils/buildPaneLabel";

import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";

const MODEL_ENDPOINT = "contracts";
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  name: string;
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
  name: "", contractNumber: "", contractText: "",
  startDate: "", endDate: "",
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
};

const ContractsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useUserAccessRight("Contract");
  const data = paneProps.data;
  const defaultOrg = useDefaultOrganization();
  const [filesRevision, setFilesRevision] = useState(0);
  const handleFilesChange = useCallback(() => setFilesRevision(r => r + 1), []);

  const initialFields: TFields | undefined = (() => {
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data?.organizationUuid) {
      init.organizationUuid = data?.organizationUuid as string;
      init.organizationName = (data?.organizationName as string) || "";
    } else if (defaultOrg.organizationUuid) {
      init.organizationUuid = defaultOrg.organizationUuid;
      init.organizationName = defaultOrg.organizationName;
    }
    if (data?.counterpartyUuid) {
      init.counterpartyUuid = data?.counterpartyUuid as string;
      init.counterpartyName = (data?.counterpartyName as string) || "";
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
      name: d.name ?? "",
      contractNumber: d.contractNumber ?? "",
      contractText: d.contractText ?? "",
      startDate: d.startDate?.slice(0, 10) ?? "",
      endDate: d.endDate?.slice(0, 10) ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      counterpartyUuid: d.counterpartyUuid ?? "",
      counterpartyName: d.counterparty?.name ?? "",
      id: d.id,
      uuid: d.uuid,
    }),
    buildPayload: (fd) => {
      if (!fd.name?.trim()) return "Наименование обязательно";
      return {
        name: fd.name.trim(),
        contractNumber: fd.contractNumber?.trim() || null,
        contractText: fd.contractText?.trim() || null,
        startDate: fd.startDate || null,
        endDate: fd.endDate || null,
        organizationUuid: fd.organizationUuid || null,
        counterpartyUuid: fd.counterpartyUuid || null,
      };
    },
    buildPaneLabel: (saved) =>
      makePaneLabel("ContractsList", "Договора", saved, saved.name || saved.contractNumber),
  });

  const tabs = useMemo(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <Group>
                  <Field label={translate("name")} name={`${form.formUid}_name`} minWidth={FIELD_WIDTH.lg} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
                </Group>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <Field label={translate("contractNumber")} name={`${form.formUid}_contractNumber`} minWidth={FIELD_WIDTH.lg} value={form.fields.contractNumber} onChange={e => form.setField("contractNumber", e.target.value)} disabled={form.isLoading} />
                  </Group>
                </GroupRow>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <FieldDate label={translate("startDate")} name={`${form.formUid}_startDate`} minWidth="200px" value={form.fields.startDate} onChange={e => form.setField("startDate", e.target.value)} disabled={form.isLoading} />
                  </Group>
                  <Group className={styles.w1of2}>
                    <FieldDate label={translate("endDate")} name={`${form.formUid}_endDate`} minWidth="200px" value={form.fields.endDate} onChange={e => form.setField("endDate", e.target.value)} disabled={form.isLoading} />
                  </Group>
                </GroupRow>
                <Group>
                  <FormLookup form={form} field="organization" endpoint="organizations" label="organizationOwner" minWidth={FIELD_WIDTH.lg} />
                  <FormLookup form={form} field="counterparty" endpoint="counterparties" minWidth={FIELD_WIDTH.lg} />
                </Group>
              </GroupCol>
            </div>

          </div>
        ),
      },
    ];
    if (form.isEditMode && form.fields.uuid) {
      t.push({ id: "files", label: translate("files"), component: <FilesPanel ownerType="contract" ownerUuid={form.fields.uuid} onFilesChange={handleFilesChange} /> });
      t.push({ id: "print", label: "Просмотр файла", component: <PrintPreview ownerUuid={form.fields.uuid} filesRevision={filesRevision} /> });
    }
    return t;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, filesRevision, handleFilesChange]);

  return (
    <FormRequiredScope requiredKeys={["name"]} active>
      <ModelForm
        paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid}
        tabs={tabs}
        onSave={form.handleSave}
        onSaveAndClose={form.handleSaveAndClose}
        onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined}
        isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite}
      />
    </FormRequiredScope>
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
    getLabel={(d) => (d?.name as string | undefined) || (d?.contractNumber as string | undefined) || ""}
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
  /** Показывать кнопку «Сделать основным» и жирное выделение основного договора */
  showPrimaryButton?: boolean;
}

const ContractsTable: FC<ContractsTableProps> = ({
  parentKey, parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
  showPrimaryButton = false,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "name") {
      if (ctx.inlineEditing) return <Field label="" name={`ct_name_${row.id}`} value={(row.name as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "name", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.name as string) ?? ""}</span>;
    }
    if (col.identifier === "contractNumber") {
      if (ctx.inlineEditing) return <Field label="" name={`ct_num_${row.id}`} value={(row.contractNumber as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "contractNumber", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.contractNumber as string) ?? ""}</span>;
    }
    if (col.identifier === "startDate") {
      const val = typeof row.startDate === "string" ? row.startDate.slice(0, 10) : "";
      if (ctx.inlineEditing) return <FieldDate label="" name={`ct_startDate_${row.id}`} value={val} onChange={e => ctx.handleInlineChange(row, "startDate", e.target.value)} disabled={ctx.disabled} variant="table" />;
      return <span>{val ? getFormatDateOnly(val) : ""}</span>;
    }
    if (col.identifier === "endDate") {
      const val = typeof row.endDate === "string" ? row.endDate.slice(0, 10) : "";
      if (ctx.inlineEditing) return <FieldDate label="" name={`ct_endDate_${row.id}`} value={val} onChange={e => ctx.handleInlineChange(row, "endDate", e.target.value)} disabled={ctx.disabled} variant="table" />;
      return <span>{val ? getFormatDateOnly(val) : ""}</span>;
    }
    if (col.identifier === "counterparty.name") {
      if (ctx.inlineEditing) return (
        <LookupField label="" name={`ct_cpty_${row.id}`} value={(row.counterpartyUuid as string) ?? ""} displayValue={(row.counterparty as any)?.name ?? ""} endpoint="counterparties" displayField="name"
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "counterpartyUuid", uuid, { counterparty: item && uuid ? { uuid, name: item.name ?? "" } : null })}
          onClear={() => ctx.handleLookupChange(row, "counterpartyUuid", null, { counterparty: null })}
          disabled={ctx.disabled} width="100%" variant="table" />
      );
      return <span>{(row.counterparty as any)?.name ?? ""}</span>;
    }
    if (col.identifier === "organization.name") {
      if (ctx.inlineEditing) return (
        <LookupField label="" name={`ct_org_${row.id}`} value={(row.organizationUuid as string) ?? ""} displayValue={(row.organization as any)?.name ?? ""} endpoint="organizations" displayField="name"
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "organizationUuid", uuid, { organization: item && uuid ? { uuid, name: item.name ?? "" } : null })}
          onClear={() => ctx.handleLookupChange(row, "organizationUuid", null, { organization: null })}
          disabled={ctx.disabled} width="100%" variant="table" />
      );
      return <span>{(row.organization as any)?.name ?? ""}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: [CR_TABLE_ENDPOINT] });
      _ctx.refetch();
    };
    const nameKey = parentKey.replace(/Uuid$/, "Name");
    addPane({
      label: makePaneLabelFromData("ContractsList", "Договора", isEdit ? data as any : null, (data?.name || data?.contractNumber) as string),
      component: ContractsForm,
      data: isEdit ? data : { [parentKey]: parentUuid, [nameKey]: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, parentKey, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({
    name: "", contractNumber: "", startDate: null, endDate: null,
  }), []);

  // Скрываем колонку «другой стороны» — родительская и так известна
  const adjustedColumns = useMemo(() => {
    const hideId = parentKey === "organizationUuid" ? "organization.name" : "counterparty.name";
    const showId = parentKey === "organizationUuid" ? "counterparty.name" : "organization.name";
    return (columnsJson as any[]).map((col: any) => {
      if (col.identifier === hideId) return { ...col, visible: false, inlist: false };
      if (col.identifier === showId) return { ...col, visible: true, inlist: true };
      return col;
    });
  }, [parentKey]);

  const primaryButton = useMemo(
    () => showPrimaryButton ? <PrimaryToolbarButton endpoint={CR_TABLE_ENDPOINT} disabled={disabled} /> : undefined,
    [showPrimaryButton, disabled],
  );

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
      extraButtons={primaryButton}
      disablePrimaryRowHighlight={!showPrimaryButton}
    />
  );
};

ContractsTable.displayName = "ContractsTable";
export { ContractsList, ContractsForm, ContractsTable };
