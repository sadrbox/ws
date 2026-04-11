import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import FilesPanel from "src/models/Files";
import { Divider, Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "todos";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "Новая" },
  { value: "in_progress", label: "В работе" },
  { value: "done", label: "Выполнена" },
  { value: "cancelled", label: "Отменена" },
];

// helper: status labels are defined in STATUS_OPTIONS

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  description: string;
  status: string;
  organizationUuid: string;
  organizationName: string;
  curatorUuid: string;
  curatorName: string;
  executorUuid: string;
  executorName: string;
  createdAt: string;
  deadline: string;
  deadlineDays: string;
}

const EMPTY_FORM: TFormData = {
  description: "", status: "new",
  organizationUuid: "", organizationName: "",
  curatorUuid: "", curatorName: "",
  executorUuid: "", executorName: "",
  createdAt: "", deadline: "", deadlineDays: "",
};

const TodosForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { canWrite } = useAccessRight("Todo");
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();
  const defaultOrg = useDefaultOrganization();

  const initialForm: TFormData = (() => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    if (data.organizationUuid) { init.organizationUuid = data.organizationUuid as string; init.organizationName = (data.ownerName as string) || ""; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    return init;
  })();
  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "todos-form", uuid ?? "new", initialForm,
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
      setFormData({
        description: d.description ?? "",
        status: d.status ?? "new",
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.shortName ?? "",
        curatorUuid: d.curatorUuid ?? "",
        curatorName: d.curator?.employee?.fullName || d.curator?.username || "",
        executorUuid: d.executorUuid ?? "",
        executorName: d.executor?.employee?.fullName || d.executor?.username || "",
        createdAt: d.createdAt?.slice(0, 10) ?? "",
        deadline: d.deadline?.slice(0, 10) ?? "",
        deadlineDays: d.deadlineDays?.toString() ?? "",
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

  // Дедлайн: дни → дата
  const handleDeadlineDaysChange = useCallback((value: string) => {
    const days = parseInt(value);
    setFormData(prev => {
      const base = prev.createdAt ? new Date(prev.createdAt) : new Date();
      const deadline = !isNaN(days) && days > 0
        ? new Date(base.getTime() + days * 86400000).toISOString().substring(0, 10)
        : prev.deadline;
      return { ...prev, deadlineDays: value, deadline };
    });
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    const payload: Record<string, unknown> = {
      description: formData.description?.trim() || null,
      status: formData.status || "new",
      ownerName: formData.organizationName?.trim() || null,
      organizationUuid: formData.organizationUuid || null,
      counterpartyUuid: null,
      curatorUuid: formData.curatorUuid || null,
      executorUuid: formData.executorUuid || null,
      deadline: formData.deadline || null,
      deadlineDays: formData.deadlineDays || null,
    };
    try {
      const response = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      setFormData(prev => ({
        ...prev, ...saved,
        description: saved.description ?? "",
        status: saved.status ?? "new",
        organizationUuid: saved.organizationUuid ?? "",
        organizationName: saved.organization?.shortName ?? prev.organizationName,
        curatorUuid: saved.curatorUuid ?? "",
        curatorName: saved.curator?.employee?.fullName || saved.curator?.username || prev.curatorName,
        executorUuid: saved.executorUuid ?? "",
        executorName: saved.executor?.employee?.fullName || saved.executor?.username || prev.executorName,
        createdAt: saved.createdAt?.slice(0, 10) ?? prev.createdAt,
        deadline: saved.deadline?.slice(0, 10) ?? "",
        deadlineDays: saved.deadlineDays?.toString() ?? "",
      }));
      setIsEditMode(true);
      if (uniqId) {
        const short = saved.description ? (String(saved.description).slice(0, 50) + (String(saved.description).length > 50 ? "..." : "")) : "?";
        const label = `${translate("TodosList") || "Задачи"}: ${short} • ${saved.id ?? "?"}`;
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
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  // ── Табы ────────────────────────────────────────────────────────────────
  const generalTab = useMemo(() => (
    <div className={styles.FormBodyParts}>
      <Group align="row" gap="12px" className={styles.Form}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
          <FieldSelect label="Статус" name={`${formUid}_status`} options={STATUS_OPTIONS} value={formData.status} onChange={e => handleFieldChange("status", e.target.value)} disabled={isLoading} style={{ minWidth: 200 }} />
          <LookupField
            label="Организация"
            name={`${formUid}_organization`}
            value={formData.organizationUuid}
            displayValue={formData.organizationName}
            endpoint="organizations"
            displayField="shortName"
            onSelect={(uuid, display) =>
              setFormData(prev => ({ ...prev, organizationUuid: uuid, organizationName: display }))
            }
            onClear={() =>
              setFormData(prev => ({ ...prev, organizationUuid: "", organizationName: "" }))
            }
            minWidth="339px"
            disabled={isLoading}
          />
          <LookupField
            label="Куратор"
            name={`${formUid}_curator`}
            value={formData.curatorUuid}
            displayValue={formData.curatorName}
            endpoint="users"
            displayField="username"
            secondaryFields={["employee.fullName"]}
            onSelect={(uuid, display, item) =>
              setFormData(prev => ({ ...prev, curatorUuid: uuid, curatorName: item?.employee?.fullName || display }))
            }
            onClear={() =>
              setFormData(prev => ({ ...prev, curatorUuid: "", curatorName: "" }))
            }
            minWidth="339px"
            disabled={isLoading}
          />
          <LookupField
            label="Исполнитель"
            name={`${formUid}_executor`}
            value={formData.executorUuid}
            displayValue={formData.executorName}
            endpoint="users"
            displayField="username"
            secondaryFields={["employee.fullName"]}
            onSelect={(uuid, display, item) =>
              setFormData(prev => ({ ...prev, executorUuid: uuid, executorName: item?.employee?.fullName || display }))
            }
            onClear={() =>
              setFormData(prev => ({ ...prev, executorUuid: "", executorName: "" }))
            }
            minWidth="339px"
            disabled={isLoading}
          />
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <FieldDate label="Дата создания" name={`${formUid}_createdAt`} width="200px" value={formData.createdAt} disabled />
            <Field label="Дней" name={`${formUid}_deadlineDays`} width="100px" value={formData.deadlineDays} onChange={e => handleDeadlineDaysChange(e.target.value)} disabled={isLoading} />
            <FieldDate label="Дедлайн" name={`${formUid}_deadline`} width="200px" value={formData.deadline} onChange={e => handleFieldChange("deadline", e.target.value)} disabled={isLoading} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 339 }}>
            <FieldTextarea
              label="Описание задачи"
              name={`${formUid}_description`}
              value={formData.description}
              onChange={e => handleFieldChange("description", e.target.value)}
              disabled={isLoading}
              minWidth="339px"
              minHeight="120px"
              rows={6}
            />
          </div>
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
  ), [formData, isLoading, isEditMode, formUid, handleFieldChange, handleDeadlineDaysChange]);

  const tabs = useMemo<{ id: string; label: string; component: React.ReactNode }[]>(() => {
    const t: { id: string; label: string; component: React.ReactNode }[] = [
      { id: "general", label: translate("general") || "Общие сведения", component: generalTab },
    ];
    if (isEditMode && formData.uuid) {
      t.push({ id: "files", label: translate("files") || "Файлы", component: <FilesPanel ownerType="todo" ownerUuid={formData.uuid} /> });
    }
    return t;
  }, [generalTab, isEditMode, formData.uuid]);

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
TodosForm.displayName = "TodosForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface TodosListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
  ownerName?: string;
}

const TodosList: FC<TodosListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField, ownerName } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "TodosList_part" : "TodosList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT, componentName, columnsJson,
    defaultSort: { id: "desc" },
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField
      ? { [ownerField]: ownerUuid, ownerName: ownerName || "" } as unknown as TDataItem
      : d;
    const title = isEdit
      ? (d?.description ? (String(d.description).slice(0, 50) + (String(d.description).length > 50 ? "..." : "")) : t("noName"))
      : t("new");
    addPane({
      label: `${t(componentName)}: ${title} • ${d?.id ?? "?"}`,
      component: TodosForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
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

TodosList.displayName = "TodosList";
export { TodosList, TodosForm };
