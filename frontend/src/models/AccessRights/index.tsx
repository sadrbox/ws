import { FC, useMemo, useCallback, useRef } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Divider, Field, FieldSelect } from "src/components/Field";
import { Group } from "src/components/UI";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import SubTable, { type SubTableContext } from "src/components/SubTable";

import { useFormStore } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import { makePaneLabel, makePaneLabelFromData } from "src/utils/buildPaneLabel";
import ModelFormWrapper from "src/components/ModelFormWrapper";

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

interface TFields {
  id?: number;
  uuid?: string;
  modelName: string;
  accessLevel: string;
  userUuid: string;
}

const DEFAULT_FIELDS: TFields = {
  modelName: "", accessLevel: "none", userUuid: "",
};

const AccessRightsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("AccessRight");

  // Если передан userUuid через data (новая запись из AccessRightsList) — подставляем
  const initialFields: TFields | undefined = (() => {
    const data = paneProps.data;
    if (!data || data.uuid) return undefined;
    if (data.userUuid) return { ...DEFAULT_FIELDS, userUuid: data.userUuid as string };
    return undefined;
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "access-rights-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,
    mapServerToForm: (d, prev) => ({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      modelName: d.modelName ?? "",
      accessLevel: d.accessLevel ?? "none",
      userUuid: d.userUuid ?? "",
    }),
    buildPayload: (fd) => {
      if (!fd.modelName?.trim()) return "Модель обязательна";
      if (!fd.userUuid) return "userUuid обязателен";
      return {
        modelName: fd.modelName.trim(),
        accessLevel: fd.accessLevel || "none",
        userUuid: fd.userUuid,
      };
    },
    buildPaneLabel: (saved) => makePaneLabel("AccessRightsList", "Право доступа", saved),
  });

  const tabs = useMemo(() => [
    {
      id: "general", label: translate("general") || "Основное", component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
              <FieldSelect
                label="Модель *"
                name={`${form.formUid}_modelName`}
                options={MODEL_NAME_OPTIONS}
                value={form.fields.modelName}
                onChange={e => form.setField("modelName", e.target.value)}
                disabled={form.isLoading}
              />
              <FieldSelect
                label="Уровень доступа"
                name={`${form.formUid}_accessLevel`}
                options={ACCESS_LEVEL_OPTIONS}
                value={form.fields.accessLevel}
                onChange={e => form.setField("accessLevel", e.target.value)}
                disabled={form.isLoading}
              />
              {form.isEditMode && (
                <>
                  <Divider />
                  <Group align="row" gap="12px" className={styles.Form}>
                    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                      <Field label="ID" name={`${form.formUid}_id`} width="100px" value={String(form.fields.id ?? "-")} disabled />
                      <Field label="UUID" name={`${form.formUid}_uuid`} width="300px" value={String(form.fields.uuid ?? "-")} disabled />
                    </div>
                  </Group>
                </>
              )}
            </div>
          </Group>
        </div>
      ),
    },
  ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField]);

  return (
    <ModelFormWrapper
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      showReload={form.isEditMode}
      error={form.error}
      errorRevision={form.errorRevision}
      onErrorDismiss={() => form.setError(null)}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
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
      label: makePaneLabelFromData("AccessRightsList", "Право доступа", isEdit ? data as any : null),
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
