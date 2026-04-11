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
import { getFormatDate } from "src/utils/main.module";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "activityhistories";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  actionDate?: string;
  actionType: string;
  organizationUuid: string;
  organizationShortName: string;
  bin: string;
  userName: string;
  host: string;
  ip: string;
  city: string;
  objectId: string;
  objectType: string;
  objectName: string;
  props?: any;
}

const EMPTY_FORM: TFormData = {
  actionType: "", organizationUuid: "", organizationShortName: "", bin: "",
  userName: "", host: "", ip: "", city: "",
  objectId: "", objectType: "", objectName: "",
};

const mapToFormData = (d: any): TFormData => ({
  actionType: d.actionType ?? "", organizationUuid: d.organizationUuid ?? "",
  organizationShortName: d.organizationShortName ?? d.organization?.shortName ?? "", bin: d.bin ?? "",
  userName: d.userName ?? "", host: d.host ?? "", ip: d.ip ?? "", city: d.city ?? "",
  objectId: d.objectId ?? "", objectType: d.objectType ?? "", objectName: d.objectName ?? "",
  props: d.props, id: d.id, uuid: d.uuid, actionDate: d.actionDate,
});

const ActivityHistoriesForm: FC<Partial<TPane>> = ({ onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { canWrite } = useAccessRight("ActivityHistory");
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "activity-histories-form", uuid ?? "new", EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode] = useState(!!uuid);

  // ── Загрузка ──────────────────────────────────────────────────────────
  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = response.data?.item ?? response.data;
      setFormData(mapToFormData(d));
      if (uniqId) {
        const label = `${translate("ActivityHistoriesList") || "Журнал"}: ${d.actionType || "?"} • ${d.id ?? "?"}`;
        updatePaneLabel(uniqId, label);
      }
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

  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  const generalTab = useMemo(() => (
    <div className={styles.FormBodyParts}>
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="Тип действия" name={`${formUid}_actionType`} minWidth="200px"
                    value={formData.actionType} disabled />
                  <Field label="Дата действия" name={`${formUid}_actionDate`} minWidth="200px"
                    value={getFormatDate(formData.actionDate)} disabled />
                </div>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="Тип объекта" name={`${formUid}_objectType`} minWidth="200px"
                    value={formData.objectType} disabled />
                  <Field label="Название объекта" name={`${formUid}_objectName`} minWidth="200px"
                    value={formData.objectName} disabled />
                  <Field label="ID объекта" name={`${formUid}_objectId`} minWidth="120px"
                    value={formData.objectId} disabled />
                </div>
              </Group>

              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="Организация" name={`${formUid}_organizationShortName`} minWidth="200px"
                    value={formData.organizationShortName} disabled />
                  <Field label="БИН" name={`${formUid}_bin`} minWidth="150px"
                    value={formData.bin} disabled />
                </div>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="Пользователь" name={`${formUid}_userName`} minWidth="200px"
                    value={formData.userName} disabled />
                  <Field label="Хост" name={`${formUid}_host`} minWidth="200px"
                    value={formData.host} disabled />
                  <Field label="IP" name={`${formUid}_ip`} minWidth="120px"
                    value={formData.ip || ""} disabled />
                  <Field label="Город" name={`${formUid}_city`} minWidth="120px"
                    value={formData.city || ""} disabled />
                </div>

                {isEditMode && (
                  <>
                    <Divider />
                    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                      <Field label="ID" name={`${formUid}_id`} width="80px" value={String(formData.id ?? "-")} disabled />
                      <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                    </div>
                  </>
                )}
              </Group>

              {formData.props && (
                <div style={{ padding: "0 0 12px 0" }}>
                  <details style={{ position: "relative", zIndex: 1 }}>
                    <summary style={{ cursor: "pointer", fontSize: "13px", color: "#666", userSelect: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      Данные (props)
                    </summary>
                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "12px", background: "#f5f5f5", padding: "8px", borderRadius: "4px", marginTop: "6px" }}>
                      {JSON.stringify(formData.props, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
  ), [formData, isLoading, isEditMode, formUid]);

  const tabs = useMemo<{ id: string; label: string; component: React.ReactNode }[]>(() => [
    { id: "general", label: translate("general") || "Общие сведения", component: generalTab },
  ], [generalTab]);

  return (
    <div className={styles.FormWrapper}>
      <FormPanel readonly={!canWrite} onClose={handleClose} onReload={uuid ? () => loadFormData(uuid) : undefined} isLoading={isLoading} showReload={isEditMode} />

      <FormError message={error} onDismiss={() => setError(null)} />

      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
ActivityHistoriesForm.displayName = "ActivityHistoriesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface ActivityHistoriesListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const ActivityHistoriesList: FC<ActivityHistoriesListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ActivityHistoriesList_part" : "ActivityHistoriesList";

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
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.objectName || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: ActivityHistoriesForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm })} />;
};

ActivityHistoriesList.displayName = "ActivityHistoriesList";
export { ActivityHistoriesList, ActivityHistoriesForm }; 