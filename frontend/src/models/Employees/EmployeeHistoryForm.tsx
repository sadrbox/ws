import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "src/app";
import apiClient from "src/services/api/client";
import type { TPane } from "src/app/types";
import { Button, ButtonImage } from "src/components/Button";
import { Divider, Field, FieldNumber, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import useUID from "src/hooks/useUID";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
import { translate } from "src/i18";
import Tabs from "src/components/Tabs";
import { Group } from "src/components/UI";

const MODEL_ENDPOINT = "employee-histories";

const EVENT_TYPE_OPTIONS = [
  { value: "hire", label: "Приём" },
  { value: "fire", label: "Увольнение" },
  { value: "transfer", label: "Перемещение" },
];

interface TFormData {
  id?: number;
  uuid?: string;
  eventDate: string;
  eventType: string;
  organizationUuid: string;
  organizationName: string;
  positionUuid: string;
  positionName: string;
  salary: string;
  employeeUuid: string;
}

const EMPTY_FORM: TFormData = {
  eventDate: new Date().toISOString().slice(0, 10),
  eventType: "hire",
  organizationUuid: "",
  organizationName: "",
  positionUuid: "",
  positionName: "",
  salary: "",
  employeeUuid: "",
};

const EmployeeHistoryForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const employeeUuid = (data as any)?.employeeUuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData] = useState<TFormData>(() => ({
    ...EMPTY_FORM,
    employeeUuid: employeeUuid ?? "",
  }));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        id: d.id,
        uuid: d.uuid,
        eventDate: d.eventDate ? new Date(d.eventDate).toISOString().slice(0, 10) : "",
        eventType: d.eventType ?? "hire",
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.shortName ?? "",
        positionUuid: d.positionUuid ?? "",
        positionName: d.position?.shortName ?? "",
        salary: d.salary != null ? String(Number(d.salary)) : "",
        employeeUuid: d.employeeUuid ?? employeeUuid ?? "",
      });
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); }
    finally { setIsLoading(false); }
  }, [employeeUuid]);

  useEffect(() => { if (uuid) loadFormData(uuid); }, [uuid, loadFormData]);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const eventTypeLabel = useMemo(() => {
    const opt = EVENT_TYPE_OPTIONS.find(o => o.value === formData.eventType);
    return opt?.label ?? formData.eventType;
  }, [formData.eventType]);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    if (!formData.eventType?.trim()) { setError("Тип события обязателен"); setIsLoading(false); return false; }
    if (!formData.employeeUuid) { setError("Сотрудник не указан"); setIsLoading(false); return false; }
    const payload = {
      eventDate: formData.eventDate || null,
      eventType: formData.eventType.trim(),
      organizationUuid: formData.organizationUuid || null,
      positionUuid: formData.positionUuid || null,
      salary: formData.salary ? parseFloat(formData.salary) : null,
      employeeUuid: formData.employeeUuid,
    };
    try {
      const res = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({
        ...prev,
        id: saved.id,
        uuid: saved.uuid,
        eventDate: saved.eventDate ? new Date(saved.eventDate).toISOString().slice(0, 10) : "",
        eventType: saved.eventType ?? prev.eventType,
        organizationUuid: saved.organizationUuid ?? "",
        organizationName: saved.organization?.shortName ?? prev.organizationName,
        positionUuid: saved.positionUuid ?? "",
        positionName: saved.position?.shortName ?? prev.positionName,
        salary: saved.salary != null ? String(Number(saved.salary)) : "",
        employeeUuid: saved.employeeUuid ?? prev.employeeUuid,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate("EmployeeHistoriesList") || "Кадровая история"}: ${eventTypeLabel} • ${saved.id ?? "?"}`);
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; }
    finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel, eventTypeLabel]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId]);
  const handleClose = useCallback(() => { onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}><div className={styles.TablePanelLeft}><div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
        <Button variant="primary" onClick={handleSaveAndClose} disabled={isLoading}><span>Сохранить и закрыть</span></Button><Divider />
        <Button onClick={handleSave} disabled={isLoading}><span>Сохранить</span></Button>
        <Button onClick={handleClose} disabled={isLoading}><span>Закрыть</span></Button><Divider />
        {isEditMode && <ButtonImage onClick={() => uuid && loadFormData(uuid)} title="Обновить" disabled={isLoading}><img src={reload_16} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} /></ButtonImage>}
      </div></div><div className={styles.TablePanelRight} /></div>
      {error && <div style={{ color: "red", padding: "12px", margin: "8px 0", background: "#ffebee", borderRadius: "4px" }}>{error}</div>}
      <div className={styles.FormBody}><Tabs tabs={[
        {
          id: "general", label: translate("general") || "Общие сведения", component: (
            <div className={styles.FormBodyParts}>
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ width: "180px" }}>
                  <label htmlFor={`${formUid}_eventDate`} className={styles.FieldLabel}>Дата события *</label>
                  <input type="date" id={`${formUid}_eventDate`} name={`${formUid}_eventDate`}
                    value={formData.eventDate} onChange={e => handleFieldChange("eventDate", e.target.value)}
                    disabled={isLoading} style={{ width: "100%", padding: "4px 8px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }} />
                </div>
                <FieldSelect label="Тип события *" name={`${formUid}_eventType`}
                  value={formData.eventType} onChange={e => handleFieldChange("eventType", e.target.value)}
                  disabled={isLoading} options={EVENT_TYPE_OPTIONS} style={{ width: "180px" }} />
              </Group>
              <Group align="row" gap="12px" className={styles.Form}>
                <LookupField label="Организация" name={`${formUid}_org`} width="339px"
                  value={formData.organizationUuid} displayValue={formData.organizationName}
                  endpoint="organizations" displayField="shortName"
                  columns={[{ key: "shortName", label: "Наименование" }, { key: "bin", label: "БИН" }]}
                  onSelect={(uuid) => {
                    apiClient.get(`/organizations/${uuid}`).then(r => {
                      const o = r.data?.item ?? r.data;
                      setFormData(prev => ({ ...prev, organizationUuid: o.uuid, organizationName: o.shortName ?? "" }));
                    });
                  }}
                  onClear={() => setFormData(prev => ({ ...prev, organizationUuid: "", organizationName: "" }))}
                  disabled={isLoading} />
              </Group>
              <Group align="row" gap="12px" className={styles.Form}>
                <LookupField label="Должность" name={`${formUid}_pos`} width="339px"
                  value={formData.positionUuid} displayValue={formData.positionName}
                  endpoint="positions" displayField="shortName"
                  columns={[{ key: "shortName", label: "Наименование" }]}
                  onSelect={(uuid) => {
                    apiClient.get(`/positions/${uuid}`).then(r => {
                      const o = r.data?.item ?? r.data;
                      setFormData(prev => ({ ...prev, positionUuid: o.uuid, positionName: o.shortName ?? "" }));
                    });
                  }}
                  onClear={() => setFormData(prev => ({ ...prev, positionUuid: "", positionName: "" }))}
                  disabled={isLoading} />
              </Group>
              <Group align="row" gap="12px" className={styles.Form}>
                <FieldNumber label="Оклад" name={`${formUid}_salary`} width="180px"
                  value={formData.salary} onChange={e => handleFieldChange("salary", e.target.value)}
                  disabled={isLoading} step="0.01" textAlign="right" />
              </Group>
              {isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                  <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                  <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                </div>
              </Group></>}
            </div>
          )
        },
      ]} /></div>
    </div>
  );
};

EmployeeHistoryForm.displayName = "EmployeeHistoryForm";
export default EmployeeHistoryForm;
