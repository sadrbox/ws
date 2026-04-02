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
import FilesPanel from "src/models/Files";
import useQueryParams from "src/hooks/useQueryParams";
import { useQueryClient } from "@tanstack/react-query";
import { useModelDelete } from "src/hooks/useModelDelete";
import { Divider, Field, FieldDateTime, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
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
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const buildInitialForm = useCallback((): TFormData => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    if (data.organizationUuid) {
      init.organizationUuid = data.organizationUuid as string;
      init.organizationName = (data.ownerName as string) || "";
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
      setFormData({
        description: d.description ?? "",
        status: d.status ?? "new",
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.shortName ?? "",
        curatorUuid: d.curatorUuid ?? "",
        curatorName: d.curator?.employee?.fullName || d.curator?.username || "",
        executorUuid: d.executorUuid ?? "",
        executorName: d.executor?.employee?.fullName || d.executor?.username || "",
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
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
TodosForm.displayName = "TodosForm";

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


  const handleDelete = useModelDelete(model, refetch);
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
    onDelete: handleDelete,
  }), [variant, onSelectItem, componentName, rows, columns, total, adaptiveLimit, isAnythingLoading, error,
    sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters,
    openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh, handleDelete]);

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
