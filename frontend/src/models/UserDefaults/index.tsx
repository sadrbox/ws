/**
 * UserDefaults — предопределённые значения пользователя по организации
 * (валюта/склад/договор/касса/контакт/тип цен по умолчанию). Бэкенд-маршрут
 * `user-defaults` (модель `userDefault`).
 *
 * Экспортирует подтаблицу `UserDefaultsTable` (используется в форме «Настройки
 * пользователя», src/models/UserSettings) и список видов `PERMISSION_DEFAULT_TYPE_OPTIONS`.
 */
import { FC, useCallback, useMemo } from "react";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import { useUniqueOptionRows } from "src/hooks/useUniqueOptionRows";

// Виды предопределённых значений + соответствующий справочник (endpoint Lookup).
export const PERMISSION_DEFAULT_TYPE_OPTIONS = [
  { value: "bankAccount", label: translate("BankAccountsList") },
  { value: "contract", label: translate("ContractsList") },
  { value: "warehouse", label: translate("WarehousesList") },
  { value: "cashbox", label: translate("CashboxesList") },
  { value: "contact", label: translate("ContactsList") },
  { value: "salePriceType", label: translate("salePriceType") },
  { value: "purchasePriceType", label: translate("purchasePriceType") },
];

const PERMISSION_DEFAULT_TYPE_ENDPOINT: Record<string, string> = {
  bankAccount: "bankaccounts",
  contract: "contracts",
  warehouse: "warehouses",
  cashbox: "cashboxes",
  contact: "contacts",
  salePriceType: "price-types",
  purchasePriceType: "price-types",
};

const typeOptMap = Object.fromEntries(
  PERMISSION_DEFAULT_TYPE_OPTIONS.map(o => [o.value, o.label]),
);

const DEFAULTS_COLUMNS = [
  { identifier: "valueType", type: "string", width: "220px", minWidth: "160px", alignment: "left" as const, hint: translate("permDefaultValueType"), visible: true, inlist: true },
  { identifier: "valueName", type: "string", width: "1fr", minWidth: "180px", alignment: "left" as const, hint: translate("permDefaultValue"), visible: true, inlist: true },
];

export interface UserDefaultsTableProps {
  userUuid: string;
  organizationUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  initialPendingRows?: TDataItem[];
  onItemsChange?: (items: TDataItem[]) => void;
  /** Передайте из родительской формы — computed из form.useTable("...").allRows */
  disableAdd?: boolean;
  /** Передайте form.useTable("...").onAllItemsChange — обновляет allRows формы */
  onAllItemsChange?: (rows: TDataItem[]) => void;
}

const UserDefaultsTable: FC<UserDefaultsTableProps> = ({
  userUuid,
  organizationUuid,
  disabled = false,
  deferRemoteChanges = true,
  initialPendingRows,
  onItemsChange,
  disableAdd: disableAddProp,
  onAllItemsChange: onAllItemsChangeProp,
}) => {
  const { getFirstUnused, getAvailableOptions, handleRowsChange } =
    useUniqueOptionRows(PERMISSION_DEFAULT_TYPE_OPTIONS, "valueType", initialPendingRows);

  // Компонуем внутренний handleRowsChange (для getAvailableOptions/getFirstUnused)
  // с внешним onAllItemsChangeProp (для allRows в форме).
  const handleAllItemsChange = useCallback((rows: TDataItem[]) => {
    handleRowsChange(rows);
    onAllItemsChangeProp?.(rows);
  }, [handleRowsChange, onAllItemsChangeProp]);

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "valueType") {
      if (ctx.inlineEditing) {
        const availableOptions = getAvailableOptions(ctx.rows, row.valueType as string);
        return (
          <FieldSelect
            name={`upd_type_${row.id}`}
            options={availableOptions}
            value={(row.valueType as string) ?? ""}
            onChange={e => {
              ctx.handleInlineChange(row, "valueType", e.target.value);
              ctx.handleInlineChange(row, "valueUuid", "");
              ctx.handleInlineChange(row, "valueName", "");
            }}
            disabled={ctx.disabled}
            variant="table"
          />
        );
      }
      return <span>{typeOptMap[row.valueType as string] ?? row.valueType}</span>;
    }

    if (col.identifier === "valueName") {
      const endpoint = PERMISSION_DEFAULT_TYPE_ENDPOINT[row.valueType as string] ?? "";
      let lookupParams: Record<string, string> | undefined;
      if (organizationUuid) {
        // bankAccount, cashbox, warehouse, contact используют ownerType/ownerUuid
        // (иначе фильтр по организации не применяется в Lookup)
        if (["bankAccount", "cashbox", "warehouse", "contact"].includes(row.valueType as string)) {
          lookupParams = { ownerType: "organization", ownerUuid: organizationUuid };
        } else {
          lookupParams = { organizationUuid };
        }
      }
      if (ctx.inlineEditing && endpoint) {
        return (
          <LookupField
            label=""
            name={`upd_val_${row.id}`}
            endpoint={endpoint}
            displayField="name"
            value={(row.valueUuid as string) ?? ""}
            displayValue={(row.valueName as string) ?? ""}
            extraParams={lookupParams}
            onSelect={(uuid, dv) => {
              void ctx.handleLookupChange(row, "valueUuid", uuid, { valueName: dv });
            }}
            onClear={() => {
              void ctx.handleLookupChange(row, "valueUuid", "", { valueName: "" });
            }}
            disabled={ctx.disabled || !endpoint}
            width="100%"
            variant="table"
          />
        );
      }
      return <span>{(row.valueName as string) ?? ""}</span>;
    }

    return undefined;
  }, [organizationUuid, getAvailableOptions]);

  const defaultNewRow = useMemo(() => {
    return (rows: TDataItem[]) => {
      const valueType = getFirstUnused(rows);
      if (!valueType) return null; // all types present — abort (null-veto in SubTable)
      return { userUuid, organizationUuid, valueType, valueUuid: "", valueName: "" };
    };
  }, [userUuid, organizationUuid, getFirstUnused]);

  return (
    <SubTable
      model="user-defaults"
      componentName="UserDefaultsTable_part"
      columnsJson={DEFAULTS_COLUMNS}
      parentKey="userUuid"
      parentUuid={userUuid}
      extraQueryParams={{ organizationUuid }}
      defaultSort={{ id: "asc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      onItemsChange={onItemsChange}
      onAllItemsChange={handleAllItemsChange}
      renderCell={renderCell}
      defaultNewRow={defaultNewRow}
      disableAdd={disableAddProp ?? false}
      defaultInlineEditing={true}
      showEditModeToggle={false}
    />
  );
};
UserDefaultsTable.displayName = "UserDefaultsTable";

export default UserDefaultsTable;
export { UserDefaultsTable };
