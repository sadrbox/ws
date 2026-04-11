import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import LookupField from "src/components/Field/LookupField";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import Tabs from "src/components/Tabs";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "contacts";
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  value: string;
  contactTypeUuid: string;
  contactTypeName: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

const EMPTY_FORM: TFormData = {
  value: "", contactTypeUuid: "", contactTypeName: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const ContactsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { canWrite } = useAccessRight("Contact");
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const initialForm: TFormData = (() => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    const name = (data.ownerName as string) || "";
    if (data.organizationUuid) { init.ownerType = "organization"; init.ownerUuid = data.organizationUuid as string; init.ownerName = name; }
    else if (data.counterpartyUuid) { init.ownerType = "counterparty"; init.ownerUuid = data.counterpartyUuid as string; init.ownerName = name; }
    else if (data.contactPersonUuid) { init.ownerType = "contactperson"; init.ownerUuid = data.contactPersonUuid as string; init.ownerName = name; }
    else if (data.employeeUuid) { init.ownerType = "employee"; init.ownerUuid = data.employeeUuid as string; init.ownerName = name; }
    return init;
  })();
  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "contacts-form", uuid ?? "new", initialForm,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = response.data?.item ?? response.data;
      const ot: OwnerType = d.organizationUuid ? "organization" : d.counterpartyUuid ? "counterparty" : d.contactPersonUuid ? "contactperson" : d.employeeUuid ? "employee" : "";
      const ou = d.organizationUuid || d.counterpartyUuid || d.contactPersonUuid || d.employeeUuid || "";
      const on = d.organization?.shortName || d.counterparty?.shortName || d.contactPerson?.fullName || d.employee?.fullName || d.ownerName || "";
      setFormData({
        value: d.value ?? "", contactTypeUuid: d.contactTypeUuid ?? "",
        contactTypeName: d.contactType?.shortName ?? d.contactType?.name ?? "",
        ownerType: ot, ownerUuid: ou, ownerName: on,
        id: d.id, uuid: d.uuid,
      });
    } catch (err: any) {
      setError(err.response?.data?.message || "Не удалось загрузить данные");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    if (!formData.value?.trim()) { setError("Значение обязательно"); setIsLoading(false); return false; }
    const payload: Record<string, unknown> = {
      value: formData.value.trim(),
      contactTypeUuid: formData.contactTypeUuid || null,
      ownerName: formData.ownerName?.trim() || null,
      organizationUuid: formData.ownerType === "organization" ? formData.ownerUuid || null : null,
      counterpartyUuid: formData.ownerType === "counterparty" ? formData.ownerUuid || null : null,
      contactPersonUuid: formData.ownerType === "contactperson" ? formData.ownerUuid || null : null,
      employeeUuid: formData.ownerType === "employee" ? formData.ownerUuid || null : null,
    };
    try {
      const response = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      const sot: OwnerType = saved.organizationUuid ? "organization" : saved.counterpartyUuid ? "counterparty" : saved.contactPersonUuid ? "contactperson" : saved.employeeUuid ? "employee" : "";
      const sou = saved.organizationUuid || saved.counterpartyUuid || saved.contactPersonUuid || saved.employeeUuid || "";
      const son = saved.organization?.shortName || saved.counterparty?.shortName || saved.contactPerson?.fullName || saved.employee?.fullName || "";
      setFormData(prev => ({
        ...prev, ...saved, value: saved.value ?? "",
        contactTypeUuid: saved.contactTypeUuid ?? "",
        contactTypeName: saved.contactType?.shortName ?? saved.contactType?.name ?? prev.contactTypeName,
        ownerType: sot || prev.ownerType, ownerUuid: sou || prev.ownerUuid,
        ownerName: son || prev.ownerName,
      }));
      setIsEditMode(true);
      if (uniqId) {
        const label = `${translate("ContactsList") || "ContactsList"}: ${saved.value || "?"} • ${saved.id ?? "?"}`;
        updatePaneLabel(uniqId, label);
      }
      onSave?.();
      return true;
    } catch (err: any) {
      let msg = "Не удалось сохранить";
      if (err.response?.status === 400) msg = err.response.data?.message || "Ошибка валидации";
      else if (err.message) msg = err.message;
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [formData, isEditMode, uuid, onSave]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  const generalTab = useMemo(() => (
    <div className={styles.FormBodyParts}>
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                  <Field label="Значение *" name={`${formUid}_value`} minWidth="339px" value={formData.value} onChange={e => handleFieldChange("value", e.target.value)} disabled={isLoading} />
                  <LookupField
                    label="Тип контакта" name={`${formUid}_contactTypeUuid`} minWidth="339px"
                    value={formData.contactTypeUuid} displayValue={formData.contactTypeName}
                    endpoint="contacttypes" displayField="shortName"
                    columns={[{ key: "shortName", label: "Наименование" }]}
                    onSelect={(uuid: string, display: string) => setFormData(prev => ({ ...prev, contactTypeUuid: uuid, contactTypeName: display }))}
                    disabled={isLoading}
                  />
                  <OwnerLookupField
                    ownerType={formData.ownerType} ownerUuid={formData.ownerUuid} ownerName={formData.ownerName}
                    name={`${formUid}_owner`}
                    onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
                      setFormData(prev => ({ ...prev, ownerType, ownerUuid, ownerName }))}
                    typeLocked={!uuid && (!!data?.organizationUuid || !!data?.counterpartyUuid || !!data?.contactPersonUuid || !!data?.employeeUuid)}
                    disabled={isLoading}
                  />
                </div>
              </Group>
              {isEditMode && (
                <>
                  <Divider />
                  <Group align="row" gap="12px" className={styles.Form}>
                    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                      <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                      <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                    </div>
                  </Group>
                </>
              )}
            </div>
  ), [formData, isLoading, isEditMode, formUid, handleFieldChange, setFormData]);

  const tabs = useMemo<{ id: string; label: string; component: React.ReactNode }[]>(() => [
    { id: "general", label: translate("general") || "Общие сведения", component: generalTab },
  ], [generalTab]);

  return (
    <div className={styles.FormWrapper}>
      <FormPanel readonly={!canWrite} onSaveAndClose={handleSaveAndClose} onSave={handleSave} onClose={handleClose} onReload={uuid ? () => loadFormData(uuid) : undefined} isLoading={isLoading} showReload={isEditMode} />
      <FormError message={error} onDismiss={() => setError(null)} />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
ContactsForm.displayName = "ContactsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface ContactsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
  ownerName?: string;
}

const ContactsList: FC<ContactsListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField, ownerName } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ContactsList_part" : "ContactsList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT, componentName, columnsJson,
    defaultSort: { id: "asc" },
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField
      ? { [ownerField]: ownerUuid, ownerName: ownerName || "" } as unknown as TDataItem
      : d;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.value || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: ContactsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField, ownerName]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};

ContactsList.displayName = "ContactsList";
export { ContactsList, ContactsForm };
