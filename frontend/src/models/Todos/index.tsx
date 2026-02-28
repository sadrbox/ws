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
import { Divider, Field, FieldDateTime, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";
import Tabs from "src/components/Tabs";

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
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
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
  ownerType: "", ownerUuid: "", ownerName: "",
  curatorUuid: "", curatorName: "",
  executorUuid: "", executorName: "",
  createdAt: "", deadline: "", deadlineDays: "",
};

const TodosForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const buildInitialForm = useCallback((): TFormData => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    const name = (data.ownerName as string) || "";
    if (data.organizationUuid) {
      init.ownerType = "organization";
      init.ownerUuid = data.organizationUuid as string;
      init.ownerName = name;
    } else if (data.counterpartyUuid) {
      init.ownerType = "counterparty";
      init.ownerUuid = data.counterpartyUuid as string;
      init.ownerName = name;
    }
    return init;
  }, [data]);

  const [formData, setFormData] = useState<TFormData>(buildInitialForm);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = response.data?.item ?? response.data;
      let oType: OwnerType = "";
      let oUuid = "";
      let oName = d.ownerName ?? "";
      if (d.organizationUuid) {
        oType = "organization"; oUuid = d.organizationUuid;
        oName = d.organization?.shortName ?? oName;
      } else if (d.counterpartyUuid) {
        oType = "counterparty"; oUuid = d.counterpartyUuid;
        oName = d.counterparty?.shortName ?? oName;
      }
      setFormData({
        description: d.description ?? "",
        status: d.status ?? "new",
        ownerType: oType, ownerUuid: oUuid, ownerName: oName,
        curatorUuid: d.curatorUuid ?? "",
        curatorName: d.curator?.fullName || d.curator?.username || "",
        executorUuid: d.executorUuid ?? "",
        executorName: d.executor?.fullName || d.executor?.username || "",
        createdAt: d.createdAt?.slice(0, 16) ?? "",
        deadline: d.deadline?.slice(0, 16) ?? "",
        deadlineDays: d.deadlineDays?.toString() ?? "",
        id: d.id, uuid: d.uuid,
      });
    } catch (err: any) {
      setError(err.response?.data?.message || "Не удалось загрузить данные");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { if (uuid) loadFormData(uuid); }, [uuid, loadFormData]);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // Дедлайн: дни → дата
  const handleDeadlineDaysChange = useCallback((value: string) => {
    const days = parseInt(value);
    setFormData(prev => {
      const base = prev.createdAt ? new Date(prev.createdAt) : new Date();
      const deadline = !isNaN(days) && days > 0
        ? new Date(base.getTime() + days * 86400000).toISOString().substring(0, 16)
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
      ownerName: formData.ownerName?.trim() || null,
      organizationUuid: formData.ownerType === "organization" ? (formData.ownerUuid || null) : null,
      counterpartyUuid: formData.ownerType === "counterparty" ? (formData.ownerUuid || null) : null,
      curatorUuid: formData.curatorUuid || null,
      executorUuid: formData.executorUuid || null,
      deadline: formData.deadline || null,
      deadlineDays: formData.deadlineDays || null,
    };
    try {
      const response = isEditMode && uuid
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      let oType: OwnerType = formData.ownerType;
      let oUuid = formData.ownerUuid;
      let oName = formData.ownerName;
      if (saved.organizationUuid) {
        oType = "organization"; oUuid = saved.organizationUuid;
        oName = saved.organization?.shortName ?? oName;
      } else if (saved.counterpartyUuid) {
        oType = "counterparty"; oUuid = saved.counterpartyUuid;
        oName = saved.counterparty?.shortName ?? oName;
      }
      setFormData(prev => ({
        ...prev, ...saved,
        description: saved.description ?? "",
        status: saved.status ?? "new",
        ownerType: oType, ownerUuid: oUuid, ownerName: oName,
        curatorUuid: saved.curatorUuid ?? "",
        curatorName: saved.curator?.fullName || saved.curator?.username || prev.curatorName,
        executorUuid: saved.executorUuid ?? "",
        executorName: saved.executor?.fullName || saved.executor?.username || prev.executorName,
        createdAt: saved.createdAt?.slice(0, 16) ?? prev.createdAt,
        deadline: saved.deadline?.slice(0, 16) ?? "",
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
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId]);
  const handleClose = useCallback(() => { onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId]);

  // ── Табы (файлы) ────────────────────────────────────────────────────────
  const tabs = useMemo<{ id: string; label: string; component: React.ReactNode }[]>(() => {
    if (!isEditMode || !formData.uuid) return [];
    return [
      { id: "files", label: translate("files") || "Файлы", component: <TodoFilesPanel todoUuid={formData.uuid} /> },
    ];
  }, [isEditMode, formData.uuid]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}>
        <div className={styles.TablePanelLeft}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
            <Button variant="primary" onClick={handleSaveAndClose} disabled={isLoading}><span>Сохранить и закрыть</span></Button>
            <Divider />
            <Button onClick={handleSave} disabled={isLoading}><span>Сохранить</span></Button>
            <Button onClick={handleClose} disabled={isLoading}><span>Закрыть</span></Button>
            <Divider />
            {isEditMode && (
              <ButtonImage onClick={() => uuid && loadFormData(uuid)} title="Обновить" disabled={isLoading}>
                <img src={reload_16} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} />
              </ButtonImage>
            )}
          </div>
        </div>
        <div className={styles.TablePanelRight} />
      </div>
      {error && <div style={{ color: "red", padding: "12px", margin: "8px 0", background: "#ffebee", borderRadius: "4px" }}>{error}</div>}
      <div className={styles.FormBody}>
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
              <FieldSelect label="Статус" name={`${formUid}_status`} options={STATUS_OPTIONS} value={formData.status} onChange={e => handleFieldChange("status", e.target.value)} disabled={isLoading} style={{ minWidth: 200 }} />
              <OwnerLookupField
                name={`${formUid}_owner`}
                ownerType={formData.ownerType}
                ownerUuid={formData.ownerUuid}
                ownerName={formData.ownerName}
                onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
                  setFormData(prev => ({ ...prev, ownerType, ownerUuid, ownerName }))
                }
                disabled={isLoading}
                // allow switching owner type when the form is opened WITHOUT subordination
                typeLocked={Boolean(isEditMode && (data?.organizationUuid || data?.counterpartyUuid))}
                minWidth="339px"
              />
              <LookupField
                label="Куратор"
                name={`${formUid}_curator`}
                value={formData.curatorUuid}
                displayValue={formData.curatorName}
                endpoint="users"
                displayField="fullName"
                onSelect={(uuid, display) =>
                  setFormData(prev => ({ ...prev, curatorUuid: uuid, curatorName: display }))
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
                displayField="fullName"
                onSelect={(uuid, display) =>
                  setFormData(prev => ({ ...prev, executorUuid: uuid, executorName: display }))
                }
                minWidth="339px"
                disabled={isLoading}
              />
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <FieldDateTime label="Дата создания" name={`${formUid}_createdAt`} width="200px" value={formData.createdAt} disabled />
                <Field label="Дней" name={`${formUid}_deadlineDays`} width="100px" value={formData.deadlineDays} onChange={e => handleDeadlineDaysChange(e.target.value)} disabled={isLoading} />
                <FieldDateTime label="Дедлайн" name={`${formUid}_deadline`} width="200px" value={formData.deadline} onChange={e => handleFieldChange("deadline", e.target.value)} disabled={isLoading} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 339 }}>
                <label style={{ fontSize: 13, color: "#222" }} htmlFor={`${formUid}_description`}>Описание задачи</label>
                <textarea
                  id={`${formUid}_description`}
                  value={formData.description}
                  onChange={e => handleFieldChange("description", e.target.value)}
                  disabled={isLoading}
                  style={{ minWidth: 339, minHeight: 120, padding: 8, borderRadius: 4 }}
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
      </div>
      {isEditMode && formData.uuid && tabs.length > 0 && <Tabs tabs={tabs} />}
    </div>
  );
};
TodosForm.displayName = "TodosForm";

// ═══════════════════════════════════════════════════════════════════════════
// FILES PANEL
// ═══════════════════════════════════════════════════════════════════════════

interface TodoFilesPanelProps {
  todoUuid: string;
}

const TodoFilesPanel: FC<TodoFilesPanelProps> = ({ todoUuid }) => {
  const [files, setFiles] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const res = await apiClient.get(`/todofiles?todoUuid=${todoUuid}`);
      setFiles(res.data?.items ?? []);
    } catch (e) {
      console.error("loadFiles error:", e);
    }
  }, [todoUuid]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("todoUuid", todoUuid);
      await apiClient.post("/todofiles", fd);
      loadFiles();
    } catch (err) {
      console.error("upload error:", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [todoUuid, loadFiles]);

  const handleDownload = useCallback(async (fileUuid: string, fileName: string) => {
    try {
      const res = await apiClient.get(`/todofiles/download/${fileUuid}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("download error:", err);
    }
  }, []);

  const handleDelete = useCallback(async (fileUuid: string) => {
    try {
      await apiClient.delete(`/todofiles/${fileUuid}`);
      loadFiles();
    } catch (err) {
      console.error("delete error:", err);
    }
  }, [loadFiles]);

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          <span>{isUploading ? "Загрузка..." : "Прикрепить файл"}</span>
        </Button>
        <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleUpload} />
      </div>
      {files.length === 0 && (
        <div style={{ color: "#888", fontSize: "13px", padding: "12px", textAlign: "center" }}>
          Нет прикреплённых файлов
        </div>
      )}
      {files.map((f: any) => (
        <div key={f.uuid} style={{
          display: "flex", alignItems: "center", gap: "12px",
          padding: "6px 8px", borderRadius: "4px",
          transition: "background 0.15s",
        }}>
          <span
            style={{ flex: 1, fontSize: "13px", color: "#073989", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            onClick={() => handleDownload(f.uuid, f.fileName)}
            title={f.fileName}
          >
            {f.fileName}
          </span>
          <span style={{ fontSize: "12px", color: "#666", whiteSpace: "nowrap" }}>{formatSize(f.fileSize)}</span>
          <button
            type="button"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#666", fontSize: "14px", padding: "2px 6px", borderRadius: "4px" }}
            onClick={() => handleDelete(f.uuid)}
            title="Удалить файл"
          >✕</button>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const stringifyJson = (v: any): string => {
  if (v == null) return "";
  try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; }
};

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
  const model = MODEL_ENDPOINT;
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName, isPartOf ? "part" : undefined));
  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>("sort", { id: "desc" }, undefined, { stringify: stringifyJson });
  const [search, setSearch] = useQueryParams<string>("search", "");
  const [filter, setFilter] = useQueryParams<Record<string, { value: unknown; operator: string }> | undefined>("filter", undefined, undefined, { stringify: stringifyJson });

  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const params = useMemo(() => ({
    sort, search,
    filter: ownerFilter ? { ...ownerFilter, ...filter } : filter,
  }), [sort, search, filter, ownerFilter]);

  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage } =
    useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });

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

  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);

  const handleSortChange = useCallback((s: typeof sort) => {
    cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { id: "desc" });
  }, [setSort, updateAdaptiveLimit]);

  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => {
    setFilter((prev: typeof filter) => {
      const next = { ...(prev ?? {}) };
      if (value == null || value === "") delete next[field];
      else next[field] = { value, operator };
      return Object.keys(next).length > 0 ? next : undefined;
    });
  }, [setFilter]);

  const handleSearch = useCallback((v: string) => setSearch(v.trim()), [setSearch]);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, [setSearch, setFilter]);

  const handleCleanRefresh = useCallback(() => {
    cachedRowsRef.current = []; setCacheVersion(0);
    setSearch(""); setFilter(undefined); setSort({ id: "desc" }); updateAdaptiveLimit(500);
    queryClient.resetQueries({ queryKey: [model] });
  }, [queryClient, setSearch, setFilter, setSort, updateAdaptiveLimit]);

  const tableProps = useMemo(() => ({
    variant, onSelectItem,
    enableDateRange: false,
    componentName, rows, columns, total,
    totalPages: Math.ceil(total / adaptiveLimit),
    isLoading: isAnythingLoading, isFetching: isAnythingLoading, error,
    hasNextPage, isFetchingNextPage,
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => { }, onLimitChange: () => { } },
    sorting: { sort, onSortChange: handleSortChange },
    filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
    search: { value: search, onChange: handleSearch },
    actions: { openModelForm, refetch: handleCleanRefresh, setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
  }), [variant, onSelectItem, componentName, rows, columns, total, adaptiveLimit, isAnythingLoading, error,
    sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters,
    openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...tableProps} />;
};

TodosList.displayName = "TodosList";
export { TodosList, TodosForm };
