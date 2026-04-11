import { FC, useMemo, useCallback, useState, useEffect } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Divider, Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";

import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import FormError from "src/components/FormError";
import FormPanel from "src/components/FormPanel";
import { useAccessRight } from "src/hooks/useAccessRight";
import { useModelListState } from "src/hooks/useModelListState";

const MODEL_ENDPOINT = "products";
const LIST_NAME = "ProductsList";
const FORM_LABEL = "Номенклатура";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  shortName: string;
  sku: string;
  brandUuid: string;
  brandName: string;
}

const EMPTY_FORM: TFormData = { shortName: "", sku: "", brandUuid: "", brandName: "" };

const ProductsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { canWrite } = useAccessRight("Product");
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "products-form", uuid ?? "new", EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        shortName: d.shortName ?? "", sku: d.sku ?? "",
        brandUuid: d.brandUuid ?? "", brandName: d.brand?.shortName ?? "",
        id: d.id, uuid: d.uuid,
      });
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    if (!formData.shortName?.trim()) { setError("Наименование обязательно"); setIsLoading(false); return false; }
    const payload = {
      shortName: formData.shortName.trim(),
      sku: formData.sku?.trim() || null,
      brandUuid: formData.brandUuid || null,
    };
    try {
      const res = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({
        ...prev, ...saved,
        shortName: saved.shortName ?? "", sku: saved.sku ?? "",
        brandUuid: saved.brandUuid ?? "", brandName: saved.brand?.shortName ?? prev.brandName,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate(LIST_NAME) || FORM_LABEL}: ${saved.shortName || "?"} • ${saved.id ?? "?"}`);
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; }
    finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  const generalTab = useMemo(() => (
    <div className={styles.FormBodyParts}>
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                  <Field label="Наименование *" name={`${formUid}_shortName`} minWidth="339px"
                    value={formData.shortName} onChange={e => handleFieldChange("shortName", e.target.value)} disabled={isLoading} />
                  <Field label="Артикул" name={`${formUid}_sku`} minWidth="200px"
                    value={formData.sku} onChange={e => handleFieldChange("sku", e.target.value)} disabled={isLoading} />
                  <LookupField
                    label="Бренд"
                    name={`${formUid}_brand`}
                    minWidth="339px"
                    value={formData.brandUuid}
                    displayValue={formData.brandName}
                    endpoint="brands"
                    displayField="shortName"
                    columns={[{ key: "shortName", label: "Наименование" }]}
                    onSelect={(uuid, display) => setFormData(prev => ({ ...prev, brandUuid: uuid, brandName: display }))}
                    onClear={() => setFormData(prev => ({ ...prev, brandUuid: "", brandName: "" }))}
                    disabled={isLoading}
                  />
                </div>
              </Group>
              {isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                  <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                  <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                </div>
              </Group></>}
            </div>
  ), [formData, isLoading, isEditMode, formUid, handleFieldChange, setFormData]);

  const tabs = useMemo<{ id: string; label: string; component: React.ReactNode }[]>(() => [
    { id: "general", label: translate("general") || "Общие сведения", component: generalTab },
  ], [generalTab]);

  return (
    <div className={styles.FormWrapper}>
      <FormPanel
        readonly={!canWrite}
        onSaveAndClose={handleSaveAndClose}
        onSave={handleSave}
        onClose={handleClose}
        onReload={uuid ? () => loadFormData(uuid) : undefined}
        isLoading={isLoading}
        showReload={isEditMode}
      />
      <FormError message={error} onDismiss={() => setError(null)} />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
ProductsForm.displayName = "ProductsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

interface ProductsListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; }

const ProductsList: FC<ProductsListProps> = ({ variant = "default", onSelectItem } = {}) => {
  const { addPane } = useAppContext().windows;
  const t = (k: string) => translate(k) || k;

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT,
    componentName: LIST_NAME,
    columnsJson,
    defaultSort: { id: "asc" },
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit ? `${t(LIST_NAME)}: ${d?.shortName || t("noName")} • ${d?.id ?? "?"}` : `${t(LIST_NAME)}: ${t("new")}`,
      component: ProductsForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch]);

  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...buildTableProps({ variant, onSelectItem, openModelForm, enableDateRange: false })} />;
};
ProductsList.displayName = "ProductsList";
export { ProductsList, ProductsForm };
