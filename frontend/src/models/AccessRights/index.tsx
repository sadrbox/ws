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
import { useQueryClient } from "@tanstack/react-query";
import { useModelDelete } from "src/hooks/useModelDelete";
import { Divider, Field, FieldSelect } from "src/components/Field";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";

const MODEL_ENDPOINT = "access-rights";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

const ACCESS_LEVEL_OPTIONS = [
  { value: "full", label: "Полный" },
  { value: "readonly", label: "Только чтение" },
  { value: "none", label: "Нет доступа" },
];

const MODEL_NAME_OPTIONS = [
  { value: "", label: "— Выберите —" },
  ...["Organizations", "Counterparties", "Contracts", "Sales", "Purchases",
    "Warehouses", "Products", "Brands", "Employees", "Contacts",
    "BankAccounts", "Currencies", "Todos", "Notifications",
    "OutgoingInvoices", "IncomingInvoices", "PaymentInvoices",
    "CashReceiptOrders", "CashExpenseOrders", "InventoryTransfers",
  ].map(v => ({ value: v, label: v })),
];

interface TFormData {
  id?: number;
  uuid?: string;
  modelName: string;
  accessLevel: string;
  userUuid: string;
}

const EMPTY_FORM: TFormData = {
  modelName: "", accessLevel: "none", userUuid: "",
};

const AccessRightsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const buildInitialForm = useCallback((): TFormData => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    if (data.userUuid) init.userUuid = data.userUuid as string;
    return init;
  }, [data]);

  const [formData, setFormData] = useState<TFormData>(buildInitialForm);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  // ── Загрузка данных ────────────────────────────────────────────────────
  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = response.data?.item ?? response.data;
      setFormData({
        id: d.id, uuid: d.uuid,
        modelName: d.modelName ?? "",
        accessLevel: d.accessLevel ?? "none",
        userUuid: d.userUuid ?? "",
      });
    } catch (err: any) {
      setError(err.response?.data?.message || "Не удалось загрузить данные");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { if (uuid) loadFormData(uuid); }, [uuid, loadFormData]);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    if (!formData.modelName?.trim()) { setError("Модель обязательна"); setIsLoading(false); return false; }
    if (!formData.userUuid) { setError("userUuid обязателен"); setIsLoading(false); return false; }
    const payload = {
      modelName: formData.modelName.trim(),
      accessLevel: formData.accessLevel || "none",
      userUuid: formData.userUuid,
    };
    try {
      const response = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      setFormData(prev => ({ ...prev, ...saved }));
      setIsEditMode(true);
      if (uniqId) {
        const label = `Право доступа: ${saved.modelName || "?"} • ${saved.id ?? "?"}`;
        updatePaneLabel(uniqId, label);
      }
      onSave?.();
      return true;
    } catch (err: any) {
      let msg = "Не удалось сохранить";
      if (err.response?.status === 400) msg = err.response.data?.message || "Ошибка валидации";
      else if (err.response?.status === 409) msg = err.response.data?.message || "Право доступа для этой модели уже существует";
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
              <FieldSelect
                label="Модель *"
                name={`${formUid}_modelName`}
                options={MODEL_NAME_OPTIONS}
                value={formData.modelName}
                onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
                disabled={isLoading}
              />
              <FieldSelect
                label="Уровень доступа"
                name={`${formUid}_accessLevel`}
                options={ACCESS_LEVEL_OPTIONS}
                value={formData.accessLevel}
                onChange={e => setFormData(prev => ({ ...prev, accessLevel: e.target.value }))}
                disabled={isLoading}
              />
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
          </Group>
        </div>
      </div>
    </div>
  );
};
AccessRightsForm.displayName = "AccessRightsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface AccessRightsListProps {
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
  userUuid?: string;
}

const AccessRightsList: FC<AccessRightsListProps> = ({ variant = "default", onSelectItem, userUuid }) => {
  const isPartOf = !!userUuid;
  const componentName = isPartOf ? "AccessRightsList_part" : "AccessRightsList";
  const model = MODEL_ENDPOINT;
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (key: string) => translate(key) || key;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName));
  const [sort, setSort] = useState<Record<string, "asc" | "desc">>({ id: "asc" });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Record<string, { value: unknown; operator: string }> | undefined>(undefined);

  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);

  const params = useMemo(() => ({
    sort, search, filter,
    extra: userUuid ? { userUuid } : undefined,
  }), [sort, search, filter, userUuid]);

  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage } =
    useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });

  const handleDelete = useModelDelete(model, refetch);
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    const newData = !isEdit && userUuid
      ? { userUuid } as unknown as TDataItem
      : d;
    addPane({
      label: isEdit ? `Право доступа: ${d?.modelName || t("noName")} • ${d?.id ?? "?"}` : `Право доступа: ${t("new")}`,
      component: AccessRightsForm, data: newData, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, userUuid]);

  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);

  const handleSortChange = useCallback((s: typeof sort) => {
    cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { id: "asc" });
  }, [updateAdaptiveLimit]);

  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => {
    setFilter((prev) => {
      const next = { ...(prev ?? {}) };
      if (value == null || value === "") delete next[field];
      else next[field] = { value, operator };
      return Object.keys(next).length > 0 ? next : undefined;
    });
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v.trim()), []);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, []);

  const handleCleanRefresh = useCallback(() => {
    cachedRowsRef.current = []; setCacheVersion(0);
    setSearch(""); setFilter(undefined); setSort({ id: "asc" }); updateAdaptiveLimit(500);
    queryClient.resetQueries({ queryKey: [model] });
  }, [queryClient, updateAdaptiveLimit]);

  const tableProps = useMemo(() => ({
    variant: isPartOf ? "embedded" as TTableVariant : variant,
    onSelectItem,
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
  }), [variant, isPartOf, onSelectItem, componentName, rows, columns, total, adaptiveLimit, isAnythingLoading, error,
    sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters,
    openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh, handleDelete]);

  if (!userUuid) {
    return (
      <div style={{ padding: "24px", color: "#999", textAlign: "center" }}>
        Сохраните пользователя, чтобы управлять правами доступа.
      </div>
    );
  }

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

AccessRightsList.displayName = "AccessRightsList";
export { AccessRightsList, AccessRightsForm };
