import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import historyColumnsJson from "./historyColumns.json";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSubTableFor } from "src/utils/invalidateSubTableFor";
import { Field, FieldNumber, FieldSelect, FieldDate } from "src/components/Field";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useAppContext } from "src/app/context";
import { getFormatDateOnly } from "src/utils/datetime";
import LookupField from "src/components/Field/LookupField";
import { ContactsTable } from "../Contacts";
import EmployeeHistoryForm from "./EmployeeHistoryForm";
import AvatarUpload from "src/components/AvatarUpload";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import { FormRequiredScope } from "src/hooks/useFormRequired";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import SubTable, { type SubTableContext, type TCellValidator } from "src/components/SubTable";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

const MODEL_ENDPOINT = "employees";
const LIST_NAME = "EmployeesList";

interface TFields {
  id?: number; uuid?: string;
  lastName: string; firstName: string; middleName: string; fullName: string;
  iin: string; avatarPath: string;
}

const DEFAULT_FIELDS: TFields = {
  lastName: "", firstName: "", middleName: "", fullName: "", iin: "", avatarPath: "",
};

const EmployeesForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessPermission("Employee");
  const { canRead: canReadContacts } = useAccessPermission("Contact");
  const { canRead: canReadEmployeeHistory } = useAccessPermission("EmployeeHistory");
  const queryClient = useQueryClient();

  // refetchType: "active" — ждём завершение refetch смонтированных
  // SubTable, чтобы useFormStore.submit() очистил pending-строки
  // только после появления свежих серверных данных.
  const invalidateSubTables = useCallback(async (savedData: any) => {
    const uuid = savedData?.uuid ?? "";
    await Promise.all([
      invalidateSubTableFor(queryClient, "contacts", "ownerUuid", uuid),
      invalidateSubTableFor(queryClient, "employee-histories", "employeeUuid", uuid),
    ]);
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "employees-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      contacts: {
        endpoint: "contacts", parentField: "ownerUuid",
        label: translate("ContactsList"),
        batchEndpoint: "contacts/batch",
        createPayload: (r: any) => ({ value: r.value ?? "", contactType: r.contactType ?? null }),
        updatePayload: (r: any) => ({ value: r.value ?? "", contactType: r.contactType ?? null }),
        extraFields: { ownerType: "employee" },
      },
      history: {
        endpoint: "employee-histories", parentField: "employeeUuid",
        label: translate("EmployeeHistoriesList"),
        batchEndpoint: "employee-histories/batch",
        createPayload: (r: any) => ({ eventDate: r.eventDate ?? null, eventType: r.eventType ?? "hire", salary: r.salary ?? null, positionUuid: r.positionUuid ?? null, organizationUuid: r.organizationUuid ?? null }),
        updatePayload: (r: any) => ({ eventDate: r.eventDate ?? null, eventType: r.eventType ?? "hire", salary: r.salary ?? null, positionUuid: r.positionUuid ?? null, organizationUuid: r.organizationUuid ?? null }),
      },
    },
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      lastName: d.lastName ?? "", firstName: d.firstName ?? "",
      middleName: d.middleName ?? "", fullName: d.fullName ?? "", iin: d.iin ?? "",
      avatarPath: d.avatarPath ?? "",
      id: d.id, uuid: d.uuid,
    }),
    buildPayload: (fd) => {
      if (!fd.lastName?.trim()) return "Фамилия обязательна";
      return {
        lastName: fd.lastName.trim(), firstName: fd.firstName.trim(),
        middleName: fd.middleName.trim(), fullName: fd.fullName.trim(), iin: fd.iin.trim(),
      };
    },
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Сотрудники", saved, saved.fullName),
    afterSave: invalidateSubTables,
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

  // При изменении фамилии/имени/отчества — автоматически пересчитывает fullName
  const handleNameFieldChange = useCallback((field: "lastName" | "firstName" | "middleName", value: string) => {
    const current = form.store.getSnapshot().fields;
    const last = field === "lastName" ? value : current.lastName;
    const first = field === "firstName" ? value : current.firstName;
    const middle = field === "middleName" ? value : current.middleName;
    const fullName = [last, first, middle].filter(Boolean).join(" ");
    form.setFields({ [field]: value, fullName } as Partial<TFields>);
  }, [form.store, form.setFields]);

  const contacts = form.useTable("contacts");
  const history = form.useTable("history");

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <Field label={translate("lastName")} name={`${form.formUid}_lastName`} minWidth="200px" value={form.fields.lastName} onChange={e => handleNameFieldChange("lastName", e.target.value)} disabled={form.isLoading} required />
                    <Field label={translate("firstName")} name={`${form.formUid}_firstName`} minWidth="180px" value={form.fields.firstName} onChange={e => handleNameFieldChange("firstName", e.target.value)} disabled={form.isLoading} />
                  </Group>
                  <Group className={styles.w1of2}>
                    <Field label={translate("middleName")} name={`${form.formUid}_middleName`} minWidth="180px" value={form.fields.middleName} onChange={e => handleNameFieldChange("middleName", e.target.value)} disabled={form.isLoading} />
                  </Group>
                </GroupRow>
                <Group>
                    <Field label={translate("fullName")} name={`${form.formUid}_fullName`} minWidth="400px" value={form.fields.fullName} disabled />
                </Group>
                <GroupRow>
                  <Group className={styles.w1of2}>
                    <Field label={translate("iin")} name={`${form.formUid}_iin`} minWidth="200px" value={form.fields.iin} onChange={e => form.setField("iin", e.target.value)} disabled={form.isLoading} />
                  </Group>
                  {form.isEditMode && form.fields.uuid && (
                    <Group className={styles.w1of2}>
                      <AvatarUpload endpoint={MODEL_ENDPOINT} entityUuid={form.fields.uuid} hasAvatar={!!form.fields.avatarPath} disabled={form.isLoading} />
                    </Group>
                  )}
                </GroupRow>
              </GroupCol>
            </div>

            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
          </div>
        )
      },
    ];

    if (form.isEditMode && form.fields.uuid) {
      if (canReadEmployeeHistory) result.push({
        id: "history", label: translate("EmployeeHistoriesList"), component: (
          <EmployeeHistoryTable employeeUuid={form.fields.uuid} disabled={form.isLoading} deferRemoteChanges initialPendingRows={history.pending} onItemsChange={history.onItemsChange} />
        )
      });
      if (canReadContacts) result.push({
        id: "contacts", label: translate("ContactsList"), component: (
          <ContactsTable deferRemoteChanges ownerType="employee" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.fullName || form.fields.lastName} initialPendingRows={contacts.pending} onItemsChange={contacts.onItemsChange} showPrimaryButton={form.isEditMode && canWrite} />
        )
      });
    }

    return result;
  }, [form.formUid, form.fields, form.isLoading, form.isEditMode, form.setField, handleNameFieldChange, contacts, history, canReadContacts, canReadEmployeeHistory, canWrite]);

  return (
    <FormRequiredScope requiredKeys={["lastName"]} active>
      <ModelForm paneId={form.paneId} endpoint={MODEL_ENDPOINT} recordUuid={form.fields.uuid} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
        onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
        readonly={!canWrite} />
    </FormRequiredScope>
  );
};
EmployeesForm.displayName = "EmployeesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const EmployeesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant, onSelectItem }) => (
  <ModelList
    endpoint={MODEL_ENDPOINT}
    listName={LIST_NAME}
    columnsJson={columnsJson}
    FormComponent={EmployeesForm}
    getLabel={(d) => (d?.fullName || d?.lastName || "?") as string}
    variant={variant}
    onSelectItem={onSelectItem}
  />
);

EmployeesList.displayName = "EmployeesList";

// ═══════════════════════════════════════════════════════════════════════════
// TABLE — SubTable кадровой истории (EmployeeHistory)
// ═══════════════════════════════════════════════════════════════════════════

const EH_MODEL = "employee-histories";
const EH_COMPONENT = "EmployeeHistoryList_part";

const EVENT_TYPE_OPTIONS = [
  { value: "hire", label: "Приём" },
  { value: "fire", label: "Увольнение" },
  { value: "transfer", label: "Перемещение" },
];

export interface EmployeeHistoryTableProps {
  employeeUuid: string;
  disabled?: boolean;
  deferRemoteChanges?: boolean;
  onItemsChange?: (items: TDataItem[]) => void;
  initialPendingRows?: TDataItem[];
}

const EmployeeHistoryTable: FC<EmployeeHistoryTableProps> = ({
  employeeUuid, disabled = false, deferRemoteChanges = false, onItemsChange, initialPendingRows,
}) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const eventTypeMap = useMemo(() => Object.fromEntries(EVENT_TYPE_OPTIONS.map(o => [o.value, o.label])), []);

  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "eventDate") {
      const val = typeof row.eventDate === "string" ? row.eventDate.slice(0, 10) : "";
      if (ctx.inlineEditing) return <FieldDate label="" name={`hist_eventDate_${row.id}`} value={val} onChange={e => ctx.handleInlineChange(row, "eventDate", e.target.value)} disabled={ctx.disabled} variant="table" />;
      return <span>{val ? getFormatDateOnly(val) : ""}</span>;
    }
    if (col.identifier === "eventType") {
      if (ctx.inlineEditing) return <FieldSelect name={`hist_event_${row.id}`} options={EVENT_TYPE_OPTIONS} value={(row.eventType as string) ?? ""} onChange={e => ctx.handleInlineChange(row, "eventType", e.target.value)} disabled={ctx.disabled} variant="table" />;
      return <span>{eventTypeMap[row.eventType as string] ?? row.eventType}</span>;
    }
    if (col.identifier === "organization.name") {
      if (ctx.inlineEditing) return (
        <LookupField label="" name={`hist_org_${row.id}`} value={(row.organizationUuid as string) ?? ""} displayValue={(row.organization as any)?.name ?? ""} endpoint="organizations" displayField="name"
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "organizationUuid", uuid, { organization: item && uuid ? { uuid, name: item.name ?? "" } : null })}
          onClear={() => ctx.handleLookupChange(row, "organizationUuid", null, { organization: null })}
          disabled={ctx.disabled} width="100%" variant="table" />
      );
      return <span>{(row.organization as any)?.name ?? ""}</span>;
    }
    if (col.identifier === "position.name") {
      if (ctx.inlineEditing) return (
        <LookupField label="" name={`hist_pos_${row.id}`} value={(row.positionUuid as string) ?? ""} displayValue={(row.position as any)?.name ?? ""} endpoint="positions" displayField="name"
          onSelect={(uuid, _dv, item) => ctx.handleLookupChange(row, "positionUuid", uuid, { position: item && uuid ? { uuid, name: item.name ?? "" } : null })}
          onClear={() => ctx.handleLookupChange(row, "positionUuid", null, { position: null })}
          disabled={ctx.disabled} width="100%" variant="table" />
      );
      return <span>{(row.position as any)?.name ?? ""}</span>;
    }
    if (col.identifier === "salary") {
      if (ctx.inlineEditing) return <FieldNumber name={`hist_salary_${row.id}`} value={row.salary != null ? String(row.salary) : ""} onChange={e => ctx.handleInlineChange(row, "salary", e.target.value)} disabled={ctx.disabled} step="0.1" decimals={2} textAlign="right" width="100%" actions={[]} variant="table" />;
      return <span>{row.salary != null ? String(Number(row.salary)) : ""}</span>;
    }
    return undefined;
  }, [eventTypeMap]);

  const validationRules = useMemo<Record<string, TCellValidator>>(() => ({
    salary: (value) => {
      if (value === "" || value == null) return undefined;
      const n = Number(value);
      if (isNaN(n)) return "Должно быть числом";
      if (n < 0) return "Не может быть отрицательным";
      return undefined;
    },
    eventDate: (value) => (!value ? "Дата обязательна" : undefined),
  }), []);

  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: [EH_MODEL] });
      _ctx.refetch();
    };
    addPane({
      label: makePaneLabelFromData("EmployeeHistoriesList", "Кадровая история", isEdit ? data as any : null),
      component: EmployeeHistoryForm,
      data: { ...(data ?? {}), employeeUuid } as any,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, employeeUuid, queryClient]);

  const defaultNewRow = useMemo(() => ({
    eventDate: new Date().toISOString().slice(0, 10),
    eventType: "hire",
    salary: null,
    positionUuid: null,
    organizationUuid: null,
  }), []);

  return (
    <SubTable
      model={EH_MODEL}
      componentName={EH_COMPONENT}
      columnsJson={historyColumnsJson}
      parentKey="employeeUuid"
      parentUuid={employeeUuid}
      defaultSort={{ eventDate: "desc" }}
      disabled={disabled}
      deferRemoteChanges={deferRemoteChanges}
      initialPendingRows={initialPendingRows}
      emptyMessage={translate("saveToEmployeeHistory")}
      renderCell={renderCell}
      openFormFor={openFormFor}
      defaultNewRow={defaultNewRow}
      onItemsChange={onItemsChange}
      validationRules={validationRules}
    />
  );
};

EmployeeHistoryTable.displayName = "EmployeeHistoryTable";
export { EmployeesList, EmployeesForm, EmployeeHistoryTable };
