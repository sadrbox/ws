import { FC, useCallback, useMemo } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field, FieldTextarea } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { useAppContext } from "src/app/context";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";


const MODEL_ENDPOINT = "warehouses";
const LIST_NAME = "WarehousesList";

interface TFields { id?: number; uuid?: string; name: string; address: string; comment: string; organizationUuid: string; organizationName: string; }
const DEFAULT_FIELDS: TFields = { name: "", address: "", comment: "", organizationUuid: "", organizationName: "" };

const WarehousesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useUserAccessRight("Warehouse");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "warehouses-form", paneProps,
    defaultFields: DEFAULT_FIELDS,
    initialFields: { ...DEFAULT_FIELDS, organizationUuid: defaultOrg.organizationUuid, organizationName: defaultOrg.organizationName },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS), name: d.name ?? "", address: d.address ?? "", comment: d.comment ?? "",
      organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.name ?? "",
      id: d.id, uuid: d.uuid,
    }),
    buildPayload: (fd) => ({ name: fd.name?.trim() || null, address: fd.address?.trim() || null, comment: fd.comment?.trim() || null, organizationUuid: fd.organizationUuid || null }),
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Склады", saved),
  });

  const tabs = useMemo(() => [
    { id: "tab-details", label: translate("general"), component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          <GroupCol>
            <Group>
              <Field label={translate("name")} name={`${form.formUid}_name`} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("address")} name={`${form.formUid}_address`} value={form.fields.address} onChange={e => form.setField("address", e.target.value)} disabled={form.isLoading} />
            </Group>
            <Group>
              <FormLookup form={form} field="organization" endpoint="organizations" minWidth={FIELD_WIDTH.lg} />
            </Group>
            <Group>
              <FieldTextarea label={translate("description")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} minWidth={FIELD_WIDTH.lg} minHeight="80px" rows={4} />
            </Group>
          </GroupCol>
        </div>
      </div>
    )},
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields]);

  return (
    <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
WarehousesForm.displayName = "WarehousesForm";

const WarehousesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={WarehousesForm}
    getLabel={(d) => d?.name ? (d.name as string).slice(0, 50) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }} />
);
WarehousesList.displayName = "WarehousesList";

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable для вложенного списка складов внутри форм
// ═══════════════════════════════════════════════════════════════════════════

const WH_TABLE_ENDPOINT = "warehouses";
const WH_TABLE_COMPONENT = "WarehousesList_part";

export interface WarehousesTableProps {
  parentUuid: string;
  parentName?: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const WarehousesTable: FC<WarehousesTableProps> = ({
  parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "name") {
      if (ctx.inlineEditing) return <Field label="" name={`wh_name_${row.id}`} value={(row.name as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "name", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.name as string) ?? ""}</span>;
    }
    if (col.identifier === "address") {
      if (ctx.inlineEditing) return <Field label="" name={`wh_address_${row.id}`} value={(row.address as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "address", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.address as string) ?? ""}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: [WH_TABLE_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("WarehousesList", "Склады", isEdit ? data as any : null, data?.name as string),
      component: WarehousesForm,
      data: isEdit ? data : { organizationUuid: parentUuid, organizationName: parentName } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({ name: "", address: "" }), []);

  const adjustedColumns = useMemo(
    () => (columnsJson as any[]).map((col: any) => {
      if (col.identifier === "organization.name") return { ...col, visible: false, inlist: false };
      return col;
    }),
    [],
  );

  return (
    <SubTable
      model={WH_TABLE_ENDPOINT}
      componentName={WH_TABLE_COMPONENT}
      columnsJson={adjustedColumns}
      parentKey="organizationUuid"
      parentUuid={parentUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage={translate("saveToWarehouses")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

WarehousesTable.displayName = "WarehousesTable";
export { WarehousesList, WarehousesForm, WarehousesTable };
