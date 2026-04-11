import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import { AccessRightsList } from "src/models/AccessRights";
import AvatarUpload from "src/components/AvatarUpload";
import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "users";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  username: string;
  password: string;
  employeeUuid: string;
  employeeName: string;
  avatarPath: string;
}

const EMPTY_FORM: TFormData = {
  username: "", password: "", employeeUuid: "", employeeName: "", avatarPath: "",
};

const UsersForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { canWrite } = useAccessRight("User");
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "users-form", uuid ?? "new", EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, [setFormData]);

  // ── Загрузка данных ────────────────────────────────────────────────────
  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = response.data?.item ?? response.data;
      setFormData({
        username: d.username ?? "", password: "",
        employeeUuid: d.employeeUuid ?? d.employee?.uuid ?? "",
        employeeName: d.employee?.fullName ?? "",
        avatarPath: d.avatarPath ?? "",
        id: d.id, uuid: d.uuid,
      });
    } catch (err: any) {
      setError(err.response?.data?.message || "Не удалось загрузить данные");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Если данные уже восстановлены из sessionStorage — не загружаем повторно
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    if (!formData.username?.trim()) { setError("Логин обязателен"); setIsLoading(false); return false; }
    const payload: Record<string, any> = {
      username: formData.username.trim(),
      employeeUuid: formData.employeeUuid || null,
    };
    if (formData.password?.trim()) payload.password = formData.password.trim();
    try {
      const response = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      setFormData(prev => ({
        ...prev, ...saved, username: saved.username ?? "",
        password: "",
        employeeUuid: saved.employeeUuid ?? saved.employee?.uuid ?? "",
        employeeName: saved.employee?.fullName ?? "",
        avatarPath: saved.avatarPath ?? prev.avatarPath,
      }));
      setIsEditMode(true);
      if (uniqId) {
        const label = `${translate("UsersList") || "UsersList"}: ${saved.username || saved.fullName || "?"} • ${saved.id ?? "?"}`;
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

  // ── Tabs ────────────────────────────────────────────────────────────────
  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general", label: translate("general") || "Общие сведения", component: (
          <div className={styles.FormBodyParts}>
            <div style={{ display: "flex", flexDirection: "row", gap: "24px" }}>
              {/* Левая колонка — поля */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: 640 }}>
                <Group align="row" gap="12px" className={styles.Form}>

                  <Group align="col" gap="12px">
                    <Group align="row" gap="12px" className={styles.Form}>
                      <Field label="Логин *" name={`${formUid}_username`} minWidth="150px" value={formData.username} onChange={e => handleFieldChange("username", e.target.value)} disabled={isLoading} />

                      <Field label={isEditMode ? "Новый пароль" : "Пароль"} name={`${formUid}_password`} minWidth="150px" value={formData.password} onChange={e => handleFieldChange("password", e.target.value)} disabled={isLoading} />
                    </Group>

                    {isEditMode && formData.uuid && (
                      <AvatarUpload
                        endpoint={MODEL_ENDPOINT}
                        entityUuid={formData.uuid}
                        hasAvatar={!!formData.avatarPath}
                        disabled={isLoading}
                      />
                    )}


                  </Group>
                  <LookupField
                    label="Сотрудник"
                    name={`${formUid}_employee`}
                    value={formData.employeeUuid}
                    displayValue={formData.employeeName}
                    endpoint="employees"
                    displayField="fullName"
                    minWidth="400px"
                    disabled={isLoading}
                    onSelect={(uuid, displayValue) => {
                      setFormData(prev => ({ ...prev, employeeUuid: uuid, employeeName: displayValue }));
                    }}
                    onClear={() => {
                      setFormData(prev => ({ ...prev, employeeUuid: "", employeeName: "" }));
                    }}
                  />
                </Group>
                {isEditMode && (
                  <Group align="row" gap="12px" className={styles.Form}>
                    <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                    <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                  </Group>
                )}
              </div>
              {/* Правая колонка — аватар */}

            </div>
          </div>
        ),
      },
    ];

    if (isEditMode && formData.uuid) {
      // ── Вкладка: Права доступа ──────────────────────────────────────
      result.push({
        id: "access", label: "Права доступа", component: (
          <AccessRightsList userUuid={formData.uuid} />
        ),
      });
    }

    return result;
  }, [formUid, formData, isLoading, isEditMode, handleFieldChange]);

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
UsersForm.displayName = "UsersForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const UsersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant = 'default', onSelectItem } = {}) => {
  const componentName = "UsersList";
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT, componentName, columnsJson, defaultSort: { id: "asc" },
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.username || (d?.employee as any)?.fullName || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: UsersForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
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

  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};

UsersList.displayName = "UsersList";
export { UsersList, UsersForm };
