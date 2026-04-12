import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Field, FieldDate, FieldSelect } from "src/components/Field";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import LookupField from "src/components/Field/LookupField";
import SaleItemsTable from "./SaleItemsTable";
import { Group } from "src/components/UI";
import Tabs from "src/components/Tabs";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import { useFormError } from "src/hooks/useFormError";
import { commitPendingRows } from "src/services/commitPendingRows";
import FormPanel from "src/components/FormPanel";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "sales";
const LIST_NAME = "SalesList";
const FORM_LABEL = "Реализация";

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "approved", label: "Утверждён" },
  { value: "cancelled", label: "Отменён" },
];

interface TFormData {
  id?: number; uuid?: string;
  documentNumber: string; documentDate: string; description: string; amount: string; status: string; posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  /** Pending-строки SubTable товаров (сохраняются в sessionStorage вместе с формой) */
  _pendingSaleItems?: TDataItem[];
}
const EMPTY_FORM: TFormData = { documentNumber: "", documentDate: "", description: "", amount: "", status: "draft", posted: false, organizationUuid: "", organizationName: "", counterpartyUuid: "", counterpartyName: "", contractUuid: "", contractName: "" };

const SalesForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();
  const defaultOrg = useDefaultOrganization();

  const initialForm: TFormData = (() => {
    if (!data || data.uuid) return { ...EMPTY_FORM };
    const init = { ...EMPTY_FORM };
    if (data.organizationUuid) { init.organizationUuid = data.organizationUuid as string; init.organizationName = ""; }
    else if (defaultOrg.organizationUuid) { init.organizationUuid = defaultOrg.organizationUuid; init.organizationName = defaultOrg.organizationName; }
    if (data.counterpartyUuid) { init.counterpartyUuid = data.counterpartyUuid as string; init.counterpartyName = ""; }
    return init;
  })();
  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "sales-form", uuid ?? "new", initialForm,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError, errorRevision] = useFormError();
  const [isEditMode, setIsEditMode] = useState(!!uuid);
  const saleItemsPendingRef = useRef<TDataItem[]>([]);
  const queryClient = useQueryClient();

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => { setFormData(prev => ({ ...prev, [field]: value })); }, []);

  const handleTotalChange = useCallback((total: number) => {
    setFormData(prev => ({ ...prev, amount: String(total) }));
  }, []);

  const tabs = useMemo(() => [
    {
      id: "tab-details",
      label: translate("general") || "Общие сведения",
      component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: 640 }}>
              {/* ── Строка 1: ID + UUID ── */}
              {isEditMode && (
                <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                  <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                  <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                </div>
              )}
              {/* ── Строка 2: Дата + Проведён ── */}
              <div style={{ display: "flex", flexDirection: "row", gap: "12px", alignItems: "flex-end" }}>
                <FieldDate label="Дата" name={`${formUid}_docDate`} value={formData.documentDate} onChange={e => handleFieldChange("documentDate", e.target.value)} disabled={isLoading} width="200px" />
                <div style={{ display: "flex", alignItems: "center", gap: 6, height: 28, whiteSpace: "nowrap" }}>
                  <input type="checkbox" id={`${formUid}_posted`} checked={formData.posted} onChange={e => setFormData(prev => ({ ...prev, posted: e.target.checked }))} disabled={isLoading} />
                  <label htmlFor={`${formUid}_posted`} style={{ cursor: "pointer", userSelect: "none" }}>Проведён</label>
                </div>
              </div>
              {/* ── Строка 3: Организация + Контрагент ── */}
              <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                <LookupField label="Организация" name={`${formUid}_org`} value={formData.organizationUuid} displayValue={formData.organizationName} endpoint="organizations" displayField="shortName" onSelect={(u, d) => setFormData(prev => ({ ...prev, organizationUuid: u, organizationName: d }))} onClear={() => setFormData(prev => ({ ...prev, organizationUuid: "", organizationName: "" }))} disabled={isLoading} width="300px" />
                <LookupField label="Контрагент" name={`${formUid}_cpty`} value={formData.counterpartyUuid} displayValue={formData.counterpartyName} endpoint="counterparties" displayField="shortName" onSelect={(u, d) => setFormData(prev => ({ ...prev, counterpartyUuid: u, counterpartyName: d }))} onClear={() => setFormData(prev => ({ ...prev, counterpartyUuid: "", counterpartyName: "" }))} disabled={isLoading} width="300px" />
              </div>
              {/* ── Строка 4: Договор ── */}
              <LookupField label="Договор" name={`${formUid}_contract`} value={formData.contractUuid} displayValue={formData.contractName} endpoint="contracts" displayField="shortName" onSelect={(u, d) => setFormData(prev => ({ ...prev, contractUuid: u, contractName: d }))} onClear={() => setFormData(prev => ({ ...prev, contractUuid: "", contractName: "" }))} disabled={isLoading} width="300px" />
              {/* ── Строка 5: Статус + Сумма (только текст) ── */}
              <div style={{ display: "flex", flexDirection: "row", gap: "12px", alignItems: "flex-end" }}>
                <div style={{ width: 160 }}>
                  <FieldSelect label="Статус" name={`${formUid}_status`} value={formData.status} options={STATUS_OPTIONS} onChange={e => handleFieldChange("status", e.target.value)} disabled={isLoading} />
                </div>
                <Field label="Сумма" name={`${formUid}_amount`} value={formData.amount} disabled width="160px" />
              </div>
              {/* ── Строка 6: Комментарий ── */}
              <Field label="Комментарий" name={`${formUid}_desc`} value={formData.description} onChange={e => handleFieldChange("description", e.target.value)} disabled={isLoading} />
            </div>
          </Group>
        </div>
      ),
    },
    {
      id: "tab-items",
      label: "Товары",
      component: isEditMode && formData.uuid ? (
        <SaleItemsTable
          saleUuid={formData.uuid}
          disabled={isLoading}
          deferRemoteChanges={true}
          initialPendingRows={formData._pendingSaleItems}
          onTotalChange={handleTotalChange}
          onItemsChange={(items) => {
            const all = items ?? [];
            const pending = all.filter((r: any) => r._pendingAction);
            saleItemsPendingRef.current = pending;
            setFormData(prev => {
              const prevPending = prev._pendingSaleItems;
              const next = pending.length ? pending : undefined;
              if (JSON.stringify(prevPending) === JSON.stringify(next)) return prev;
              return { ...prev, _pendingSaleItems: next };
            });
          }}
        />
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14, padding: "24px 0" }}>
          Сохраните документ для добавления товаров
        </div>
      ),
    },
  ], [formUid, formData, isLoading, isEditMode, handleFieldChange, handleTotalChange, data]);

  // ── Коммит pending sale items ──────────────────────────────────────────
  const commitPendingSaleItems = useCallback(async (savedParentUuid: string) => {
    const rows = saleItemsPendingRef.current || [];
    if (!rows.length) return;
    await commitPendingRows("saleitems", rows, savedParentUuid, "saleUuid",
      translate("SaleItemsList") || "Товары",
      {
        createPayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
        }),
        updatePayload: (r: any) => ({
          productUuid: r.productUuid ?? null,
          quantity: r.quantity ?? 0,
          price: r.price ?? 0,
        }),
        extraSkipFields: ["saleUuid"],
      },
    );
  }, []);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        documentNumber: d.documentNumber ?? "", documentDate: d.documentDate?.slice(0, 10) ?? "",
        description: d.description ?? "", amount: d.amount != null ? String(d.amount) : "", status: d.status ?? "draft",
        posted: d.posted === true,
        organizationUuid: d.organizationUuid ?? "", organizationName: d.organization?.shortName ?? "",
        counterpartyUuid: d.counterpartyUuid ?? "", counterpartyName: d.counterparty?.shortName ?? "",
        contractUuid: d.contractUuid ?? "", contractName: d.contract?.shortName ?? "",
        id: d.id, uuid: d.uuid,
      });
      // Обновляем вложенную SubTable — invalidate кэш строк продажи
      queryClient.invalidateQueries({ queryKey: ["saleitems"] });
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); } finally { setIsLoading(false); }
  }, [queryClient]);

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    const payload: Record<string, unknown> = {
      documentNumber: formData.documentNumber?.trim() || null, documentDate: formData.documentDate || null,
      description: formData.description?.trim() || null, amount: formData.amount ? parseFloat(formData.amount) : null,
      status: formData.status || "draft",
      posted: formData.posted === true,
      organizationUuid: formData.organizationUuid || null,
      counterpartyUuid: formData.counterpartyUuid || null,
      contractUuid: formData.contractUuid || null,
    };
    try {
      const res = isEditMode && (uuid || formData.uuid) ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload) : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({
        ...prev,
        documentNumber: saved.documentNumber ?? "", documentDate: saved.documentDate?.slice(0, 10) ?? "",
        description: saved.description ?? "", amount: saved.amount != null ? String(saved.amount) : "",
        status: saved.status ?? "draft",
        posted: saved.posted === true,
        organizationUuid: saved.organizationUuid ?? prev.organizationUuid,
        organizationName: saved.organization?.shortName ?? prev.organizationName,
        counterpartyUuid: saved.counterpartyUuid ?? prev.counterpartyUuid,
        counterpartyName: saved.counterparty?.shortName ?? prev.counterpartyName,
        contractUuid: saved.contractUuid ?? prev.contractUuid,
        contractName: saved.contract?.shortName ?? prev.contractName,
        id: saved.id, uuid: saved.uuid,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate(LIST_NAME) || FORM_LABEL}: ${saved.id ?? "?"}`);
      // Коммит pending sale items
      try {
        await commitPendingSaleItems(saved.uuid ?? saved.id ?? "");
        saleItemsPendingRef.current = [];
        setFormData(prev => ({ ...prev, _pendingSaleItems: undefined }));
      } catch (e: any) {
        setError(e?.message || "Не удалось сохранить товары");
        return false;
      }
      // Отложенный invalidate — ждём один тик рендера, чтобы SubTable
      // успел получить новый parentUuid и включить свой query (enabled: true).
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["saleitems"] });
      }, 0);
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; } finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel, commitPendingSaleItems]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  return (
    <div className={styles.FormWrapper}>
      <FormPanel
        onSaveAndClose={handleSaveAndClose}
        onSave={handleSave}
        onClose={handleClose}
        onReload={uuid ? () => loadFormData(uuid) : undefined}
        isLoading={isLoading}
        showReload={isEditMode}
      />
      <FormError message={error} revision={errorRevision} onDismiss={() => setError(null)} />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
SalesForm.displayName = "SalesForm";

interface SalesListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; }

const SalesList: FC<SalesListProps> = ({ variant = "default", onSelectItem, ownerUuid, ownerField } = {}) => {
  const isPartOf = !!ownerUuid;
  const componentName = isPartOf ? `${LIST_NAME}_part` : LIST_NAME;
  const { addPane } = useAppContext().windows;
  const t = (k: string) => translate(k) || k;

  const ownerFilter = useMemo(() => {
    if (ownerUuid && ownerField) return { [ownerField]: { value: ownerUuid, operator: "equals" } };
    return undefined;
  }, [ownerUuid, ownerField]);

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT,
    componentName,
    columnsJson,
    defaultSort: { id: "desc" },
    columnsVariant: isPartOf ? "part" : undefined,
    ownerFilter,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data; const isEdit = !!d?.uuid;
    const newData = !isEdit && ownerUuid && ownerField ? { [ownerField]: ownerUuid } as unknown as TDataItem : d;
    const title = isEdit ? (d?.id ? String(d.id) : t("noName")) : t("new");
    addPane({ label: `${t(componentName)}: ${title} • ${d?.id ?? "?"}`, component: SalesForm, data: newData, onSave: () => refetch(), onClose: () => refetch() });
  }, [addPane, t, refetch, componentName, ownerUuid, ownerField]);

  const tableProps = useMemo(() => buildTableProps({ variant, onSelectItem, openModelForm }), [buildTableProps, variant, onSelectItem, openModelForm]);

  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...tableProps} />;
};
SalesList.displayName = "SalesList";
export { SalesList, SalesForm };
