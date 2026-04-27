import { FC, useMemo, useCallback } from "react";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Field } from "src/components/Field";
import { GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import ContactsTable from "../Contacts/ContactsTable";
import EmployeeHistoryTable from "./EmployeeHistoryTable";
import AvatarUpload from "src/components/AvatarUpload";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

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
  const { canWrite } = useAccessRight("Employee");
  const { canRead: canReadContacts }        = useAccessRight("Contact");
  const { canRead: canReadEmployeeHistory } = useAccessRight("EmployeeHistory");
  const queryClient = useQueryClient();

  const invalidateSubTables = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["employee-histories"] });
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "employees-form", defaultFields: DEFAULT_FIELDS, paneProps,
    tables: {
      contacts: {
        endpoint: "contacts", parentField: "ownerUuid",
        label: translate("ContactsList") || "Контакты",
        createPayload: (r: any) => ({ value: r.value ?? "", contactTypeUuid: r.contactTypeUuid ?? null }),
        updatePayload: (r: any) => ({ value: r.value ?? "", contactTypeUuid: r.contactTypeUuid ?? null }),
        extraFields: { ownerType: "employee" },
      },
      history: {
        endpoint: "employee-histories", parentField: "employeeUuid",
        label: translate("EmployeeHistoriesList") || "Кадровая история",
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
    buildPaneLabel: (saved) => makePaneLabel(LIST_NAME, "Сотрудники", saved),
    afterLoad: invalidateSubTables,
    afterSave: async () => { setTimeout(invalidateSubTables, 0); },
  });

  // При изменении фамилии/имени/отчества — автоматически пересчитывает fullName
  const handleNameFieldChange = useCallback((field: "lastName" | "firstName" | "middleName", value: string) => {
    const current = form.store.getSnapshot().fields;
    const last    = field === "lastName"   ? value : current.lastName;
    const first   = field === "firstName"  ? value : current.firstName;
    const middle  = field === "middleName" ? value : current.middleName;
    const fullName = [last, first, middle].filter(Boolean).join(" ");
    form.setFields({ [field]: value, fullName } as Partial<TFields>);
  }, [form.store, form.setFields]);

  const contacts = form.useTable("contacts");
  const history = form.useTable("history");

  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      { id: "general", label: translate("general") || "Основное", component: (
        <div className={styles.FormWrapper}>
          <div className={styles.Form}>
            {form.isEditMode && (
              <GroupRow>
                <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
              </GroupRow>
            )}
            <div style={{ display: "flex", flexDirection: "row", gap: "24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, maxWidth: 640 }}>
              <GroupRow>
                <Field label="Фамилия *" name={`${form.formUid}_lastName`} minWidth="200px" value={form.fields.lastName} onChange={e => handleNameFieldChange("lastName", e.target.value)} disabled={form.isLoading} />
                <Field label="Имя" name={`${form.formUid}_firstName`} minWidth="180px" value={form.fields.firstName} onChange={e => handleNameFieldChange("firstName", e.target.value)} disabled={form.isLoading} />
                <Field label="Отчество" name={`${form.formUid}_middleName`} minWidth="180px" value={form.fields.middleName} onChange={e => handleNameFieldChange("middleName", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
              <GroupRow>
                <Field label="ФИО" name={`${form.formUid}_fullName`} minWidth="400px" value={form.fields.fullName} disabled />
              </GroupRow>
              <GroupRow>
                <Field label="ИИН" name={`${form.formUid}_iin`} minWidth="200px" value={form.fields.iin} onChange={e => form.setField("iin", e.target.value)} disabled={form.isLoading} />
              </GroupRow>
            </div>
            {form.isEditMode && form.fields.uuid && (
              <AvatarUpload endpoint={MODEL_ENDPOINT} entityUuid={form.fields.uuid} hasAvatar={!!form.fields.avatarPath} disabled={form.isLoading} />
            )}
          </div>
          </div>
        </div>
      )},
    ];

    if (form.isEditMode && form.fields.uuid) {
      if (canReadEmployeeHistory) result.push({ id: "history", label: translate("EmployeeHistoriesList") || "Кадровая история", component: (
        <EmployeeHistoryTable employeeUuid={form.fields.uuid} disabled={form.isLoading} deferRemoteChanges initialPendingRows={history.pending} onItemsChange={history.onItemsChange} />
      )});
      if (canReadContacts) result.push({ id: "contacts", label: translate("ContactsList") || "Контакты", component: (
        <ContactsTable deferRemoteChanges ownerType="employee" parentUuid={form.fields.uuid ?? ""} parentName={form.fields.fullName || form.fields.lastName} initialPendingRows={contacts.pending} onItemsChange={contacts.onItemsChange} />
      )});
    }

    return result;
  }, [form.formUid, form.fields, form.isLoading, form.isEditMode, form.setField, handleNameFieldChange, contacts, history, canReadContacts, canReadEmployeeHistory]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined} isLoading={form.isLoading}
      readonly={!canWrite} isDirty={form.isDirty} />
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
export { EmployeesList, EmployeesForm };
