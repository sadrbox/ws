import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field, FieldDateTime, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "scheduled-tasks";
const LIST_NAME = "ScheduledTasksList";
const FORM_LABEL = "Регламентная задача";

const STATUS_OPTIONS = [
  { value: "active", label: "Активна" },
  { value: "paused", label: "Приостановлена" },
  { value: "completed", label: "Завершена" },
];

interface TFormData {
  id?: number; uuid?: string;
  shortName: string; description: string; cronExpr: string; status: string;
  lastRunAt: string; nextRunAt: string;
  organizationUuid: string; organizationName: string;
}
const EMPTY_FORM: TFormData = { shortName: "", description: "", cronExpr: "", status: "active", lastRunAt: "", nextRunAt: "", organizationUuid: "", organizationName: "" };

const ScheduledTasksForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "scheduled-tasks-form", uuid ?? "new", EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({ shortName: d.shortName ?? "", description: d.description ?? "", cronExpr: d.cronExpr ?? "", status: d.status ?? "active", lastRunAt: d.lastRunAt?.slice(0, 16) ?? "", nextRunAt: d.nextRunAt?.slice(0, 16) ?? "", organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.shortName ?? "", id: d.id, uuid: d.uuid });
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
      shortName: formData.shortName?.trim() || null, description: formData.description?.trim() || null,
      cronExpr: formData.cronExpr?.trim() || null, status: formData.status || "active",
      lastRunAt: formData.lastRunAt || null, nextRunAt: formData.nextRunAt || null,
      organizationUuid: formData.organizationUuid || null,
    };
    try {
      const res = isEditMode && (uuid || formData.uuid) ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload) : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({ ...prev, ...saved, shortName: saved.shortName ?? "", description: saved.description ?? "", cronExpr: saved.cronExpr ?? "", status: saved.status ?? "active", lastRunAt: saved.lastRunAt?.slice(0, 16) ?? "", nextRunAt: saved.nextRunAt?.slice(0, 16) ?? "", organizationName: saved.organization?.shortName ?? prev.organizationName }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate(LIST_NAME) || FORM_LABEL}: ${saved.shortName || "?"} • ${saved.id ?? "?"}`);
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; } finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  const generalTab = useMemo(() => (
    <div className={styles.FormBodyParts}>
              <Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                <Field label="Наименование" name={`${formUid}_shortName`} minWidth="339px" value={formData.shortName} onChange={e => handleFieldChange("shortName", e.target.value)} disabled={isLoading} />
                <Field label="Cron выражение" name={`${formUid}_cron`} minWidth="339px" value={formData.cronExpr} onChange={e => handleFieldChange("cronExpr", e.target.value)} disabled={isLoading} />
                <FieldSelect label="Статус" name={`${formUid}_status`} value={formData.status} options={STATUS_OPTIONS} onChange={e => handleFieldChange("status", e.target.value)} disabled={isLoading} />
                <FieldDateTime label="Последний запуск" name={`${formUid}_lastRun`} minWidth="200px" value={formData.lastRunAt} onChange={e => handleFieldChange("lastRunAt", e.target.value)} disabled={isLoading} />
                <FieldDateTime label="Следующий запуск" name={`${formUid}_nextRun`} minWidth="200px" value={formData.nextRunAt} onChange={e => handleFieldChange("nextRunAt", e.target.value)} disabled={isLoading} />
                <LookupField label="Организация" name={`${formUid}_org`} value={formData.organizationUuid} displayValue={formData.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => setFormData(prev => ({ ...prev, organizationUuid: u, organizationName: d }))} minWidth="339px" disabled={isLoading} />
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
      <FormPanel onSaveAndClose={handleSaveAndClose} onSave={handleSave} onClose={handleClose} onReload={uuid ? () => loadFormData(uuid) : undefined} isLoading={isLoading} showReload={isEditMode} />
      <FormError message={error} onDismiss={() => setError(null)} />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
ScheduledTasksForm.displayName = "ScheduledTasksForm";

interface ScheduledTasksListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; }

const ScheduledTasksList: FC<ScheduledTasksListProps> = ({ variant = "default", onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid; const componentName = isPartOf ? `${LIST_NAME}_part` : LIST_NAME;
  const { addPane } = useAppContext().windows; const t = (k: string) => translate(k) || k;
  const ownerFilter = useMemo(() => { if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } }; return undefined; }, [ownerUuid, ownerField]);
  const { error, refetch, buildTableProps } = useModelListState({ model: MODEL_ENDPOINT, componentName, columnsJson, defaultSort: { id: "desc" }, columnsVariant: isPartOf ? "part" : undefined, ownerFilter });
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data; const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField ? { [ownerField]: ownerUuid } as unknown as TDataItem : d;
    const title = isEdit ? (d?.shortName ? String(d.shortName).slice(0, 50) : t("noName")) : t("new");
    addPane({ label: `${t(componentName)}: ${title} • ${d?.id ?? "?"}`, component: ScheduledTasksForm, data: newData, onSave: () => refetch(), onClose: () => refetch() });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField]);
  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};
ScheduledTasksList.displayName = "ScheduledTasksList";
export { ScheduledTasksList, ScheduledTasksForm };
