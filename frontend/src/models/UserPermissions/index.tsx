import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { FieldSelect } from "src/components/Field";
import { GroupCol } from "src/components/UI/Group";
import styles from "src/styles/main.module.scss";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import ModelList from "src/components/ModelList";

import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";

const ENDPOINT = "access-rights";
const SUBTABLE_COMPONENT_NAME = "UserPermissionsTable_part";

export const ACCESS_LEVEL_OPTIONS = [
  { value: "full", label: translate("accessLevelFull") || "Полный" },
  { value: "readonly", label: translate("accessLevelReadonly") || "Только чтение" },
  { value: "none", label: translate("accessLevelNone") || "Нет доступа" },
];

export const MODEL_NAME_OPTIONS = [
  ...[
    { value: "Organization", i18: "OrganizationsList" },
    { value: "Counterparty", i18: "CounterpartiesList" },
    { value: "Contract", i18: "ContractsList" },
    { value: "Sale", i18: "SalesList" },
    { value: "Purchase", i18: "PurchasesList" },
    { value: "Warehouse", i18: "WarehousesList" },
    { value: "Product", i18: "ProductsList" },
    { value: "Brand", i18: "BrandsList" },
    { value: "Employee", i18: "EmployeesList" },
    { value: "Contact", i18: "ContactsList" },
    { value: "ContactPerson", i18: "ContactPersonsList" },
    { value: "Position", i18: "PositionsList" },
    { value: "BankAccount", i18: "BankAccountsList" },
    { value: "Currency", i18: "CurrenciesList" },
    { value: "Todo", i18: "TodosList" },
    { value: "Notification", i18: "NotificationsList" },
    { value: "OutgoingInvoice", i18: "OutgoingInvoicesList" },
    { value: "IncomingInvoice", i18: "IncomingInvoicesList" },
    { value: "PaymentInvoice", i18: "PaymentInvoicesList" },
    { value: "CashReceiptOrder", i18: "CashReceiptOrdersList" },
    { value: "CashExpenseOrder", i18: "CashExpenseOrdersList" },
    { value: "InventoryTransfer", i18: "InventoryTransfersList" },
    { value: "UnitOfMeasure", i18: "UnitOfMeasuresList" },
    { value: "Tax", i18: "TaxesList" },
    { value: "OrganizationAccountingSetting", i18: "OrganizationAccountingSettingsList" },
    { value: "ScheduledTask", i18: "ScheduledTasksList" },
    { value: "PayrollCalculation", i18: "PayrollCalculationsList" },
    { value: "PayrollPayment", i18: "PayrollPaymentsList" },
    { value: "User", i18: "UsersList" },
    { value: "ActivityHistory", i18: "ActivityHistoriesList" },
    { value: "EmployeeHistory", i18: "EmployeeHistoriesList" },
    { value: "AccessRight", i18: "UserPermissionsList" },
  ].map(({ value, i18 }) => ({ value, label: translate(i18) || value })),
];

interface TItemFields {
  id?: number;
  uuid?: string;
  modelName: string;
  accessLevel: string;
  userUuid: string;
  organizationUuid?: string | null;
}

const DEFAULT_ITEM_FIELDS: TItemFields = {
  modelName: "", accessLevel: "none", userUuid: "", organizationUuid: null,
};

const UserPermissionsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("AccessRight");

  const initialFields: TItemFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    if (data?.userUuid) return {
      ...DEFAULT_ITEM_FIELDS,
      userUuid: data?.userUuid as string,
      organizationUuid: (data?.organizationUuid as string | null) ?? null,
    };
    return undefined;
  })();

  const form = useFormStore<TItemFields>({
    endpoint: ENDPOINT,
    storageKey: "user-permissions-form",
    defaultFields: DEFAULT_ITEM_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_ITEM_FIELDS),
      ...d,
      modelName: d.modelName ?? "",
      accessLevel: d.accessLevel ?? "none",
      userUuid: d.userUuid ?? "",
      organizationUuid: d.organizationUuid ?? null,
    }),
    buildPayload: (fd) => {
      if (!fd.modelName?.trim()) return "Модель обязательна";
      if (!fd.userUuid) return "userUuid обязателен";
      return {
        modelName: fd.modelName.trim(),
        accessLevel: fd.accessLevel || "none",
        userUuid: fd.userUuid,
        organizationUuid: fd.organizationUuid ?? null,
      };
    },
    buildPaneLabel: (saved) => makePaneLabel("UserPermissionsList", "Право доступа к разделу", saved),
  });

  const tabs = useMemo(() => [
    {
      id: "tab-details", label: translate("general"), component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            <GroupCol>
              <FieldSelect
                label={translate("model")}
                name={`${form.formUid}_modelName`}
                options={MODEL_NAME_OPTIONS}
                value={form.fields.modelName}
                onChange={e => form.setField("modelName", e.target.value)}
                disabled={form.isLoading || form.isEditMode}
              />
              <FieldSelect
                label={translate("accessLevel")}
                name={`${form.formUid}_accessLevel`}
                options={ACCESS_LEVEL_OPTIONS}
                value={form.fields.accessLevel}
                onChange={e => form.setField("accessLevel", e.target.value)}
                disabled={form.isLoading}
              />
            </GroupCol>
          </div>
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
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite}
    />
  );
};
UserPermissionsForm.displayName = "UserPermissionsForm";

const UserPermissionsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => {
  return (
    <ModelList
      endpoint={ENDPOINT}
      listName="UserPermissionsList"
      columnsJson={columnsJson}
      FormComponent={UserPermissionsForm}
      getLabel={(d) => {
        const item = d as any;
        const modelLabel = MODEL_NAME_OPTIONS.find(o => o.value === item?.modelName)?.label ?? (item?.modelName ?? "");
        return modelLabel;
      }}
      variant={variant}
      onSelectItem={onSelectItem}
      defaultSort={{ id: "desc" }}
    />
  );
};
UserPermissionsList.displayName = "UserPermissionsList";

export interface UserPermissionsTableProps {
  userUuid?: string;
  organizationUuid?: string;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const UserPermissionsTable: FC<UserPermissionsTableProps> = ({
  userUuid,
  organizationUuid,
  deferRemoteChanges = true,
  onItemsChange,
  initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const [currentRows, setCurrentRows] = useState<TDataItem[]>(initialPendingRows ?? []);
  const handleItemsChange = useCallback((items: TDataItem[]) => {
    setCurrentRows(items);
    onItemsChange?.(items);
  }, [onItemsChange]);

  const allModelsUsed = useMemo(() => {
    const usedModels = new Set(currentRows.map(r => r.modelName as string).filter(Boolean));
    return MODEL_NAME_OPTIONS.every(o => usedModels.has(o.value));
  }, [currentRows]);

  const prevAllModelsUsedRef = useRef(allModelsUsed);
  useEffect(() => {
    if (allModelsUsed && !prevAllModelsUsedRef.current) {
      window.dispatchEvent(new CustomEvent("ui_toast", {
        detail: { message: translate("allModelsAssigned"), type: "info" },
      }));
    }
    prevAllModelsUsedRef.current = allModelsUsed;
  }, [allModelsUsed]);

  const modelNameMap = useMemo(
    () => Object.fromEntries(MODEL_NAME_OPTIONS.filter(o => o.value).map(o => [o.value, o.label])),
    [],
  );
  const accessLevelMap = useMemo(
    () => Object.fromEntries(ACCESS_LEVEL_OPTIONS.map(o => [o.value, o.label])),
    [],
  );

  const filterRows = useCallback((rows: TDataItem[], search: string): TDataItem[] => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((row: TDataItem) => {
      const modelLabel = (modelNameMap[row.modelName as string] ?? (row.modelName as string) ?? "").toLowerCase();
      const levelLabel = (accessLevelMap[row.accessLevel as string] ?? (row.accessLevel as string) ?? "").toLowerCase();
      const modelKey = ((row.modelName as string) ?? "").toLowerCase();
      const levelKey = ((row.accessLevel as string) ?? "").toLowerCase();
      const idStr = String(row.id ?? "");
      return words.every((w: string) =>
        modelLabel.includes(w) || modelKey.includes(w) ||
        levelLabel.includes(w) || levelKey.includes(w) ||
        idStr.includes(w)
      );
    });
  }, [modelNameMap, accessLevelMap]);

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "modelName") {
      if (ctx.inlineEditing) {
        const usedByOthers = new Set(
          ctx.rows.filter(r => r !== row).map(r => r.modelName as string).filter(Boolean),
        );
        const availableOptions = MODEL_NAME_OPTIONS.filter(o => !usedByOthers.has(o.value));
        return (
          <FieldSelect
            name={`inline_model_${row.id}`}
            options={availableOptions}
            value={(row.modelName as string) ?? ""}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => ctx.handleInlineChange(row, "modelName", e.target.value)}
            variant="table"
          />
        );
      }
      return <span>{modelNameMap[row.modelName as string] ?? row.modelName}</span>;
    }
    if (col.identifier === "accessLevel") {
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`inline_level_${row.id}`}
            options={ACCESS_LEVEL_OPTIONS}
            value={(row.accessLevel as string) ?? "none"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => ctx.handleInlineChange(row, "accessLevel", e.target.value)}
            variant="table"
          />
        );
      }
      return <span>{accessLevelMap[row.accessLevel as string] ?? row.accessLevel}</span>;
    }
    return undefined;
  }, [modelNameMap, accessLevelMap, addPane]);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    if (!isEdit) {
      const usedModels = new Set(currentRows.map(r => r.modelName as string).filter(Boolean));
      if (!MODEL_NAME_OPTIONS.some(o => !usedModels.has(o.value))) return;
    }
    const newData = !isEdit && userUuid
      ? { userUuid, ...(organizationUuid ? { organizationUuid } : {}) } as unknown as TDataItem
      : data;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("UserPermissionsTable", "Право доступа к разделу", isEdit ? data as any : null),
      component: UserPermissionsForm,
      data: newData,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, userUuid, organizationUuid, queryClient, currentRows]);

  const defaultNewRow = useMemo(() => {
    if (!userUuid || allModelsUsed) return undefined;
    return (rows: TDataItem[]) => {
      const used = new Set(rows.map(r => r.modelName as string).filter(Boolean));
      const firstUnused = MODEL_NAME_OPTIONS.find(o => !used.has(o.value))?.value ?? "";
      return {
        modelName: firstUnused,
        accessLevel: "none" as const,
        userUuid,
        ...(organizationUuid ? { organizationUuid } : {}),
      };
    };
  }, [userUuid, organizationUuid, allModelsUsed]);

  return (
    <SubTable
      model={ENDPOINT}
      componentName={SUBTABLE_COMPONENT_NAME}
      columnsJson={columnsJson}
      parentKey="userUuid"
      parentUuid={userUuid ?? ""}
      defaultSort={{ id: "asc" }}
      defaultInlineEditing={true}
      showEditModeToggle={true}
      disabled={!userUuid}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={handleItemsChange}
      emptyMessage={userUuid ? translate("noAccessRights") : translate("saveUserFirst")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
      disableAdd={allModelsUsed}
      extraQueryParams={organizationUuid ? { organizationUuid } : undefined}
      filterRows={filterRows}
    />
  );
};
UserPermissionsTable.displayName = "UserPermissionsTable";

export { UserPermissionsForm, UserPermissionsList, UserPermissionsTable };
