import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Divider, Field, FieldSelect } from "src/components/Field";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import SubTable, { type SubTableContext } from "src/components/SubTable";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useAccessRight } from "src/hooks/useAccessRight";

const MODEL_ENDPOINT = "access-rights";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

const ACCESS_LEVEL_OPTIONS = [
  { value: "full", label: translate("accessLevelFull") || "Полный" },
  { value: "readonly", label: translate("accessLevelReadonly") || "Только чтение" },
  { value: "none", label: translate("accessLevelNone") || "Нет доступа" },
];

const MODEL_NAME_OPTIONS = [
  { value: "", label: "— " + (translate("select") || "Выберите") + " —" },
  ...["Organizations", "Counterparties", "Contracts", "Sales", "Purchases",
    "Warehouses", "Products", "Brands", "Employees", "Contacts",
    "ContactPersons", "ContactTypes", "Positions",
    "BankAccounts", "Currencies", "Todos", "Notifications",
    "OutgoingInvoices", "IncomingInvoices", "PaymentInvoices",
    "CashReceiptOrders", "CashExpenseOrders", "InventoryTransfers",
    "ScheduledTasks", "Users", "ActivityHistories", "EmployeeHistories",
  ].map(v => ({ value: v, label: translate(v + "List") || v })),
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
  const { canWrite } = useAccessRight("AccessRight");
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const queryClient = useQueryClient();
  const formUid = useUID();

  // Начальное значение: если передан userUuid через data (новая запись из AccessRightsList) — подставляем
  const initialForm: TFormData = (!data || data.uuid)
    ? EMPTY_FORM
    : { ...EMPTY_FORM, userUuid: (data.userUuid as string) || "" };

  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "access-rights-form", uuid ?? "new", initialForm,
  );
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

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

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
      queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
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
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel, queryClient]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  const generalTab = useMemo(() => (
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
  ), [formData, isLoading, isEditMode, formUid, setFormData]);

  const tabs = useMemo<{ id: string; label: string; component: React.ReactNode }[]>(() => [
    { id: "general", label: translate("general") || "Общие сведения", component: generalTab },
  ], [generalTab]);

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
AccessRightsForm.displayName = "AccessRightsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface AccessRightsListProps {
  userUuid?: string;
}

const AccessRightsList: FC<AccessRightsListProps> = ({ userUuid }) => {
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (key: string) => translate(key) || key;

  // ── Маппинги для отображения/поиска ────────────────────────────────────
  const modelNameMap = useMemo(
    () => Object.fromEntries(MODEL_NAME_OPTIONS.filter(o => o.value).map(o => [o.value, o.label])),
    [],
  );
  const accessLevelMap = useMemo(
    () => Object.fromEntries(ACCESS_LEVEL_OPTIONS.map(o => [o.value, o.label])),
    [],
  );

  // ── Фронт-фильтрация по поиску (кириллица / латиница) ──────────────────
  const filterRows = useCallback((rows: TDataItem[], search: string): TDataItem[] => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((row: TDataItem) => {
      const modelLabel = (modelNameMap[row.modelName as string] ?? (row.modelName as string) ?? "").toLowerCase();
      const levelLabel = (accessLevelMap[row.accessLevel as string] ?? (row.accessLevel as string) ?? "").toLowerCase();
      const modelKey = ((row.modelName as string) ?? "").toLowerCase();
      const levelKey = ((row.accessLevel as string) ?? "").toLowerCase();
      const idStr = String(row.id ?? "");
      return words.every((w: string) =>
        modelLabel.includes(w) || modelKey.includes(w) ||
        levelLabel.includes(w) || levelKey.includes(w) ||
        idStr.includes(w)
      );
    });
  }, [modelNameMap, accessLevelMap]);

  // ── Inline-change с обновлением кэша React Query ──────────────────────
  const customInlineChange = useCallback(async (row: TDataItem, field: string, value: string) => {
    if (!row.uuid) return;
    await apiClient.put(`/${MODEL_ENDPOINT}/${row.uuid}`, { [field]: value });
    queryClient.setQueriesData({ queryKey: [MODEL_ENDPOINT] }, (oldData: any) => {
      if (!oldData?.pages) return oldData;
      return {
        ...oldData,
        pages: oldData.pages.map((page: any) => ({
          ...page,
          items: page.items.map((item: any) =>
            item.uuid === row.uuid ? { ...item, [field]: value } : item
          ),
        })),
      };
    });
  }, [queryClient]);

  // ── renderCell ─────────────────────────────────────────────────────────
  const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
    if (col.identifier === "modelName") {
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`inline_model_${row.id}`}
            options={MODEL_NAME_OPTIONS}
            value={(row.modelName as string) ?? ""}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => ctx.handleInlineChange(row, "modelName", e.target.value)}
            variant="table"
          />
        );
      }
      return <span>{modelNameMap[row.modelName as string] ?? row.modelName}</span>;
    }
    if (col.identifier === "accessLevel") {
      if (ctx.inlineEditing) {
        return (
          <FieldSelect
            name={`inline_level_${row.id}`}
            options={ACCESS_LEVEL_OPTIONS}
            value={(row.accessLevel as string) ?? "none"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => ctx.handleInlineChange(row, "accessLevel", e.target.value)}
            variant="table"
          />
        );
      }
      return <span>{accessLevelMap[row.accessLevel as string] ?? row.accessLevel}</span>;
    }
    return undefined;
  }, [modelNameMap, accessLevelMap]);

  // ── openFormFor ────────────────────────────────────────────────────────
  const openFormFor = useCallback((data: TDataItem | undefined, _ctx: SubTableContext) => {
    const isEdit = !!data?.uuid;
    const newData = !isEdit && userUuid ? { userUuid } as unknown as TDataItem : data;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
      _ctx.refetch();
    };
    addPane({
      label: isEdit
        ? `Право доступа: ${data?.modelName || t("noName")} • ${data?.id ?? "?"}`
        : `Право доступа: ${t("new")}`,
      component: AccessRightsForm,
      data: newData,
      onSave: refresh,
      onClose: refresh,
    });
  }, [addPane, t, userUuid, queryClient]);

  // ── onInlineAdd ────────────────────────────────────────────────────────
  const addingRef = useRef(false);
  const onInlineAdd = useCallback(async () => {
    if (!userUuid || addingRef.current) return;
    addingRef.current = true;
    try {
      // Получаем актуальный список с сервера, чтобы не полагаться на кэш
      const resp = await apiClient.get(`/${MODEL_ENDPOINT}`, { params: { userUuid, limit: 100 } });
      const serverRows: TDataItem[] = resp.data?.items ?? resp.data ?? [];
      const existingModels = new Set(serverRows.map((r: TDataItem) => r.modelName as string));
      const available = MODEL_NAME_OPTIONS.find(o => o.value && !existingModels.has(o.value));
      if (!available) {
        alert("Все модели уже добавлены");
        return;
      }
      await apiClient.post(`/${MODEL_ENDPOINT}`, { modelName: available.value, accessLevel: "none", userUuid });
    } catch (err: any) {
      // 409 = дубликат, не показываем ошибку — refetch обновит таблицу
      if (err.response?.status !== 409) {
        alert(err.response?.data?.message || "Ошибка создания");
      }
    } finally {
      addingRef.current = false;
    }
  }, [userUuid]);

  return (
    <SubTable
      model={MODEL_ENDPOINT}
      componentName="AccessRightsList_part"
      columnsJson={columnsJson}
      parentKey="userUuid"
      parentUuid={userUuid ?? ""}
      defaultSort={{ id: "asc" }}
      defaultInlineEditing={false}
      disabled={false}
      emptyMessage="Сохраните пользователя, чтобы управлять правами доступа."
      renderCell={renderCell}
      openFormFor={openFormFor}
      onInlineAdd={onInlineAdd}
      filterRows={filterRows}
      customInlineChange={customInlineChange}
    />
  );
};

AccessRightsList.displayName = "AccessRightsList";
export { AccessRightsList, AccessRightsForm };
