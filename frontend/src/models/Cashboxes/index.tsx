import { FC, useCallback, useMemo } from "react";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { FormLookup } from "src/components/Field/FormLookup";
import { Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { useAppContext } from "src/app/context";
import { useQueryClient } from "@tanstack/react-query";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { openSubFormPane } from "src/components/SubTable/subFormOpener";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";


const MODEL_ENDPOINT = "cashboxes";
const LIST_NAME = "CashboxesList";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFields {
  id?: number;
  uuid?: string;
  name: string;
  organizationUuid: string;
  organizationName: string;
}

const DEFAULT_FIELDS: TFields = { name: "", organizationUuid: "", organizationName: "" };

const CashboxesForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const { canWrite } = useAccessPermission("Cashbox");
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "cashboxes-form", paneProps,
    defaultFields: DEFAULT_FIELDS,
    initialFields: { ...DEFAULT_FIELDS, organizationUuid: defaultOrg.organizationUuid, organizationName: defaultOrg.organizationName },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      name: d.name ?? "",
      organizationUuid: d.organizationUuid ?? "",
      organizationName: d.organization?.name ?? "",
      id: d.id, uuid: d.uuid,
    }),
    buildPayload: (fd) => ({ name: fd.name?.trim() || null, organizationUuid: fd.organizationUuid || null }),
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Кассы", saved),
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <Group>
                <Field label={translate("name")} name={`${form.formUid}_name`} value={form.fields.name} onChange={e => form.setField("name", e.target.value)} disabled={form.isLoading} />
                <FormLookup form={form} field="organization" endpoint="organizations" minWidth={FIELD_WIDTH.lg} />
              </Group>
            </GroupCol>
          </div>
          <GroupCol className={styles.FormNotice}>
            <Notice items={notices} />
          </GroupCol>
        </div>
      ),
    },
  ], [form.fields, form.isLoading, form.isEditMode, form.formUid, form.setField, form.setFields, notices]);

  return (
    <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
CashboxesForm.displayName = "CashboxesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const CashboxesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName={LIST_NAME} columnsJson={columnsJson} FormComponent={CashboxesForm}
    getLabel={(d) => d?.name ? (d.name as string).slice(0, 50) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }} />
);
CashboxesList.displayName = "CashboxesList";

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable для вложенного списка касс внутри форм
// ═══════════════════════════════════════════════════════════════════════════

const CB_TABLE_ENDPOINT = "cashboxes";
const CB_TABLE_COMPONENT = "CashboxesList_part";

export interface CashboxesTableProps {
  parentUuid: string;
  parentName?: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const CashboxesTable: FC<CashboxesTableProps> = ({
  parentUuid, parentName = "", disabled = false,
  deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "name") {
      if (ctx.inlineEditing) return <Field label="" name={`cb_name_${row.id}`} value={(row.name as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "name", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" />;
      return <span>{(row.name as string) ?? ""}</span>;
    }
    return undefined;
  }, []);

  const openFormFor = useCallback((data: TDataItem | undefined, ctx: SubTableContext, sourceRow?: TDataItem) => {
    openSubFormPane({
      addPane,
      invalidate: () => void queryClient.invalidateQueries({ queryKey: [CB_TABLE_ENDPOINT] }),
      component: CashboxesForm,
      label: (d, isEdit) => makePaneLabelFromData("CashboxesList", "Кассы", isEdit ? d as any : null, d?.name as string),
      newContext: () => ({ organizationUuid: parentUuid, organizationName: parentName }),
    }, data, ctx, sourceRow);
  }, [addPane, parentUuid, parentName, queryClient]);

  const defaultNewRow = useMemo(() => ({ name: "" }), []);

  const adjustedColumns = useMemo(
    () => (columnsJson as any[]).map((col: any) => {
      if (col.identifier === "organization.name") return { ...col, visible: false, inlist: false };
      return col;
    }),
    [],
  );

  return (
    <SubTable
      model={CB_TABLE_ENDPOINT}
      componentName={CB_TABLE_COMPONENT}
      columnsJson={adjustedColumns}
      parentKey="organizationUuid"
      parentUuid={parentUuid}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      emptyMessage={translate("saveToCashboxes")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
    />
  );
};

CashboxesTable.displayName = "CashboxesTable";
export { CashboxesList, CashboxesForm, CashboxesTable };
