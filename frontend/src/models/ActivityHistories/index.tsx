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
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import { getFormatDate } from "src/utils/main.module";
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";

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
  const { windows: { removePane } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData] = useState<TFormData>(() => data ? mapToFormData(data) : { ...EMPTY_FORM });
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
    } catch (err: any) {
      setError(err.response?.data?.message || "Не удалось загрузить данные");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { if (uuid) loadFormData(uuid); }, [uuid, loadFormData]);

  const handleClose = useCallback(() => { onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}>
        <div className={styles.TablePanelLeft}>
          <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
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
        </div>

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
    </div>
  );
};
ActivityHistoriesForm.displayName = "ActivityHistoriesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const stringifyJson = (v: any): string => {
  if (v == null) return "";
  try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; }
};

interface ActivityHistoriesListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
}

const ActivityHistoriesList: FC<ActivityHistoriesListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ActivityHistoriesList_part" : "ActivityHistoriesList";
  const model = MODEL_ENDPOINT;

  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName, isPartOf ? "part" : undefined));
  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>("sort", { id: "asc" }, undefined, { stringify: stringifyJson });
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
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.objectName || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: ActivityHistoriesForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName]);

  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);

  const handleSortChange = useCallback((s: typeof sort) => {
    cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { id: "asc" });
  }, [setSort, updateAdaptiveLimit]);

  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => {
    setFilter((prev: typeof filter) => {
      const next = { ...(prev ?? {}) };
      if (value == null || value === "") delete next[field];
      else if (field === "dateRange") (next as any)[field] = value;
      else next[field] = { value, operator };
      return Object.keys(next).length > 0 ? next : undefined;
    });
  }, [setFilter]);

  const handleSearch = useCallback((v: string) => setSearch(v.trim()), [setSearch]);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, [setSearch, setFilter]);

  const handleCleanRefresh = useCallback(() => {
    cachedRowsRef.current = []; setCacheVersion(0);
    setSearch(""); setFilter(undefined); setSort({ id: "asc" }); updateAdaptiveLimit(500);
    queryClient.resetQueries({ queryKey: [model] });
  }, [queryClient, setSearch, setFilter, setSort, updateAdaptiveLimit]);

  const tableProps = useMemo(() => ({
    variant, onSelectItem,
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

ActivityHistoriesList.displayName = "ActivityHistoriesList";
export { ActivityHistoriesList, ActivityHistoriesForm }; 