/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TPane } from "src/app/types";
import { FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupRow, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore, setPaneDirty } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import ModelForm from "src/components/ModelForm";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { useAppContext } from "src/app";
import useUID from "src/hooks/useUID";
import { recalcSaleItemAmounts, withSaleItemRecalc } from "./saleItemDraft";

const MODEL_ENDPOINT = "saleitems";

interface TFields {
  id?: number;
  uuid?: string;
  lineNumber: number;
  productUuid: string;
  productName: string;
  quantity: number;
  price: number;
  amount: number;
  unitOfMeasureUuid: string;
  unitOfMeasureName: string;
  vatRateUuid: string;
  vatRateName: string;
  vatRate: number;
  vatAmount: number;
  discountPercent: number;
  discountAmount: number;
  saleUuid: string;
}

interface EmbeddedSaleItemConfig {
  applyDraft: (nextRow: Record<string, unknown>) => void;
}

const DEFAULT_FIELDS: TFields = {
  lineNumber: 0,
  productUuid: "",
  productName: "",
  quantity: 0,
  price: 0,
  amount: 0,
  unitOfMeasureUuid: "",
  unitOfMeasureName: "",
  vatRateUuid: "",
  vatRateName: "",
  vatRate: 0,
  vatAmount: 0,
  discountPercent: 0,
  discountAmount: 0,
  saleUuid: "",
};

function mapDataToFields(data: Record<string, any> | undefined, saleUuid?: string): TFields {
  if (!data) return { ...DEFAULT_FIELDS, saleUuid: saleUuid ?? "" };
  return {
    ...DEFAULT_FIELDS,
    id: data.id,
    uuid: data.uuid,
    lineNumber: data.lineNumber != null ? Number(data.lineNumber) : 0,
    productUuid: data.productUuid ?? "",
    productName: data.product?.shortName ?? data.productName ?? "",
    quantity: data.quantity != null ? Number(data.quantity) : 0,
    price: data.price != null ? Number(data.price) : 0,
    amount: data.amount != null ? Number(data.amount) : 0,
    unitOfMeasureUuid: data.unitOfMeasureUuid ?? "",
    unitOfMeasureName: data.unitOfMeasure?.shortName ?? data.unitOfMeasureName ?? "",
    vatRateUuid: data.vatRateUuid ?? "",
    vatRateName: data.vatRateRef?.shortName ?? data.vatRateName ?? "",
    vatRate: data.vatRate != null ? Number(data.vatRate) : 0,
    vatAmount: data.vatAmount != null ? Number(data.vatAmount) : 0,
    discountPercent: data.discountPercent != null ? Number(data.discountPercent) : 0,
    discountAmount: data.discountAmount != null ? Number(data.discountAmount) : 0,
    saleUuid: data.saleUuid ?? saleUuid ?? "",
  };
}

function fieldsToDraftRow(fields: TFields): Record<string, unknown> {
  return {
    lineNumber: fields.lineNumber ? fields.lineNumber : undefined,
    productUuid: fields.productUuid || null,
    product: fields.productUuid ? { uuid: fields.productUuid, shortName: fields.productName } : null,
    quantity: fields.quantity,
    price: fields.price,
    amount: fields.amount,
    unitOfMeasureUuid: fields.unitOfMeasureUuid || null,
    unitOfMeasure: fields.unitOfMeasureUuid ? { uuid: fields.unitOfMeasureUuid, shortName: fields.unitOfMeasureName } : null,
    vatRateUuid: fields.vatRateUuid || null,
    vatRateRef: fields.vatRateUuid
      ? { uuid: fields.vatRateUuid, shortName: fields.vatRateName, rate: fields.vatRate || 0 }
      : null,
    vatRate: fields.vatRate,
    vatAmount: fields.vatAmount,
    discountPercent: fields.discountPercent,
    discountAmount: fields.discountAmount,
    saleUuid: fields.saleUuid,
  };
}

interface SaleItemsFieldsFormProps {
  fields: TFields;
  setFields: (patch: Partial<TFields>) => void;
  isLoading: boolean;
  formUid: string;
}

const SaleItemsFieldsForm: FC<SaleItemsFieldsFormProps> = ({
  fields,
  setFields,
  isLoading,
  formUid,
}) => {
  const { isVatEnabled } = useOrgAccountingSettings();

  const handleNumericChange = useCallback((field: keyof TFields, value: string) => {
    setFields(withSaleItemRecalc(fields, { [field]: value }) as Partial<TFields>);
  }, [fields, setFields]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.Form}>
        <GroupCol>
          {/* Строка 1: Номенклатура (во всю ширину) */}
          <Group>
            <LookupField
              label="Номенклатура"
              name={`${formUid}_product`}
              value={fields.productUuid}
              displayValue={fields.productName}
              endpoint="products"
              displayField="shortName"
              columns={[
                { key: "shortName", label: "Наименование" },
                { key: "sku", label: "Артикул" },
                { key: "brand.shortName", label: "Бренд" },
              ]}
              onSelect={(uuid, display) =>
                setFields({ productUuid: uuid, productName: display })
              }
              onClear={() =>
                setFields({ productUuid: "", productName: "" })
              }
              disabled={isLoading}
            />
          </Group>

          {/* Строка 2: Количество · Цена · Ед. изм. */}
          <GroupRow>
            <FieldNumber
              label="Количество"
              name={`${formUid}_qty`}
              value={fields.quantity}
              onChange={e => handleNumericChange("quantity", e.target.value)}
              disabled={isLoading}
              step="0.1"
              textAlign="right"
              width="160px"
            />
            <FieldNumber
              label="Цена"
              name={`${formUid}_price`}
              value={fields.price}
              onChange={e => handleNumericChange("price", e.target.value)}
              disabled={isLoading}
              step="0.1"
              textAlign="right"
              width="160px"
            />
            <LookupField
              label="Ед. изм."
              name={`${formUid}_uom`}
              value={fields.unitOfMeasureUuid}
              displayValue={fields.unitOfMeasureName}
              endpoint="unit-of-measures"
              displayField="shortName"
              columns={[
                { key: "shortName", label: "Наименование" },
                { key: "code", label: "Код" },
              ]}
              onSelect={(uuid, display) =>
                setFields({ unitOfMeasureUuid: uuid, unitOfMeasureName: display })
              }
              onClear={() =>
                setFields({ unitOfMeasureUuid: "", unitOfMeasureName: "" })
              }
              disabled={isLoading}
              width="160px"
            />
          </GroupRow>

          {/* Строка 3: Ставка НДС · Скидка % */}
          <GroupRow>
            {isVatEnabled && (
              <LookupField
                label="Ставка НДС"
                name={`${formUid}_vatRate`}
                value={fields.vatRateUuid}
                displayValue={fields.vatRateName}
                endpoint="vat-rates"
                displayField="shortName"
                columns={[
                  { key: "shortName", label: "Наименование" },
                  { key: "rate", label: "%" },
                ]}
                onSelect={(uuid, display, item) => {
                  const rate = item?.rate != null ? Number(item.rate) : Number(fields.vatRate);
                  setFields({
                    vatRateUuid: uuid,
                    vatRateName: display,
                    vatRate: rate,
                    ...recalcSaleItemAmounts(fields.quantity, fields.price, rate, fields.discountPercent),
                  });
                }}
                onClear={() => {
                  setFields({
                    vatRateUuid: "",
                    vatRateName: "",
                    vatRate: 0,
                    ...recalcSaleItemAmounts(fields.quantity, fields.price, "0", fields.discountPercent),
                  });
                }}
                disabled={isLoading}
                width="200px"
              />
            )}
            <FieldNumber
              label="Скидка %"
              name={`${formUid}_discPct`}
              value={fields.discountPercent}
              onChange={e => handleNumericChange("discountPercent", e.target.value)}
              disabled={isLoading}
              step="0.1"
              textAlign="right"
              width="120px"
            />
          </GroupRow>

          {/* Строка 4: Сумма скидки · НДС · Итого */}
          <GroupRow>
            <FieldNumber
              label="Сумма скидки"
              name={`${formUid}_discAmt`}
              value={fields.discountAmount}
              disabled
              textAlign="right"
              width="150px"
            />
            {isVatEnabled && (
              <FieldNumber
                label="НДС (в т.ч.)"
                name={`${formUid}_vatAmt`}
                value={fields.vatAmount}
                disabled
                textAlign="right"
                width="150px"
              />
            )}
            <FieldNumber
              label="Итого"
              name={`${formUid}_amount`}
              value={fields.amount}
              disabled
              textAlign="right"
              width="180px"
            />
          </GroupRow>
        </GroupCol>
      </div>
    </div>
  );
};

const SaleItemsStandaloneForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Sale");
  const data = paneProps.data;
  const saleUuid = (data as any)?.saleUuid as string | undefined;

  const initialFields: TFields | undefined = (() => {
    if (!data || data.uuid) return undefined;
    return { ...DEFAULT_FIELDS, saleUuid: saleUuid ?? "" };
  })();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "sale-items-form",
    defaultFields: DEFAULT_FIELDS,
    initialFields,
    paneProps,

    mapServerToForm: (d) => mapDataToFields(d, saleUuid),

    buildPayload: (fd) => {
      if (!fd.saleUuid) return "Документ продажи не указан";
      return {
        saleUuid: fd.saleUuid,
        productUuid: fd.productUuid || null,
        quantity: fd.quantity ? fd.quantity : 0,
        price: fd.price ? fd.price : 0,
        lineNumber: fd.lineNumber ? fd.lineNumber : undefined,
        unitOfMeasureUuid: fd.unitOfMeasureUuid || null,
        vatRateUuid: fd.vatRateUuid || null,
        vatRate: fd.vatRate ? fd.vatRate : 0,
        discountPercent: fd.discountPercent ? fd.discountPercent : 0,
      };
    },

    buildPaneLabel: (saved) => {
      const product = saved.product?.shortName?.trim();
      const qty = saved.quantity != null ? Number(saved.quantity) : null;
      const amount = saved.amount != null ? Number(saved.amount) : null;
      const parts: string[] = [];
      if (product) parts.push(product);
      if (qty != null && amount != null) parts.push(`${qty} × ${amount}`);
      else if (qty != null) parts.push(String(qty));
      const detail = parts.length > 0 ? parts.join(" · ") : String(saved.id ?? "?");
      return makePaneLabel("SaleItemsList", "Строка продажи", saved, detail);
    },
  });

  const tabs = useMemo(() => [
    {
      id: "general",
      label: "Основное",
      component: (
        <SaleItemsFieldsForm
          fields={form.fields}
          setFields={form.setFields}
          isLoading={form.isLoading}
          formUid={form.formUid}
        />
      ),
    },
  ], [form.fields, form.setFields, form.isLoading, form.isEditMode, form.formUid]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.uuid ? () => form.loadFromServer(form.uuid!) : undefined}
      isLoading={form.isLoading}
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};

const SaleItemsEmbeddedForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Sale");
  const { windows: { requestClose } } = useAppContext();
  const formUid = useUID();
  const uniqId = paneProps.uniqId;
  const data = paneProps.data as Record<string, any> | undefined;
  const embedded = data?._embeddedSaleItem as EmbeddedSaleItemConfig | undefined;
  const initialFields = useMemo(() => mapDataToFields(data, data?.saleUuid as string | undefined), [data]);
  const [fields, setFieldsState] = useState<TFields>(initialFields);
  const initialSnapshotRef = useRef(JSON.stringify(initialFields));
  const isDirty = JSON.stringify(fields) !== initialSnapshotRef.current;

  const setFields = useCallback((patch: Partial<TFields>) => {
    setFieldsState((prev) => {
      const next = { ...prev, ...patch };
      embedded?.applyDraft(fieldsToDraftRow(next));
      return next;
    });
  }, [embedded]);

  // «Обновить» — откатить локальные изменения к исходному состоянию строки.
  const handleReload = useCallback(() => {
    setFieldsState(initialFields);
    embedded?.applyDraft(fieldsToDraftRow(initialFields));
  }, [initialFields, embedded]);

  useEffect(() => {
    if (!uniqId) return;
    setPaneDirty(uniqId, isDirty);
  }, [uniqId, isDirty]);

  useEffect(() => {
    if (!uniqId) return undefined;
    return () => {
      setPaneDirty(uniqId, false);
    };
  }, [uniqId]);

  const handleClose = useCallback(() => {
    if (paneProps.onClose) void paneProps.onClose();
    if (uniqId) void requestClose(uniqId, { force: true });
  }, [paneProps, uniqId, requestClose]);

  const tabs = useMemo(() => [
    {
      id: "general",
      label: "Основное",
      component: (
        <SaleItemsFieldsForm
          fields={fields}
          setFields={setFields}
          isLoading={false}
          formUid={formUid}
        />
      ),
    },
  ], [fields, setFields, formUid]);

  return (
    <ModelForm
      paneId={uniqId}
      tabs={tabs}
      onSave={handleClose}
      onSaveAndClose={handleClose}
      onClose={handleClose}
      onReload={isDirty ? handleReload : undefined}
      isLoading={false}
      readonly={!canWrite}
      isDirty={isDirty}
    />
  );
};

const SaleItemsForm: FC<Partial<TPane>> = (paneProps) => {
  const embedded = !!(paneProps.data as any)?._embeddedSaleItem;
  if (embedded) return <SaleItemsEmbeddedForm {...paneProps} />;
  return <SaleItemsStandaloneForm {...paneProps} />;
};

SaleItemsForm.displayName = "SaleItemsForm";
export default SaleItemsForm;
