import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import FilesPanel from "src/models/Files";
import { Divider, Field, FieldDate } from "src/components/Field";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { resolveOwnerName } from "src/utils/resolveOwnerName";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "contracts";
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  shortName: string;
  contractNumber: string;
  contractText: string;
  startDate: string;
  endDate: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

const EMPTY_FORM: TFormData = {
  shortName: "", contractNumber: "", contractText: "",
  startDate: "", endDate: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const ContractsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();
  const defaultOrg = useDefaultOrganization();

  const initialForm: TFormData = (() => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    if (data.ownerType) { init.ownerType = data.ownerType as OwnerType; init.ownerUuid = (data.ownerUuid as string) || ""; init.ownerName = (data.ownerName as string) || ""; }
    else if (defaultOrg.organizationUuid) { init.ownerType = "organization"; init.ownerUuid = defaultOrg.organizationUuid; init.ownerName = defaultOrg.organizationName; }
    return init;
  })();
  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "contracts-form", uuid ?? "new", initialForm,
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
      const oName = await resolveOwnerName(d.ownerType, d.ownerUuid);
      setFormData({
        shortName: d.shortName ?? "", contractNumber: d.contractNumber ?? "",
        contractText: d.contractText ?? "", startDate: d.startDate?.slice(0, 10) ?? "",
        endDate: d.endDate?.slice(0, 10) ?? "",
        ownerType: d.ownerType || "", ownerUuid: d.ownerUuid || "", ownerName: oName,
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
    if (!formData.shortName?.trim()) { setError("Наименование обязательно"); setIsLoading(false); return false; }
    const payload: Record<string, unknown> = {
      shortName: formData.shortName.trim(),
      contractNumber: formData.contractNumber?.trim() || null,
      contractText: formData.contractText?.trim() || null,
      startDate: formData.startDate || null,
      endDate: formData.endDate || null,
      ownerType: formData.ownerType || null,
      ownerUuid: formData.ownerUuid || null,
    };
    try {
      const response = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      setFormData(prev => ({
        ...prev, ...saved, shortName: saved.shortName ?? "",
        contractNumber: saved.contractNumber ?? "", contractText: saved.contractText ?? "",
        startDate: saved.startDate?.slice(0, 10) ?? "", endDate: saved.endDate?.slice(0, 10) ?? "",
        ownerType: saved.ownerType || prev.ownerType, ownerUuid: saved.ownerUuid || prev.ownerUuid,
        ownerName: saved.ownerName || prev.ownerName,
      }));
      setIsEditMode(true);
      if (uniqId) {
        const label = `${translate("ContractsList") || "ContractsList"}: ${saved.shortName || saved.contractNumber || "?"} • ${saved.id ?? "?"}`;
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

  // ── Табы ────────────────────────────────────────────────────────────────
  const generalTab = useMemo(() => (
    <div className={styles.FormBodyParts}>
      <Group align="row" gap="12px" className={styles.Form}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
          <Field label="Наименование *" name={`${formUid}_shortName`} minWidth="339px" value={formData.shortName} onChange={e => handleFieldChange("shortName", e.target.value)} disabled={isLoading} />
          <Field label="Номер договора" name={`${formUid}_contractNumber`} minWidth="339px" value={formData.contractNumber} onChange={e => handleFieldChange("contractNumber", e.target.value)} disabled={isLoading} />
          <FieldDate label="Дата начала" name={`${formUid}_startDate`} minWidth="200px" value={formData.startDate} onChange={e => handleFieldChange("startDate", e.target.value)} disabled={isLoading} />
          <FieldDate label="Дата окончания" name={`${formUid}_endDate`} minWidth="200px" value={formData.endDate} onChange={e => handleFieldChange("endDate", e.target.value)} disabled={isLoading} />
          <OwnerLookupField
            ownerType={formData.ownerType} ownerUuid={formData.ownerUuid} ownerName={formData.ownerName}
            name={`${formUid}_owner`}
            onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
              setFormData(prev => ({ ...prev, ownerType, ownerUuid, ownerName }))}
            typeLocked={!!data?.ownerType}
            disabled={isLoading}
            minWidth="339px"
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
  ), [formData, isLoading, isEditMode, formUid, handleFieldChange]);

  const tabs = useMemo<{ id: string; label: string; component: React.ReactNode }[]>(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      { id: "general", label: translate("general") || "Общие сведения", component: generalTab },
    ];
    if (isEditMode && formData.uuid) {
      t.push({ id: "files", label: translate("files") || "Файлы", component: <FilesPanel ownerType="contract" ownerUuid={formData.uuid} /> });
    }
    return t;
  }, [generalTab, isEditMode, formData.uuid]);

  return (
    <div className={styles.FormWrapper}>
      <FormPanel onSaveAndClose={handleSaveAndClose} onSave={handleSave} onClose={handleClose} onReload={uuid ? () => loadFormData(uuid) : undefined} isLoading={isLoading} showReload={isEditMode} />
      <FormError message={error} onDismiss={() => setError(null)} />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
ContractsForm.displayName = "ContractsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface ContractsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const ContractsList: FC<ContractsListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ContractsList_part" : "ContractsList";
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
      ? { [ownerField]: ownerUuid } as unknown as TDataItem
      : d;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.shortName || d?.contractNumber || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: ContractsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField]);

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

ContractsList.displayName = "ContractsList";
export { ContractsList, ContractsForm };
// export default memo(ContractsList);
