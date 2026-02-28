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
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
import Tabs from "src/components/Tabs";
import { BankAccountsList } from "../BankAccounts";
import { ContractsList } from "../Contracts";
import { ContactsList } from "../Contacts";

const MODEL_ENDPOINT = "counterparties";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  bin: string;
  shortName: string;
  displayName: string;
}

const EMPTY_FORM: TFormData = { bin: "", shortName: "", displayName: "" };

const CounterpartiesForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData] = useState<TFormData>({ ...EMPTY_FORM });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const tabs = useMemo(() => [
    { id: 'tab1', label: 'Банковские счета', component: <BankAccountsList ownerUuid={formData.uuid} ownerField="counterpartyUuid" ownerName={formData.shortName} /> },
    { id: 'tab2', label: 'Договора', component: <ContractsList ownerUuid={formData.uuid} ownerField="counterpartyUuid" ownerName={formData.shortName} /> },
    { id: 'tab3', label: 'Контакты', component: <ContactsList ownerUuid={formData.uuid} ownerField="counterpartyUuid" ownerName={formData.shortName} /> },
  ], [formData.uuid, formData.shortName]);


  // ── Загрузка ──────────────────────────────────────────────────────────
  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = response.data?.item ?? response.data;
      setFormData({
        bin: d.bin ?? "", shortName: d.shortName ?? "", displayName: d.displayName ?? "",
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

  // ── Сохранение ────────────────────────────────────────────────────────
  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    const binTrimmed = formData.bin?.trim() ?? "";
    if (!binTrimmed || !/^\d{12}$/.test(binTrimmed)) {
      setError("БИН должен состоять ровно из 12 цифр");
      setIsLoading(false);
      return false;
    }

    const payload = {
      bin: binTrimmed,
      shortName: formData.shortName?.trim() || null,
      displayName: formData.displayName?.trim() || null,
    };

    try {
      const response = isEditMode && uuid
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);

      const saved = response.data?.item ?? response.data;
      setFormData(prev => ({ ...prev, ...saved, bin: saved.bin ?? prev.bin, shortName: saved.shortName ?? "", displayName: saved.displayName ?? "" }));
      setIsEditMode(true);
      if (uniqId) {
        const label = `${translate("CounterpartiesList") || "CounterpartiesList"}: ${saved.shortName || saved.bin || "?"} • ${saved.id ?? "?"}`;
        updatePaneLabel(uniqId, label);
      }
      onSave?.();
      return true;
    } catch (err: any) {
      let msg = "Не удалось сохранить";
      if (err.response?.status === 409) msg = "Контрагент с таким БИН уже существует";
      else if (err.response?.status === 400) msg = err.response.data?.message || "Ошибка валидации";
      else if (err.message) msg = err.message;
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [formData, isEditMode, uuid, onSave]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => {
    if (await submit()) { onClose?.(); if (uniqId) removePane(uniqId); }
  }, [submit, onClose, removePane, uniqId]);
  const handleClose = useCallback(() => { onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId]);

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
            <Field label="БИН / ИНН *" name={`${formUid}_bin`} width="150px"
              value={formData.bin} onChange={e => handleFieldChange("bin", e.target.value)} disabled={isLoading || isEditMode} />
            <Field label="Наименование" name={`${formUid}_shortName`}
              value={formData.shortName} onChange={e => handleFieldChange("shortName", e.target.value)} disabled={isLoading} />
            <Field label="Полное наименование" name={`${formUid}_displayName`}
              value={formData.displayName} onChange={e => handleFieldChange("displayName", e.target.value)} disabled={isLoading} />

          </Group>

          {isEditMode && (
            <>
              <Divider />
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="ID" name={`${formUid}_id`} width="60px" value={String(formData.id ?? "-")} disabled />
                </div>
                <Field label="UUID" name={`${formUid}_uuid`} minWidth="200px" value={String(formData.uuid ?? "-")} disabled />
              </Group>
            </>
          )}
        </div>

        {/* Табы с подтаблицами */}
        {isEditMode && formData.uuid && (
          <div className={styles.FormTable}>
            <Tabs tabs={tabs} />
          </div>
        )}
      </div>
    </div>
  );
};
CounterpartiesForm.displayName = "CounterpartiesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const stringifyJson = (v: any): string => {
  if (v == null) return "";
  try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; }
};

const CounterpartiesList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant = 'default', onSelectItem } = {}) => {
  const componentName = "CounterpartiesList";
  const model = MODEL_ENDPOINT;

  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName));
  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>("sort", { id: "asc" }, undefined, { stringify: stringifyJson });
  const [search, setSearch] = useQueryParams<string>("search", "");
  const [filter, setFilter] = useQueryParams<Record<string, { value: unknown; operator: string }> | undefined>("filter", undefined, undefined, { stringify: stringifyJson });

  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);

  const params = useMemo(() => ({ sort, search, filter }), [sort, search, filter]);
  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage } =
    useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.shortName || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: CounterpartiesForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
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

CounterpartiesList.displayName = "CounterpartiesList";
export { CounterpartiesList, CounterpartiesForm };
