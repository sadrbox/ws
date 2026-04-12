import { FC, useCallback, useEffect, useState } from "react";
import { useAppContext } from "src/app";
import { useQueryClient } from "@tanstack/react-query";
import apiClient from "src/services/api/client";
import type { TPane } from "src/app/types";
import { Button, ButtonImage } from "src/components/Button";
import { Divider, Field, FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import useUID from "src/hooks/useUID";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
import { translate } from "src/i18";
import Tabs from "src/components/Tabs";
import { Group } from "src/components/UI";

const MODEL_ENDPOINT = "saleitems";

interface TFormData {
  id?: number;
  uuid?: string;
  lineNumber: string;
  productUuid: string;
  productName: string;
  quantity: string;
  price: string;
  amount: string;
  saleUuid: string;
}

const EMPTY_FORM: TFormData = {
  lineNumber: "",
  productUuid: "",
  productName: "",
  quantity: "",
  price: "",
  amount: "",
  saleUuid: "",
};

const SaleItemsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const saleUuid = (data as any)?.saleUuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const queryClient = useQueryClient();
  const formUid = useUID();

  const [formData, setFormData] = useState<TFormData>(() => ({
    ...EMPTY_FORM,
    saleUuid: saleUuid ?? "",
  }));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        id: d.id,
        uuid: d.uuid,
        lineNumber: d.lineNumber != null ? String(d.lineNumber) : "",
        productUuid: d.productUuid ?? "",
        productName: d.product?.shortName ?? "",
        quantity: d.quantity != null ? String(Number(d.quantity)) : "",
        price: d.price != null ? String(Number(d.price)) : "",
        amount: d.amount != null ? String(Number(d.amount)) : "",
        saleUuid: d.saleUuid ?? saleUuid ?? "",
      });
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); }
    finally { setIsLoading(false); }
  }, [saleUuid]);

  useEffect(() => { if (uuid) loadFormData(uuid); }, [uuid, loadFormData]);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field === "quantity" || field === "price") {
        const q = parseFloat(field === "quantity" ? value : prev.quantity) || 0;
        const p = parseFloat(field === "price" ? value : prev.price) || 0;
        next.amount = (Math.round(q * p * 100) / 100).toString();
      }
      return next;
    });
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    if (!formData.saleUuid) { setError("Документ продажи не указан"); setIsLoading(false); return false; }
    const payload = {
      saleUuid: formData.saleUuid,
      productUuid: formData.productUuid || null,
      quantity: formData.quantity ? parseFloat(formData.quantity) : 0,
      price: formData.price ? parseFloat(formData.price) : 0,
      lineNumber: formData.lineNumber ? parseInt(formData.lineNumber) : undefined,
    };
    try {
      const res = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({
        ...prev,
        id: saved.id,
        uuid: saved.uuid,
        lineNumber: saved.lineNumber != null ? String(saved.lineNumber) : "",
        productUuid: saved.productUuid ?? "",
        productName: saved.product?.shortName ?? prev.productName,
        quantity: saved.quantity != null ? String(Number(saved.quantity)) : "",
        price: saved.price != null ? String(Number(saved.price)) : "",
        amount: saved.amount != null ? String(Number(saved.amount)) : "",
        saleUuid: saved.saleUuid ?? prev.saleUuid,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate("SaleItemsList") || "Товар"}: ${saved.product?.shortName || "?"} • ${saved.id ?? "?"}`);
      queryClient.invalidateQueries({ queryKey: [MODEL_ENDPOINT] });
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; }
    finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel, queryClient]);

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
      <div className={styles.FormBody}><Tabs tabs={[
        {
          id: "general", label: translate("general") || "Общие сведения", component: (
            <div className={styles.FormBodyParts}>
              <Group align="row" gap="12px" className={styles.Form}>
                <LookupField label="Номенклатура" name={`${formUid}_product`} width="339px"
                  value={formData.productUuid} displayValue={formData.productName}
                  endpoint="products" displayField="shortName"
                  columns={[
                    { key: "shortName", label: "Наименование" },
                    { key: "sku", label: "Артикул" },
                    { key: "brand.shortName", label: "Бренд" },
                  ]}
                  onSelect={(uuid) => {
                    apiClient.get(`/products/${uuid}`).then(r => {
                      const o = r.data?.item ?? r.data;
                      setFormData(prev => ({ ...prev, productUuid: o.uuid, productName: o.shortName ?? "" }));
                    });
                  }}
                  onClear={() => setFormData(prev => ({ ...prev, productUuid: "", productName: "" }))}
                  disabled={isLoading} />
              </Group>
              <Group align="row" gap="12px" className={styles.Form}>
                <FieldNumber label="Количество" name={`${formUid}_qty`} width="180px"
                  value={formData.quantity} onChange={e => handleFieldChange("quantity", e.target.value)}
                  disabled={isLoading} step="0.0001" textAlign="right" />
                <FieldNumber label="Цена" name={`${formUid}_price`} width="180px"
                  value={formData.price} onChange={e => handleFieldChange("price", e.target.value)}
                  disabled={isLoading} step="0.01" textAlign="right" />
              </Group>
              <Group align="row" gap="12px" className={styles.Form}>
                <FieldNumber label="Сумма" name={`${formUid}_amount`} width="180px"
                  value={formData.amount} disabled textAlign="right" />
              </Group>
              {isEditMode && <><Divider /><Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                  <Field label="N строки" name={`${formUid}_lineNum`} width="80px" value={String(formData.lineNumber ?? "-")} disabled />
                  <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                  <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                </div>
              </Group></>}
            </div>
          )
        },
      ]} /></div>
    </div>
  );
};

SaleItemsForm.displayName = "SaleItemsForm";
export default SaleItemsForm;
