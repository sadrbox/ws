import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TOpenModelFormProps } from "src/components/Table";
import Table from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Divider, Field } from "src/components/Field";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import ContactsTable from "../Contacts/ContactsTable";
import AvatarUpload from "src/components/AvatarUpload";
import { resolveOwnerName } from "src/utils/resolveOwnerName";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import { useFormError } from "src/hooks/useFormError";
import { commitPendingRows } from "src/services/commitPendingRows";
import FormPanel from "src/components/FormPanel";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "contactpersons";

interface TFormData {
  id?: number;
  uuid?: string;
  fullName: string;
  firstName: string;
  lastName: string;
  middleName: string;
  comment: string;
  avatarPath: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
  _pendingContacts?: TDataItem[];
}

const EMPTY_FORM: TFormData = {
  fullName: "", firstName: "", lastName: "", middleName: "", comment: "", avatarPath: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const ContactPersonsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const initialForm: TFormData = (() => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    if (data.ownerType) { init.ownerType = data.ownerType as OwnerType; init.ownerUuid = (data.ownerUuid as string) || ""; init.ownerName = (data.ownerName as string) || ""; }
    return init;
  })();
  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "contact-persons-form", uuid ?? "new", initialForm,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError, errorRevision] = useFormError();
  const [isEditMode, setIsEditMode] = useState(!!uuid);
  const contactsPendingRef = useRef<TDataItem[]>([]);
  const queryClient = useQueryClient();

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => setFormData(prev => ({ ...prev, [field]: value })), []);

  const tabs = useMemo(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: 'general', label: translate("general") || 'Общие сведения', component: (
          <div className={styles.FormBodyParts}>
            <Group align="row" gap="12px" className={styles.Form}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                <Field label="ФИО" name={`${formUid}_fullName`} value={formData.fullName} onChange={e => handleFieldChange("fullName", e.target.value)} disabled={isLoading} />
                <OwnerLookupField
                  name={`${formUid}_owner`}
                  ownerType={formData.ownerType}
                  ownerUuid={formData.ownerUuid}
                  ownerName={formData.ownerName}
                  onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
                    setFormData(prev => ({ ...prev, ownerType, ownerUuid, ownerName }))
                  }
                  disabled={isLoading}
                  typeLocked={!uuid && !!data?.ownerType}
                  allowedTypes={["organization", "counterparty"]}
                />
                <Field label="Комментарий" name={`${formUid}_comment`} value={formData.comment} onChange={e => handleFieldChange("comment", e.target.value)} disabled={isLoading} />
              </div>
              {isEditMode && formData.uuid && (
                <AvatarUpload
                  endpoint={MODEL_ENDPOINT}
                  entityUuid={formData.uuid}
                  hasAvatar={!!formData.avatarPath}
                  disabled={isLoading}
                />
              )}
            </Group>
            {isEditMode && (
              <>
                <Divider />
                <Group align="row" gap="12px" className={styles.Form}>
                  <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                    <Field label="ID" name={`${formUid}_id`} width="80px" value={String(formData.id ?? "-")} disabled />
                    <Field label="UUID" name={`${formUid}_uuid`} width="260px" value={String(formData.uuid ?? "-")} disabled />
                  </div>
                </Group>
              </>
            )}
          </div>
        ),
      },
    ];
    if (isEditMode && formData.uuid) {
      t.push({ id: 'contacts', label: 'Контакты', component: <ContactsTable
          deferRemoteChanges={true}
          ownerType="contactperson"
          parentUuid={formData.uuid ?? ""}
          parentName={formData.fullName}
          initialPendingRows={formData._pendingContacts}
          onItemsChange={(items) => {
            const pending = (items ?? []).filter((r: any) => r._pendingAction);
            contactsPendingRef.current = pending;
            setFormData(prev => {
              if (JSON.stringify(prev._pendingContacts) === JSON.stringify(pending)) return prev;
              return { ...prev, _pendingContacts: pending.length ? pending : undefined };
            });
          }}
        /> });
    }
    return t;
  }, [formData, formUid, isLoading, isEditMode, handleFieldChange, data]);

  const commitPending = useCallback(async (parentUuid: string) => {
    await commitPendingRows("contacts", contactsPendingRef.current, parentUuid, "ownerUuid", translate("ContactsList") || "Контакты", {
      extraFields: { ownerType: "contactperson" },
    });
  }, []);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      const oName = await resolveOwnerName(d.ownerType, d.ownerUuid);
      setFormData({
        fullName: d.fullName ?? `${d.lastName || ""} ${d.firstName || ""}`.trim(),
        firstName: d.firstName ?? "", lastName: d.lastName ?? "", middleName: d.middleName ?? "",
        comment: d.comment ?? "",
        avatarPath: d.avatarPath ?? "",
        ownerType: (d.ownerType as OwnerType) ?? "", ownerUuid: d.ownerUuid ?? "", ownerName: oName,
        id: d.id, uuid: d.uuid,
      });
      // Обновляем вложенную SubTable — invalidate кэш контактов
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    } catch (err: any) { setError(err.response?.data?.message || "Не удалось загрузить данные"); }
    finally { setIsLoading(false); }
  }, [queryClient]);

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    const payload: Record<string, unknown> = {
      firstName: formData.firstName || null,
      lastName: formData.lastName || null,
      middleName: formData.middleName || null,
      fullName: formData.fullName?.trim() || null,
      comment: formData.comment?.trim() || null,
      ownerType: formData.ownerType || null,
      ownerUuid: formData.ownerUuid || null,
    };
    try {
      const response = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      setFormData(prev => ({
        ...prev, ...saved,
        fullName: saved.fullName ?? prev.fullName,
        firstName: saved.firstName ?? "", lastName: saved.lastName ?? "", middleName: saved.middleName ?? "",
        comment: saved.comment ?? "",
        avatarPath: saved.avatarPath ?? prev.avatarPath,
        ownerType: (saved.ownerType as OwnerType) ?? prev.ownerType,
        ownerUuid: saved.ownerUuid ?? prev.ownerUuid,
        ownerName: saved.ownerName ?? prev.ownerName,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate("ContactPersonsList") || "Контактные лица"}: ${saved.fullName || "?"} • ${saved.id ?? "?"}`);
      // Commit pending contacts
      await commitPending(saved.uuid);
      contactsPendingRef.current = [];
      setFormData(prev => { const { _pendingContacts, ...rest } = prev; return rest as TFormData; });
      // Отложенный invalidate — ждём один тик рендера, чтобы SubTable
      // успел получить новый parentUuid и включить свой query (enabled: true).
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
      }, 0);
      queryClient.invalidateQueries({ queryKey: ["contactpersons"] });
      onSave?.();
      return true;
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Не удалось сохранить");
      return false;
    } finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel, commitPending]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  return (
    <div className={styles.FormWrapper}>
      <FormPanel
        onSaveAndClose={handleSaveAndClose}
        onSave={handleSave}
        onClose={handleClose}
        onReload={uuid ? () => loadFormData(uuid) : undefined}
        isLoading={isLoading}
        showReload={isEditMode}
      />
      <FormError message={error} revision={errorRevision} onDismiss={() => setError(null)} />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
ContactPersonsForm.displayName = "ContactPersonsForm";

// LIST
interface ContactPersonsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const ContactPersonsList: FC<ContactPersonsListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ContactPersonsList_part" : "ContactPersonsList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT,
    componentName,
    columnsJson,
    defaultSort: { id: "asc" },
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField ? { [ownerField]: ownerUuid } as unknown as TDataItem : d;
    addPane({ label: isEdit ? `${t(componentName)}: ${d?.fullName || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`, component: ContactPersonsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(), });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField]);

  if (error) return (<div className="error-container"><div className="error-message"><h3>{t("errorTitle") || "Ошибка загрузки"}</h3><p>{(error as Error)?.message || "Неизвестная ошибка"}</p><button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button></div></div>);

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};

ContactPersonsList.displayName = "ContactPersonsList";
export { ContactPersonsList, ContactPersonsForm };
