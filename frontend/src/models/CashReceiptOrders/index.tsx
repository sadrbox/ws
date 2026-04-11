import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import Tabs from "src/components/Tabs";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "cash-receipt-orders";
const LIST_NAME = "CashReceiptOrdersList";
const FORM_LABEL = "ПКО";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

interface TFormData {
  id?: number; uuid?: string;
  documentNumber: string; documentDate: string; description: string; amount: string; status: string;
  ownerType: OwnerType; ownerUuid: string; ownerName: string;
}
const EMPTY_FORM: TFormData = { documentNumber: "", documentDate: "", description: "", amount: "", status: "draft", ownerType: "", ownerUuid: "", ownerName: "" };

const CashReceiptOrdersForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { canWrite } = useAccessRight("CashReceiptOrder");
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();
  const defaultOrg = useDefaultOrganization();
  const initialForm: TFormData = (() => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    const name = (data.ownerName as string) || "";
    if (data.organizationUuid) { init.ownerType = "organization"; init.ownerUuid = data.organizationUuid as string; init.ownerName = name; }
    else if (data.counterpartyUuid) { init.ownerType = "counterparty"; init.ownerUuid = data.counterpartyUuid as string; init.ownerName = name; }
    else if (defaultOrg.organizationUuid) { init.ownerType = "organization"; init.ownerUuid = defaultOrg.organizationUuid; init.ownerName = defaultOrg.organizationName; }
    return init;
  })();
  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "cash-receipt-orders-form", uuid ?? "new", initialForm,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      let oType: OwnerType = "", oUuid = "", oName = "";
      if (d.organizationUuid) { oType = "organization"; oUuid = d.organizationUuid; oName = d.organization?.shortName ?? ""; }
      else if (d.counterpartyUuid) { oType = "counterparty"; oUuid = d.counterpartyUuid; oName = d.counterparty?.shortName ?? ""; }
      setFormData({ documentNumber: d.documentNumber ?? "", documentDate: d.documentDate?.slice(0, 10) ?? "", description: d.description ?? "", amount: d.amount != null ? String(d.amount) : "", status: d.status ?? "draft", ownerType: oType, ownerUuid: oUuid, ownerName: oName, id: d.id, uuid: d.uuid });
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); } finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);
  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => { setFormData(prev => ({ ...prev, [field]: value })); }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    const payload: Record<string, unknown> = {
      documentNumber: formData.documentNumber?.trim() || null, documentDate: formData.documentDate || null,
      description: formData.description?.trim() || null, amount: formData.amount ? parseFloat(formData.amount) : null,
      status: formData.status || "draft", ownerName: formData.ownerName?.trim() || null,
      organizationUuid: formData.ownerType === "organization" ? (formData.ownerUuid || null) : null,
      counterpartyUuid: formData.ownerType === "counterparty" ? (formData.ownerUuid || null) : null,
    };
    try {
      const res = isEditMode && (uuid || formData.uuid) ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload) : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      let oType: OwnerType = formData.ownerType, oUuid = formData.ownerUuid, oName = formData.ownerName;
      if (saved.organizationUuid) { oType = "organization"; oUuid = saved.organizationUuid; oName = saved.organization?.shortName ?? oName; }
      else if (saved.counterpartyUuid) { oType = "counterparty"; oUuid = saved.counterpartyUuid; oName = saved.counterparty?.shortName ?? oName; }
      setFormData(prev => ({ ...prev, ...saved, documentNumber: saved.documentNumber ?? "", documentDate: saved.documentDate?.slice(0, 10) ?? "", description: saved.description ?? "", amount: saved.amount != null ? String(saved.amount) : "", status: saved.status ?? "draft", ownerType: oType, ownerUuid: oUuid, ownerName: oName }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate(LIST_NAME) || FORM_LABEL}: ${saved.documentNumber || "?"} • ${saved.id ?? "?"}`);
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; } finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  const generalTab = useMemo(() => (
    <div className={styles.FormBodyParts}>
              <Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                <Field label="Номер документа" name={`${formUid}_docNum`} minWidth="339px" value={formData.documentNumber} onChange={e => handleFieldChange("documentNumber", e.target.value)} disabled={isLoading} />
                <FieldDate label="Дата документа" name={`${formUid}_docDate`} minWidth="200px" value={formData.documentDate} onChange={e => handleFieldChange("documentDate", e.target.value)} disabled={isLoading} />
                <Field label="Сумма" name={`${formUid}_amount`} minWidth="200px" value={formData.amount} onChange={e => handleFieldChange("amount", e.target.value)} disabled={isLoading} />
                <FieldSelect label="Статус" name={`${formUid}_status`} value={formData.status} options={STATUS_OPTIONS} onChange={e => handleFieldChange("status", e.target.value)} disabled={isLoading} />
                <OwnerLookupField name={`${formUid}_owner`} ownerType={formData.ownerType} ownerUuid={formData.ownerUuid} ownerName={formData.ownerName} onOwnerChange={({ ownerType, ownerUuid, ownerName }) => setFormData(prev => ({ ...prev, ownerType, ownerUuid, ownerName }))} disabled={isLoading} typeLocked={!uuid && (!!data?.organizationUuid || !!data?.counterpartyUuid)} minWidth="339px" />
                <FieldTextarea label="Описание" name={`${formUid}_description`} value={formData.description} onChange={e => handleFieldChange("description", e.target.value)} disabled={isLoading} minWidth="339px" minHeight="80px" rows={4} />
              </div></Group>
              {isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
              </div></Group></>}
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
CashReceiptOrdersForm.displayName = "CashReceiptOrdersForm";

interface CashReceiptOrdersListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; ownerName?: string; }

const CashReceiptOrdersList: FC<CashReceiptOrdersListProps> = ({ variant = "default", onSelectItem, ownerUuid, ownerField, ownerName } = {}) => {
  const isPartOf = !!ownerUuid; const componentName = isPartOf ? `${LIST_NAME}_part` : LIST_NAME;
  const { addPane } = useAppContext().windows; const t = (k: string) => translate(k) || k;
  const ownerFilter = useMemo(() => { if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } }; return undefined; }, [ownerUuid, ownerField]);
  const { error, refetch, buildTableProps } = useModelListState({ model: MODEL_ENDPOINT, componentName, columnsJson, defaultSort: { id: "desc" }, columnsVariant: isPartOf ? "part" : undefined, ownerFilter });
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data; const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField ? { [ownerField]: ownerUuid, ownerName: ownerName || "" } as unknown as TDataItem : d;
    const title = isEdit ? (d?.documentNumber ? String(d.documentNumber).slice(0, 50) : t("noName")) : t("new");
    addPane({ label: `${t(componentName)}: ${title} • ${d?.id ?? "?"}`, component: CashReceiptOrdersForm, data: newData, onSave: () => refetch(), onClose: () => refetch() });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField, ownerName]);
  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};
CashReceiptOrdersList.displayName = "CashReceiptOrdersList";
export { CashReceiptOrdersList, CashReceiptOrdersForm };
