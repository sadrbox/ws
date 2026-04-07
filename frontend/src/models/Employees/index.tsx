import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import useQueryParams from "src/hooks/useQueryParams";
import { useQueryClient } from "@tanstack/react-query";
import { useModelDelete } from "src/hooks/useModelDelete";
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
import Tabs from "src/components/Tabs";
import { ContactsList } from "../Contacts";
import EmployeeHistoryTable from "./EmployeeHistoryTable";
import AvatarUpload from "src/components/AvatarUpload";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";

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
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

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
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); }
    finally { setIsLoading(false); }
  }, []);

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
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; }
    finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel]);

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
          <EmployeeHistoryTable employeeUuid={formData.uuid} disabled={isLoading} />
        ),
      });

      // ── Вкладка: Контакты ────────────────────────────────────────────
      result.push({
        id: "contacts", label: translate("ContactsList") || "Контакты", component: (
          <ContactsList ownerUuid={formData.uuid} ownerField="employeeUuid" ownerName={formData.fullName || formData.lastName} />
        ),
      });
    }

    return result;
  }, [formUid, formData, isLoading, isEditMode, handleFieldChange]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}><div className={styles.TablePanelLeft}><div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
        <Button variant="primary" onClick={handleSaveAndClose} disabled={isLoading}><span>Сохранить и закрыть</span></Button><Divider />
        <Button onClick={handleSave} disabled={isLoading}><span>Сохранить</span></Button>
        <Button onClick={handleClose} disabled={isLoading}><span>Закрыть</span></Button><Divider />
        {isEditMode && <ButtonImage onClick={() => uuid && loadFormData(uuid)} title="Обновить" disabled={isLoading}><img src={reload_16} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} /></ButtonImage>}
      </div></div><div className={styles.TablePanelRight} /></div>
      {error && <div style={{ color: "red", padding: "12px", margin: "8px 0", background: "#ffebee", borderRadius: "4px" }}>{error}</div>}
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

const stringifyJson = (v: any): string => { if (v == null) return ""; try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; } };

interface EmployeesListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; }

const EmployeesList: FC<EmployeesListProps> = ({ variant = "default", onSelectItem } = {}) => {
  const componentName = LIST_NAME;
  const model = MODEL_ENDPOINT;
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (k: string) => translate(k) || k;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName));
  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>("sort", { id: "asc" }, undefined, { stringify: stringifyJson });
  const [search, setSearch] = useQueryParams<string>("search", "");
  const [filter, setFilter] = useQueryParams<Record<string, { value: unknown; operator: string }> | undefined>("filter", undefined, undefined, { stringify: stringifyJson });
  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);
  const params = useMemo(() => ({ sort, search, filter }), [sort, search, filter]);
  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage , cancelAllRequests } = useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });


  const handleDelete = useModelDelete(model, refetch);
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.fullName || d?.lastName || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: EmployeesForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName]);

  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);
  const handleSortChange = useCallback((s: typeof sort) => { cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { id: "asc" }); }, [setSort, updateAdaptiveLimit]);
  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => { setFilter((prev: typeof filter) => { const next = { ...(prev ?? {}) }; if (value == null || value === "") delete next[field]; else next[field] = { value, operator }; return Object.keys(next).length > 0 ? next : undefined; }); }, [setFilter]);
  const handleSearch = useCallback((v: string) => setSearch(v.trim()), [setSearch]);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, [setSearch, setFilter]);
  const handleCleanRefresh = useCallback(() => { cancelAllRequests(); cachedRowsRef.current = []; setCacheVersion(0); setSearch(""); setFilter(undefined); setSort({ id: "asc" }); updateAdaptiveLimit(500); queryClient.resetQueries({ queryKey: [model] }); }, [cancelAllRequests, queryClient, setSearch, setFilter, setSort, updateAdaptiveLimit]);

  const tableProps = useMemo(() => ({
    variant, onSelectItem, enableDateRange: false, componentName, rows, columns, total,
    totalPages: Math.ceil(total / adaptiveLimit), isLoading: isAnythingLoading, isFetching: isAnythingLoading, error, hasNextPage, isFetchingNextPage,
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => { }, onLimitChange: () => { } },
    sorting: { sort, onSortChange: handleSortChange }, filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
    search: { value: search, onChange: handleSearch },
    actions: { openModelForm, refetch: handleCleanRefresh, setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
    onDelete: handleDelete,
  }), [variant, onSelectItem, componentName, rows, columns, total, adaptiveLimit, isAnythingLoading, error, sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters, openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh, handleDelete]);

  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...tableProps} />;
};
EmployeesList.displayName = "EmployeesList";
export { EmployeesList, EmployeesForm };
