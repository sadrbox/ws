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
import LookupField from "src/components/Field/LookupField";
import OwnerLookupField, { OwnerType } from "src/components/Field/OwnerLookupField";

const MODEL_ENDPOINT = "contacts";
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  value: string;
  contactTypeUuid: string;
  contactTypeName: string;
  ownerType: OwnerType;
  ownerUuid: string;
  ownerName: string;
}

const EMPTY_FORM: TFormData = {
  value: "", contactTypeUuid: "", contactTypeName: "",
  ownerType: "", ownerUuid: "", ownerName: "",
};

const ContactsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
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
    } else if (data.contactPersonUuid) {
      init.ownerType = "contactperson";
      init.ownerUuid = data.contactPersonUuid as string;
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
      const ot: OwnerType = d.organizationUuid ? "organization" : d.counterpartyUuid ? "counterparty" : d.contactPersonUuid ? "contactperson" : "";
      const ou = d.organizationUuid || d.counterpartyUuid || d.contactPersonUuid || "";
      const on = d.organization?.shortName || d.counterparty?.shortName || d.contactPerson?.fullName || d.ownerName || "";
      setFormData({
        value: d.value ?? "", contactTypeUuid: d.contactTypeUuid ?? "",
        contactTypeName: d.contactType?.shortName ?? d.contactType?.name ?? "",
        ownerType: ot, ownerUuid: ou, ownerName: on,
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

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    if (!formData.value?.trim()) { setError("Значение обязательно"); setIsLoading(false); return false; }
    const payload: Record<string, unknown> = {
      value: formData.value.trim(),
      contactTypeUuid: formData.contactTypeUuid || null,
      ownerName: formData.ownerName?.trim() || null,
      organizationUuid: formData.ownerType === "organization" ? formData.ownerUuid || null : null,
      counterpartyUuid: formData.ownerType === "counterparty" ? formData.ownerUuid || null : null,
      contactPersonUuid: formData.ownerType === "contactperson" ? formData.ownerUuid || null : null,
    };
    try {
      const response = isEditMode && uuid
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      const sot: OwnerType = saved.organizationUuid ? "organization" : saved.counterpartyUuid ? "counterparty" : saved.contactPersonUuid ? "contactperson" : "";
      const sou = saved.organizationUuid || saved.counterpartyUuid || saved.contactPersonUuid || "";
      const son = saved.organization?.shortName || saved.counterparty?.shortName || saved.contactPerson?.fullName || "";
      setFormData(prev => ({
        ...prev, ...saved, value: saved.value ?? "",
        contactTypeUuid: saved.contactTypeUuid ?? "",
        contactTypeName: saved.contactType?.shortName ?? saved.contactType?.name ?? prev.contactTypeName,
        ownerType: sot || prev.ownerType, ownerUuid: sou || prev.ownerUuid,
        ownerName: son || prev.ownerName,
      }));
      setIsEditMode(true);
      if (uniqId) {
        const label = `${translate("ContactsList") || "ContactsList"}: ${saved.value || "?"} • ${saved.id ?? "?"}`;
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
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId]);
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
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
              <Field label="Значение *" name={`${formUid}_value`} minWidth="339px" value={formData.value} onChange={e => handleFieldChange("value", e.target.value)} disabled={isLoading} />
              <LookupField
                label="Тип контакта" name={`${formUid}_contactTypeUuid`} minWidth="339px"
                value={formData.contactTypeUuid} displayValue={formData.contactTypeName}
                endpoint="contacttypes" displayField="shortName"
                columns={[{ key: "shortName", label: "Наименование" }]}
                onSelect={(uuid: string, display: string) => setFormData(prev => ({ ...prev, contactTypeUuid: uuid, contactTypeName: display }))}
                disabled={isLoading}
              />
              <OwnerLookupField
                ownerType={formData.ownerType} ownerUuid={formData.ownerUuid} ownerName={formData.ownerName}
                name={`${formUid}_owner`}
                onOwnerChange={({ ownerType, ownerUuid, ownerName }) =>
                  setFormData(prev => ({ ...prev, ownerType, ownerUuid, ownerName }))}
                typeLocked={!!formData.ownerType && (isEditMode || !!data?.organizationUuid || !!data?.counterpartyUuid || !!data?.contactPersonUuid)}
                disabled={isLoading}
              />
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
    </div>
  );
};
ContactsForm.displayName = "ContactsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const stringifyJson = (v: any): string => {
  if (v == null) return "";
  try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; }
};

interface ContactsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  ownerUuid?: string;
  ownerField?: string;
  ownerName?: string;
}

const ContactsList: FC<ContactsListProps> = ({ variant = 'default', onSelectItem, ownerUuid, ownerField, ownerName } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? "ContactsList_part" : "ContactsList";
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
    const newData = !isEdit && ownerUuid && ownerField
      ? { [ownerField]: ownerUuid, ownerName: ownerName || "" } as unknown as TDataItem
      : d;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.value || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: ContactsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField, ownerName]);

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

ContactsList.displayName = "ContactsList";
export { ContactsList, ContactsForm };
// export default memo(ContactsList);
