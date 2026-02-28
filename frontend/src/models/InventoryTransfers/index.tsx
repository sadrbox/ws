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

const MODEL_ENDPOINT = "inventory-transfers";
const LIST_NAME = "InventoryTransfersList";
const FORM_LABEL = "Перемещение ТМЗ";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

interface TFormData {
  id?: number; uuid?: string;
  documentNumber: string; documentDate: string; description: string; status: string;
  fromWarehouseUuid: string; fromWarehouseName: string;
  toWarehouseUuid: string; toWarehouseName: string;
  organizationUuid: string; organizationName: string;
  ownerName: string;
}
const EMPTY_FORM: TFormData = { documentNumber: "", documentDate: "", description: "", status: "draft", fromWarehouseUuid: "", fromWarehouseName: "", toWarehouseUuid: "", toWarehouseName: "", organizationUuid: "", organizationName: "", ownerName: "" };

const InventoryTransfersForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData] = useState<TFormData>({ ...EMPTY_FORM });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        documentNumber: d.documentNumber ?? "", documentDate: d.documentDate?.slice(0, 16) ?? "", description: d.description ?? "", status: d.status ?? "draft",
        fromWarehouseUuid: d.fromWarehouseUuid ?? "", fromWarehouseName: d.fromWarehouse?.shortName ?? "",
        toWarehouseUuid: d.toWarehouseUuid ?? "", toWarehouseName: d.toWarehouse?.shortName ?? "",
        organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.shortName ?? "",
        ownerName: d.ownerName ?? "", id: d.id, uuid: d.uuid,
      });
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { if (uuid) loadFormData(uuid); }, [uuid, loadFormData]);
  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => { setFormData(prev => ({ ...prev, [field]: value })); }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    const payload: Record<string, unknown> = {
      documentNumber: formData.documentNumber?.trim() || null, documentDate: formData.documentDate || null,
      description: formData.description?.trim() || null, status: formData.status || "draft",
      fromWarehouseUuid: formData.fromWarehouseUuid || null, toWarehouseUuid: formData.toWarehouseUuid || null,
      organizationUuid: formData.organizationUuid || null, ownerName: formData.ownerName?.trim() || null,
    };
    try {
      const res = isEditMode && uuid ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid}`, payload) : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({
        ...prev, ...saved, documentNumber: saved.documentNumber ?? "", documentDate: saved.documentDate?.slice(0, 16) ?? "", description: saved.description ?? "", status: saved.status ?? "draft",
        fromWarehouseName: saved.fromWarehouse?.shortName ?? prev.fromWarehouseName,
        toWarehouseName: saved.toWarehouse?.shortName ?? prev.toWarehouseName,
        organizationName: saved.organization?.shortName ?? prev.organizationName,
        ownerName: saved.ownerName ?? prev.ownerName,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate(LIST_NAME) || FORM_LABEL}: ${saved.documentNumber || "?"} • ${saved.id ?? "?"}`);
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; } finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId]);
  const handleClose = useCallback(() => { onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}><div className={styles.TablePanelLeft}><div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
        <Button variant="primary" onClick={handleSaveAndClose} disabled={isLoading}><span>Сохранить и закрыть</span></Button><Divider />
        <Button onClick={handleSave} disabled={isLoading}><span>Сохранить</span></Button>
        <Button onClick={handleClose} disabled={isLoading}><span>Закрыть</span></Button><Divider />
        {isEditMode && <ButtonImage onClick={() => uuid && loadFormData(uuid)} title="Обновить" disabled={isLoading}><img src={reload_16} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} /></ButtonImage>}
      </div></div><div className={styles.TablePanelRight} /></div>
      {error && <div style={{ color: "red", padding: "12px", margin: "8px 0", background: "#ffebee", borderRadius: "4px" }}>{error}</div>}
      <div className={styles.FormBody}><div className={styles.FormBodyParts}>
        <Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
          <Field label="Номер документа" name={`${formUid}_docNum`} minWidth="339px" value={formData.documentNumber} onChange={e => handleFieldChange("documentNumber", e.target.value)} disabled={isLoading} />
          <FieldDateTime label="Дата документа" name={`${formUid}_docDate`} minWidth="200px" value={formData.documentDate} onChange={e => handleFieldChange("documentDate", e.target.value)} disabled={isLoading} />
          <FieldSelect label="Статус" name={`${formUid}_status`} value={formData.status} options={STATUS_OPTIONS} onChange={e => handleFieldChange("status", e.target.value)} disabled={isLoading} />
          <LookupField label="Со склада" name={`${formUid}_fromWh`} value={formData.fromWarehouseUuid} displayValue={formData.fromWarehouseName} endpoint="warehouses" displayField="shortName" onSelect={(u, d) => setFormData(prev => ({ ...prev, fromWarehouseUuid: u, fromWarehouseName: d }))} minWidth="339px" disabled={isLoading} />
          <LookupField label="На склад" name={`${formUid}_toWh`} value={formData.toWarehouseUuid} displayValue={formData.toWarehouseName} endpoint="warehouses" displayField="shortName" onSelect={(u, d) => setFormData(prev => ({ ...prev, toWarehouseUuid: u, toWarehouseName: d }))} minWidth="339px" disabled={isLoading} />
          <LookupField label="Организация" name={`${formUid}_org`} value={formData.organizationUuid} displayValue={formData.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => setFormData(prev => ({ ...prev, organizationUuid: u, organizationName: d }))} minWidth="339px" disabled={isLoading} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 339 }}>
            <label style={{ fontSize: 13, color: "#222" }} htmlFor={`${formUid}_desc`}>Описание</label>
            <textarea id={`${formUid}_desc`} value={formData.description} onChange={e => handleFieldChange("description", e.target.value)} disabled={isLoading} style={{ minWidth: 339, minHeight: 80, padding: 8, borderRadius: 4 }} />
          </div>
        </div></Group>
        {isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}><div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
          <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
          <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
        </div></Group></>}
      </div></div>
    </div>
  );
};
InventoryTransfersForm.displayName = "InventoryTransfersForm";

const stringifyJson = (v: any): string => { if (v == null) return ""; try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; } };
interface InventoryTransfersListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; ownerName?: string; }

const InventoryTransfersList: FC<InventoryTransfersListProps> = ({ variant = "default", onSelectItem, ownerUuid, ownerField, ownerName } = {}) => {
  const isPartOf = !!ownerUuid; const componentName = isPartOf ? `${LIST_NAME}_part` : LIST_NAME; const model = MODEL_ENDPOINT;
  const { addPane } = useAppContext().windows; const queryClient = useQueryClient(); const t = (k: string) => translate(k) || k;
  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName, isPartOf ? "part" : undefined));
  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>("sort", { id: "desc" }, undefined, { stringify: stringifyJson });
  const [search, setSearch] = useQueryParams<string>("search", "");
  const [filter, setFilter] = useQueryParams<Record<string, { value: unknown; operator: string }> | undefined>("filter", undefined, undefined, { stringify: stringifyJson });
  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);
  const ownerFilter = useMemo(() => { if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } }; return undefined; }, [ownerUuid, ownerField]);
  const params = useMemo(() => ({ sort, search, filter: ownerFilter ? { ...ownerFilter, ...filter } : filter }), [sort, search, filter, ownerFilter]);
  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage } = useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data; const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField ? { [ownerField]: ownerUuid, ownerName: ownerName || "" } as unknown as TDataItem : d;
    const title = isEdit ? (d?.documentNumber ? String(d.documentNumber).slice(0, 50) : t("noName")) : t("new");
    addPane({ label: `${t(componentName)}: ${title} • ${d?.id ?? "?"}`, component: InventoryTransfersForm, data: newData, onSave: () => refetch(), onClose: () => refetch() });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField, ownerName]);

  const cachedRowsRef = useRef<TDataItem[]>([]); const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);
  const handleSortChange = useCallback((s: typeof sort) => { cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { id: "desc" }); }, [setSort, updateAdaptiveLimit]);
  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => { setFilter((prev: typeof filter) => { const next = { ...(prev ?? {}) }; if (value == null || value === "") delete next[field]; else next[field] = { value, operator }; return Object.keys(next).length > 0 ? next : undefined; }); }, [setFilter]);
  const handleSearch = useCallback((v: string) => setSearch(v.trim()), [setSearch]);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, [setSearch, setFilter]);
  const handleCleanRefresh = useCallback(() => { cachedRowsRef.current = []; setCacheVersion(0); setSearch(""); setFilter(undefined); setSort({ id: "desc" }); updateAdaptiveLimit(500); queryClient.resetQueries({ queryKey: [model] }); }, [queryClient, setSearch, setFilter, setSort, updateAdaptiveLimit]);

  const tableProps = useMemo(() => ({
    variant, onSelectItem, enableDateRange: false, componentName, rows, columns, total,
    totalPages: Math.ceil(total / adaptiveLimit), isLoading: isAnythingLoading, isFetching: isAnythingLoading, error, hasNextPage, isFetchingNextPage,
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => { }, onLimitChange: () => { } },
    sorting: { sort, onSortChange: handleSortChange }, filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
    search: { value: search, onChange: handleSearch },
    actions: { openModelForm, refetch: handleCleanRefresh, setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
  }), [variant, onSelectItem, componentName, rows, columns, total, adaptiveLimit, isAnythingLoading, error, sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters, openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh]);

  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...tableProps} />;
};
InventoryTransfersList.displayName = "InventoryTransfersList";
export { InventoryTransfersList, InventoryTransfersForm };
