import { FC, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import ContactsTable from "../Contacts/ContactsTable";
import AvatarUpload from "src/components/AvatarUpload";
import { resolveOwnerName } from "src/utils/resolveOwnerName";
import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "contactpersons";

interface TFields {
  id?: number; uuid?: string;
  fullName: string; firstName: string; lastName: string; middleName: string;
  comment: string; avatarPath: string;
  ownerType: OwnerType; ownerUuid: string; ownerName: string;
}

const DEFAULT_FIELDS: TFields = {
  fullName: "", firstName: "", lastName: "", middleName: "", comment: "", avatarPath: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const ContactPersonsForm: FC<Partial<TPane>> = (paneProps) => {
  const queryClient = useQueryClient();
  const { canWrite } = useAccessRight("ContactPerson");

  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (data?.uuid) return undefined;
    const init = { ...DEFAULT_FIELDS };
    if (data?.ownerType) { init.ownerType = data?.ownerType as OwnerType; init.ownerUuid = (data?.ownerUuid as string) || ""; init.ownerName = (data?.ownerName as string) || ""; }
    return init;
  })();

  // refetchType: "active" — ждём завершение refetch смонтированных
  // SubTable, чтобы useFormStore.submit() очистил pending-строки
  // только после появления свежих серверных данных.
  const invalidateSubTables = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["contacts"],
      refetchType: "active",
    });
  }, [queryClient]);

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "contact-persons-form", defaultFields: DEFAULT_FIELDS, initialFields, paneProps,
    tables: {
      contacts: { endpoint: "contacts", parentField: "ownerUuid", label: translate("ContactsList"), extraFields: { ownerType: "contactperson" } },
    },
    mapServerToForm: async (d, prev) => {
      const oName = await resolveOwnerName(d.ownerType, d.ownerUuid);
      return {
        ...(prev ?? DEFAULT_FIELDS),
        fullName: d.fullName ?? `${d.lastName || ""} ${d.firstName || ""}`.trim(),
        firstName: d.firstName ?? "", lastName: d.lastName ?? "", middleName: d.middleName ?? "",
        comment: d.comment ?? "", avatarPath: d.avatarPath ?? "",
        ownerType: (d.ownerType as OwnerType) ?? "", ownerUuid: d.ownerUuid ?? "", ownerName: oName,
        id: d.id, uuid: d.uuid,
      };
    },
    buildPayload: (fd) => ({
      firstName: fd.firstName || null, lastName: fd.lastName || null, middleName: fd.middleName || null,
      fullName: fd.fullName?.trim() || null, comment: fd.comment?.trim() || null,
      ownerType: fd.ownerType || null, ownerUuid: fd.ownerUuid || null,
    }),
    buildPaneLabel: (saved) => makePaneLabel("ContactPersonsList", "Контактные лица", saved),
    afterLoad: invalidateSubTables,
    afterSave: async () => {
      await invalidateSubTables();
      // Неявный invalidate родительского списка — не критичен для
      // порядка очистки pending, но тоже ждём.
      await queryClient.invalidateQueries({ queryKey: ["contactpersons"] });
    },
  });

  const contacts = form.useTable("contacts");

  const tabs = useMemo(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupCol>
                <GroupRow>
                  <Field label={translate("fullName")} name={`${form.formUid}_fullName`} value={form.fields.fullName} onChange={e => form.setField("fullName", e.target.value)} disabled={form.isLoading} />
                  {form.isEditMode && form.fields.uuid && (
                    <AvatarUpload endpoint={MODEL_ENDPOINT} entityUuid={form.fields.uuid} hasAvatar={!!form.fields.avatarPath} disabled={form.isLoading} />
                  )}
                </GroupRow>
                <OwnerLookupField name={`${form.formUid}_owner`} ownerType={form.fields.ownerType} ownerUuid={form.fields.ownerUuid} ownerName={form.fields.ownerName}
                  onOwnerChange={({ ownerType, ownerUuid, ownerName }) => form.setFields({ ownerType, ownerUuid, ownerName } as Partial<TFields>)}
                  disabled={form.isLoading} typeLocked={!form.uuid && !!paneProps.data?.ownerType} allowedTypes={["organization", "counterparty"]} />
                <Field label={translate("comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              </GroupCol>
            </div>
          </div>
        )
      },
    ];
    if (form.isEditMode && form.fields.uuid) {
      t.push({
        id: "contacts", label: translate("ContactsList"), component: (
          <ContactsTable deferRemoteChanges ownerType="contactperson" parentUuid={form.fields.uuid}
            parentName={form.fields.fullName} initialPendingRows={contacts.pending}
            onItemsChange={contacts.onItemsChange} showPrimaryButton={form.isEditMode && canWrite} />
        )
      });
    }
    return t;
  }, [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.uuid, paneProps.data, contacts, canWrite]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined} isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite} />
  );
};
ContactPersonsForm.displayName = "ContactPersonsForm";

const ContactPersonsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string }> = ({ variant, onSelectItem, ownerUuid, ownerField }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName="ContactPersonsList" columnsJson={columnsJson} FormComponent={ContactPersonsForm}
    getLabel={(d) => d?.fullName ? (d.fullName as string) : "?"} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} />
);
ContactPersonsList.displayName = "ContactPersonsList";

export { ContactPersonsList, ContactPersonsForm };
