import { FC, useMemo, useCallback, useRef, useState } from "react";
import { useAppContext } from "src/app/context";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TTableVariant } from "src/components/Table";
import type { TPane } from "src/app/types";
import columnsJson from "./columns.json";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { fetchPermissionProfiles, applyPermissionProfile } from "src/services/permissionProfiles";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { FieldSelect } from "src/components/Field";
import { Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import SubTable, { type SubTableApi, type SubTableContext } from "src/components/SubTable";
import { Button } from "src/components/Button";
import { AGENTS_KEY, ONEC_NESTED_PERMISSIONS, nestedDepth, nestedLevelOptions } from "src/models/OneCAdmin/onecPermissions";
import type { RowGroup } from "src/components/SubTable/rowModel";
import { openSubFormPane } from "src/components/SubTable/subFormOpener";
import ModelList from "src/components/ModelList";

import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { useUniqueOptionRows } from "src/hooks/useUniqueOptionRows";
import { makePaneLabel, makePaneLabelFromData, type LabelSource } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

const ENDPOINT = "access-permissions";
const SUBTABLE_COMPONENT_NAME = "AccessPermissionsTable_part";

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
    { value: "Cashbox", i18: "CashboxesList" },
    { value: "Product", i18: "ProductsList" },
    { value: "ProductPrice", i18: "ProductPriceCorrection" },
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
    { value: "CommercialOffer", i18: "CommercialOffersList" },
    { value: "SalesOrder", i18: "SalesOrdersList" },
    { value: "Reservation", i18: "ReservationsList" },
    { value: "PurchaseOrder", i18: "PurchaseOrdersList" },
    { value: "ImportDeclaration", i18: "ImportDeclarationsList" },
    { value: "WriteOff", i18: "WriteOffsList" },
    { value: "GoodsReceipt", i18: "GoodsReceiptsList" },
    { value: "StockCount", i18: "StockCountsList" },
    { value: "SerialNumber", i18: "SerialNumbersList" },
    { value: "BankStatement", i18: "BankStatementsList" },
    { value: "MonthClose", i18: "MonthClosesList" },
    { value: "FiscalReceipt", i18: "FiscalReceiptsList" },
    { value: "EdoDocument", i18: "edoSection" },
    { value: "UnitOfMeasure", i18: "UnitOfMeasuresList" },
    { value: "Tax", i18: "TaxesList" },
    { value: "OrganizationAccountingSetting", i18: "OrganizationAccountingSettingsList" },
    { value: "ScheduledTask", i18: "ScheduledTasksList" },
    { value: "PayrollCalculation", i18: "PayrollCalculationsList" },
    { value: "PayrollPayment", i18: "PayrollPaymentsList" },
    { value: "User", i18: "UsersList" },
    { value: "ActivityHistory", i18: "ActivityHistoriesList" },
    { value: "EmployeeHistory", i18: "EmployeeHistoriesList" },
    { value: "AccessPermission", i18: "AccessPermissionsList" },
    // Не Prisma-модель, а именованное право на раздел: панель «Администрирование 1С»
    // (E15/A5) проверяет его в NavList через can("OneCAdmin"). Без строки здесь право
    // невозможно выдать в интерфейсе, и раздел видел бы только суперадмин.
    { value: "OneCAdmin", i18: "OneCAdmin" },
  ].map(({ value, i18 }) => ({ value, label: translate(i18) || value })),
  // Вложенные разрешения «Администрирования 1С» (решение 15.09): без них в «Агентах», «Расширениях» и «Пользователях
  // баз» только просмотр. Показываются под строкой «Администрирование 1С».
  ...ONEC_NESTED_PERMISSIONS.map((x) => ({ value: x.key, label: x.label })),
];

/*
 * ГРУППА «АДМИНИСТРИРОВАНИЕ 1С»: общее право и вложенные разрешения стоят вместе при любой сортировке — сначала
 * «Администрирование 1С», затем агенты, расширения, пользователи баз в порядке ONEC_NESTED_PERMISSIONS.
 */
const ONEC_GROUP_ORDER = new Map<string, number>([["OneCAdmin", 0], ...ONEC_NESTED_PERMISSIONS.map((x, i) => [x.key, i + 1] as [string, number])]);
const accessPermissionGroup = (row: TDataItem): RowGroup | null => {
  const order = ONEC_GROUP_ORDER.get(row.modelName as string);
  return order === undefined ? null : { key: "OneCAdmin", order };
};

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


/** Серверная запись — вход mapServerToForm (T3). */
interface AccessPermissionsServerRecord {
  accessLevel?: string | null;
  id?: number;
  modelName?: string | null;
  organizationUuid?: string | null;
  userUuid?: string | null;
  uuid?: string;
}

const AccessPermissionsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessPermission("AccessPermission");

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
    storageKey: "access-rights-form",
    defaultFields: DEFAULT_ITEM_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d: AccessPermissionsServerRecord, prev) => ({
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
    buildPaneLabel: (saved: LabelSource & { modelName?: string | null }) =>
      makePaneLabel("AccessPermissionsList", "Право доступа к разделу", saved, MODEL_NAME_OPTIONS.find(o => o.value === saved.modelName)?.label),
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
                <FieldSelect label={translate("model")} name={`${form.formUid}_modelName`} options={MODEL_NAME_OPTIONS} sortOptions
                  value={form.fields.modelName} onChange={e => form.setField("modelName", e.target.value)} disabled={form.isLoading || form.isEditMode} />
                <FieldSelect label={translate("accessLevel")} name={`${form.formUid}_accessLevel`} options={ACCESS_LEVEL_OPTIONS}
                  value={form.fields.accessLevel} onChange={e => form.setField("accessLevel", e.target.value)} disabled={form.isLoading} />
              </Group>
            </GroupCol>
          </div>
          <GroupCol className={styles.FormNotice}>
            <Notice items={notices} />
          </GroupCol>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, notices]);

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
AccessPermissionsForm.displayName = "AccessPermissionsForm";

const AccessPermissionsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => {
  return (
    <ModelList
      endpoint={ENDPOINT}
      listName="AccessPermissionsList"
      columnsJson={columnsJson}
      FormComponent={AccessPermissionsForm}
      getLabel={(d) => {
        const item = d as { modelName?: string | null };
        const modelLabel = MODEL_NAME_OPTIONS.find(o => o.value === item?.modelName)?.label ?? (item?.modelName ?? "");
        return modelLabel;
      }}
      variant={variant}
      onSelectItem={onSelectItem}
      defaultSort={{ id: "desc" }}
    />
  );
};
AccessPermissionsList.displayName = "AccessPermissionsList";

export interface AccessPermissionsTableProps {
  userUuid?: string;
  organizationUuid?: string;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
  /** Передайте из родительской формы — computed из form.useTable("...").allRows */
  disableAdd?: boolean;
  /** Передайте form.useTable("...").onAllItemsChange — обновляет allRows формы */
  onAllItemsChange?: (rows: TDataItem[]) => void;
}

const AccessPermissionsTable: FC<AccessPermissionsTableProps> = ({
  userUuid,
  organizationUuid,
  deferRemoteChanges = true,
  onItemsChange,
  initialPendingRows,
  disableAdd: disableAddProp,
  onAllItemsChange: onAllItemsChangeProp,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();

  const { getFirstUnused, getAvailableOptions, handleRowsChange } =
    useUniqueOptionRows(MODEL_NAME_OPTIONS, "modelName", initialPendingRows);

  // Компонуем внутренний handleRowsChange (для getAvailableOptions/getFirstUnused)
  // с внешним onAllItemsChangeProp (для allRows в форме).
  const handleAllItemsChange = useCallback((rows: TDataItem[]) => {
    handleRowsChange(rows);
    onAllItemsChangeProp?.(rows);
  }, [handleRowsChange, onAllItemsChangeProp]);

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
      // Вложенные строки — с отступом под «Администрированием 1С» (и в редактировании, и в просмотре).
      const depth = nestedDepth(row.modelName as string);
      if (ctx.inlineEditing) {
        const availableOptions = getAvailableOptions(ctx.rows, row.modelName as string);
        return (
          <FieldSelect
            name={`inline_model_${row.id}`}
            options={availableOptions}
            sortOptions
            value={(row.modelName as string) ?? ""}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => ctx.handleInlineChange(row, "modelName", e.target.value)}
            variant="table"
            style={depth ? { paddingLeft: depth * 12 } : undefined}
          />
        );
      }
      return <span style={depth ? { paddingLeft: depth * 12 } : undefined}>{depth ? "↳ " : ""}{modelNameMap[row.modelName as string] ?? row.modelName}</span>;
    }
    if (col.identifier === "accessLevel") {
      // У вложенных разрешений свои уровни: агенты — просмотр/редактирование/управление, действия — разрешено/запрещено.
      const levelOptions = nestedLevelOptions(row.modelName as string) ?? ACCESS_LEVEL_OPTIONS;
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`inline_level_${row.id}`}
            options={levelOptions}
            value={(row.accessLevel as string) ?? "none"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => ctx.handleInlineChange(row, "accessLevel", e.target.value)}
            variant="table"
          />
        );
      }
      return <span>{levelOptions.find((o) => o.value === row.accessLevel)?.label ?? accessLevelMap[row.accessLevel as string] ?? row.accessLevel}</span>;
    }
    return undefined;
  }, [modelNameMap, accessLevelMap, getAvailableOptions]);

  const openFormFor = useCallback((data: TDataItem | undefined, ctx: SubTableContext, sourceRow?: TDataItem) => {
    openSubFormPane({
      addPane,
      invalidate: () => void queryClient.invalidateQueries({ queryKey: [ENDPOINT] }),
      component: AccessPermissionsForm,
      label: (d, isEdit) => makePaneLabelFromData("AccessPermissionsTable", "Право доступа к разделу", isEdit ? d as LabelSource : null),
      newContext: () => ({ userUuid, ...(organizationUuid ? { organizationUuid } : {}) }),
      blockNew: () => disableAddProp ?? false,
    }, data, ctx, sourceRow);
  }, [addPane, userUuid, organizationUuid, queryClient, disableAddProp]);

  /*
   * «ДОБАВИТЬ ВЛОЖЕННЫЕ» — на строке «Администрирование 1С»: недостающие вложенные разрешения добавляются разом, агенты —
   * «просмотр», действия — «запрещено». Выдавать их по одной через «Добавить» можно и дальше.
   */
  const apiRef = useRef<SubTableApi | null>(null);
  const addNested = useCallback((ctx: SubTableContext) => {
    const have = new Set(ctx.rows.map((r) => r.modelName as string));
    for (const x of ONEC_NESTED_PERMISSIONS) {
      if (have.has(x.key)) continue;
      apiRef.current?.addRow({
        modelName: x.key, accessLevel: x.key === AGENTS_KEY ? "view" : "none",
        userUuid, ...(organizationUuid ? { organizationUuid } : {}),
      });
    }
  }, [userUuid, organizationUuid]);
  const rowActions = useCallback((row: TDataItem, ctx: SubTableContext) => {
    if (row.modelName !== "OneCAdmin" || !ctx.inlineEditing || ctx.disabled) return null;
    const missing = ONEC_NESTED_PERMISSIONS.some((x) => !ctx.rows.some((r) => r.modelName === x.key));
    return missing ? (
      <Button variant="secondary" size="sm" onClick={() => addNested(ctx)}>{translate("onecPermAddNested")}</Button>
    ) : null;
  }, [addNested]);

  // Сортировка по тому, что видно в ячейке: подписи модели и уровня, а не ключи `Sale`/`full`.
  const sortValue = useMemo(() => ({
    modelName: (r: TDataItem) => modelNameMap[r.modelName as string] ?? r.modelName,
    accessLevel: (r: TDataItem) =>
      (nestedLevelOptions(r.modelName as string) ?? ACCESS_LEVEL_OPTIONS).find((o) => o.value === r.accessLevel)?.label ?? r.accessLevel,
  }), [modelNameMap]);

  const defaultNewRow = useMemo(() => {
    if (!userUuid) return undefined;
    return (rows: TDataItem[]) => {
      const modelName = getFirstUnused(rows);
      if (!modelName) return null; // all models present — abort (null-veto in SubTable)
      return {
        modelName,
        accessLevel: "none" as const,
        userUuid,
        ...(organizationUuid ? { organizationUuid } : {}),
      };
    };
  }, [userUuid, organizationUuid, getFirstUnused]);

  return (
    <>
      <ProfilePicker userUuid={userUuid} organizationUuid={organizationUuid} />
      <SubTable
      model={ENDPOINT}
      componentName={SUBTABLE_COMPONENT_NAME}
      columnsJson={columnsJson}
      parentKey="userUuid"
      parentUuid={userUuid ?? ""}
      // По имени модели: вложенные «OneCAdmin.…» стоят сразу за «Администрированием 1С».
      defaultSort={{ modelName: "asc" }}
      defaultInlineEditing={true}
      showEditModeToggle={false}
      disabled={!userUuid}
      apiRef={apiRef}
      rowActions={rowActions}
      sortValue={sortValue}
      groupRows={accessPermissionGroup}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      onAllItemsChange={handleAllItemsChange}
      emptyMessage={userUuid ? translate("noAccessPermissions") : translate("saveUserFirst")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
      disableAdd={disableAddProp ?? false}
      extraQueryParams={organizationUuid ? { organizationUuid } : undefined}
      filterRows={filterRows}
      />
    </>
  );
};
AccessPermissionsTable.displayName = "AccessPermissionsTable";

/**
 * ВЫДАТЬ ПРАВА ОДНИМ ДЕЙСТВИЕМ (О2 плана PLAN_INSTALL_MODES_2026-09-24.md).
 *
 * Право — строка «пользователь × модель», и моделей шестьдесят две. Завести бухгалтера значило
 * проставить их руками, и так на каждого сотрудника и на каждой установке. Профиль раскладывает
 * весь набор разом; дальше права правятся точечно в таблице ниже — профиль это ШАБЛОН, а не
 * живая роль, и поправленное им больше не управляется.
 *
 * Показываем только когда известны и пользователь, и организация: права выдаются в организации,
 * а не «вообще». У несохранённого пользователя выдавать нечему.
 */
const ProfilePicker: FC<{ userUuid?: string; organizationUuid?: string }> = ({ userUuid, organizationUuid }) => {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const profiles = useQuery({
    queryKey: ["permission-profiles"],
    queryFn: fetchPermissionProfiles,
    staleTime: 5 * 60_000,
    enabled: !!userUuid && !!organizationUuid,
  });
  const apply = useMutation({
    mutationFn: () => applyPermissionProfile({ userUuid: userUuid!, organizationUuid: organizationUuid!, profile: code }),
    onSuccess: (r) => {
      showToast(`${translate("permProfileApplied")}: ${r.applied ?? ""}`.trim(), "success");
      void queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
    },
    onError: (e) => reportError(e, { source: translate("permProfileTitle") }),
  });

  if (!userUuid || !organizationUuid) return null;
  const chosen = profiles.data?.find((p) => p.code === code);

  return (
    <Group>
      <FieldSelect
        name="perm_profile"
        label={translate("permProfileTitle")}
        size="sm"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        options={[
          { value: "", label: translate("permProfileNotChosen") },
          ...(profiles.data ?? []).map((p) => ({ value: p.code, label: p.name })),
        ]}
      />
      <Button
        variant="secondary"
        disabled={!code || apply.isPending}
        // Предупреждаем ДО действия: назначение стирает то, что человек правил руками.
        title={chosen?.description ?? translate("permProfileHint")}
        onClick={() => { if (window.confirm(translate("permProfileConfirm"))) apply.mutate(); }}
      >
        {translate("permProfileApply")}
      </Button>
    </Group>
  );
};
ProfilePicker.displayName = "AccessPermissionsProfilePicker";

export { AccessPermissionsForm, AccessPermissionsList, AccessPermissionsTable };
