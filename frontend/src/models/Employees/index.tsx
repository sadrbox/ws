import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Field } from "src/components/Field";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import ContactsTable from "../Contacts/ContactsTable";
import EmployeeHistoryTable from "./EmployeeHistoryTable";
import AvatarUpload from "src/components/AvatarUpload";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import { useFormError } from "src/hooks/useFormError";
import { commitPendingRows } from "src/services/commitPendingRows";
import FormPanel from "src/components/FormPanel";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "employees";
const LIST_NAME = "EmployeesList";
const FORM_LABEL = "Сотрудник";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  lastName: string;
  firstName: string;
  middleName: string;
  fullName: string;
  iin: string;
  avatarPath: string;
  _pendingContacts?: TDataItem[];
  _pendingHistory?: TDataItem[];
}

const EMPTY_FORM: TFormData = {
  lastName: "", firstName: "", middleName: "", fullName: "", iin: "",
  avatarPath: "",
};

const EmployeesForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "employees-form", uuid ?? "new", EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError, errorRevision] = useFormError();
  const [isEditMode, setIsEditMode] = useState(!!uuid);
  const contactsPendingRef = useRef<TDataItem[]>([]);
  const historyPendingRef = useRef<TDataItem[]>([]);
  const queryClient = useQueryClient();

  // ── Загрузка данных ────────────────────────────────────────────────────
  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        lastName: d.lastName ?? "", firstName: d.firstName ?? "",
        middleName: d.middleName ?? "", fullName: d.fullName ?? "", iin: d.iin ?? "",
        avatarPath: d.avatarPath ?? "",
        id: d.id, uuid: d.uuid,
      });
      // Обновляем вложенные SubTable — invalidate их кэши
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["employee-histories"] });
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); }
    finally { setIsLoading(false); }
  }, [queryClient]);

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field === "lastName" || field === "firstName" || field === "middleName") {
        next.fullName = [next.lastName, next.firstName, next.middleName].filter(Boolean).join(" ");
      }
      return next;
    });
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    if (!formData.lastName?.trim()) { setError("Фамилия обязательна"); setIsLoading(false); return false; }
    const payload = {
      lastName: formData.lastName.trim(),
      firstName: formData.firstName.trim(),
      middleName: formData.middleName.trim(),
      fullName: formData.fullName.trim(),
      iin: formData.iin.trim(),
    };
    try {
      const res = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({
        ...prev,
        lastName: saved.lastName ?? "", firstName: saved.firstName ?? "",
        middleName: saved.middleName ?? "", fullName: saved.fullName ?? "",
        iin: saved.iin ?? "",
        avatarPath: saved.avatarPath ?? prev.avatarPath,
        id: saved.id, uuid: saved.uuid,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate(LIST_NAME) || FORM_LABEL}: ${saved.fullName || saved.lastName || "?"} • ${saved.id ?? "?"}`);
      // Коммит pending contacts
      try {
        await commitPendingRows("contacts", contactsPendingRef.current, saved.uuid, "employeeUuid",
          translate("ContactsList") || "Контакты",
          {
            createPayload: (r: any) => ({ value: r.value ?? "", contactTypeUuid: r.contactTypeUuid ?? null }),
            updatePayload: (r: any) => ({ value: r.value ?? "", contactTypeUuid: r.contactTypeUuid ?? null }),
          },
        );
        setFormData(prev => ({ ...prev, _pendingContacts: undefined }));
        contactsPendingRef.current = [];
        await queryClient.refetchQueries({ queryKey: ["contacts"] });
      } catch (e: any) {
        setError(e?.message || "Не удалось сохранить контакты");
        return false;
      }
      // Коммит pending history
      try {
        await commitPendingRows("employee-histories", historyPendingRef.current, saved.uuid, "employeeUuid",
          translate("EmployeeHistoriesList") || "Кадровая история",
          {
            createPayload: (r: any) => ({ eventDate: r.eventDate ?? null, eventType: r.eventType ?? "hire", salary: r.salary ?? null, positionUuid: r.positionUuid ?? null, organizationUuid: r.organizationUuid ?? null }),
            updatePayload: (r: any) => ({ eventDate: r.eventDate ?? null, eventType: r.eventType ?? "hire", salary: r.salary ?? null, positionUuid: r.positionUuid ?? null, organizationUuid: r.organizationUuid ?? null }),
          },
        );
        setFormData(prev => ({ ...prev, _pendingHistory: undefined }));
        historyPendingRef.current = [];
        await queryClient.refetchQueries({ queryKey: ["employee-histories"] });
      } catch (e: any) {
        setError(e?.message || "Не удалось сохранить кадровую историю");
        return false;
      }
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; }
    finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel, queryClient]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  // ── Табы ────────────────────────────────────────────────────────────────
  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general", label: translate("general") || "Общие сведения", component: (
          <div className={styles.FormBodyParts}>
            <div style={{ display: "flex", flexDirection: "row", gap: "24px" }}>
              {/* Левая колонка — поля */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, maxWidth: 640 }}>
                <Group align="row" gap="12px" className={styles.Form}>
                  <Field label="Фамилия *" name={`${formUid}_lastName`} minWidth="200px"
                    value={formData.lastName} onChange={e => handleFieldChange("lastName", e.target.value)} disabled={isLoading} />
                  <Field label="Имя" name={`${formUid}_firstName`} minWidth="180px"
                    value={formData.firstName} onChange={e => handleFieldChange("firstName", e.target.value)} disabled={isLoading} />
                  <Field label="Отчество" name={`${formUid}_middleName`} minWidth="180px"
                    value={formData.middleName} onChange={e => handleFieldChange("middleName", e.target.value)} disabled={isLoading} />
                </Group>
                <Group align="row" gap="12px" className={styles.Form}>
                  <Field label="ФИО" name={`${formUid}_fullName`} minWidth="400px" value={formData.fullName} disabled />
                </Group>
                <Group align="row" gap="12px" className={styles.Form}>
                  <Field label="ИИН" name={`${formUid}_iin`} minWidth="200px"
                    value={formData.iin} onChange={e => handleFieldChange("iin", e.target.value)} disabled={isLoading} />
                </Group>
                {isEditMode && (
                  <Group align="row" gap="12px" className={styles.Form}>
                    <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                    <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                  </Group>
                )}
              </div>
              {/* Правая колонка — аватар */}
              {isEditMode && formData.uuid && (
                <AvatarUpload
                  endpoint={MODEL_ENDPOINT}
                  entityUuid={formData.uuid}
                  hasAvatar={!!formData.avatarPath}
                  disabled={isLoading}
                />
              )}
            </div>
          </div>
        ),
      },
    ];

    if (isEditMode && formData.uuid) {
      // ── Вкладка: Кадровая история ──
      result.push({
        id: "history", label: "Кадровая история", component: (
          <EmployeeHistoryTable
            employeeUuid={formData.uuid}
            disabled={isLoading}
            deferRemoteChanges={true}
            initialPendingRows={formData._pendingHistory}
            onItemsChange={(items) => {
              historyPendingRef.current = items ?? [];
              const pending = (items ?? []).filter((r: any) => r._pendingAction);
              setFormData(prev => {
                if (JSON.stringify(prev._pendingHistory) === JSON.stringify(pending)) return prev;
                return { ...prev, _pendingHistory: pending.length ? pending : undefined };
              });
            }}
          />
        ),
      });

      // ── Вкладка: Контакты ────────────────────────────────────────────
      result.push({
        id: "contacts", label: translate("ContactsList") || "Контакты", component: (
          <ContactsTable
            deferRemoteChanges={true}
            parentField="employeeUuid"
            parentUuid={formData.uuid ?? ""}
            parentName={formData.fullName || formData.lastName}
            initialPendingRows={formData._pendingContacts}
            onItemsChange={(items) => {
              contactsPendingRef.current = items ?? [];
              const pending = (items ?? []).filter((r: any) => r._pendingAction);
              setFormData(prev => {
                if (JSON.stringify(prev._pendingContacts) === JSON.stringify(pending)) return prev;
                return { ...prev, _pendingContacts: pending.length ? pending : undefined };
              });
            }}
          />
        ),
      });
    }

    return result;
  }, [formUid, formData, isLoading, isEditMode, handleFieldChange]);

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
EmployeesForm.displayName = "EmployeesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface EmployeesListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; }

const EmployeesList: FC<EmployeesListProps> = ({ variant = "default", onSelectItem } = {}) => {
  const { addPane } = useAppContext().windows;
  const t = (k: string) => translate(k) || k;

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT,
    componentName: LIST_NAME,
    columnsJson,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit ? `${t(LIST_NAME)}: ${d?.fullName || d?.lastName || t("noName")} • ${d?.id ?? "?"}` : `${t(LIST_NAME)}: ${t("new")}`,
      component: EmployeesForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch]);

  const tableProps = useMemo(() => buildTableProps({ variant, onSelectItem, openModelForm }), [buildTableProps, variant, onSelectItem, openModelForm]);

  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...tableProps} />;
};
EmployeesList.displayName = "EmployeesList";
export { EmployeesList, EmployeesForm };
