/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-misused-promises */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TPane } from "src/app/types";
import { Divider, Field, FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore, setPaneDirty } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import ModelFormWrapper from "src/components/ModelFormWrapper";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { useAppContext } from "src/app";
import useUID from "src/hooks/useUID";
import { recalcSaleItemAmounts, withSaleItemRecalc } from "./saleItemDraft";

const MODEL_ENDPOINT = "saleitems";

interface TFields {
  id?: number;
  uuid?: string;
  lineNumber: string;
  productUuid: string;
  productName: string;
  quantity: string;
  price: string;
  amount: string;
  unitOfMeasureUuid: string;
  unitOfMeasureName: string;
  vatRateUuid: string;
  vatRateName: string;
  vatRate: string;
  vatAmount: string;
  discountPercent: string;
  discountAmount: string;
  saleUuid: string;
}

interface EmbeddedSaleItemConfig {
  applyDraft: (nextRow: Record<string, unknown>) => void;
}

const DEFAULT_FIELDS: TFields = {
  lineNumber: "",
  productUuid: "",
  productName: "",
  quantity: "",
  price: "",
  amount: "0",
  unitOfMeasureUuid: "",
  unitOfMeasureName: "",
  vatRateUuid: "",
  vatRateName: "",
  vatRate: "12",
  vatAmount: "0",
  discountPercent: "0",
  discountAmount: "0",
  saleUuid: "",
};

function mapDataToFields(data: Record<string, any> | undefined, saleUuid?: string): TFields {
  if (!data) return { ...DEFAULT_FIELDS, saleUuid: saleUuid ?? "" };
  return {
    ...DEFAULT_FIELDS,
    id: data.id,
    uuid: data.uuid,
    lineNumber: data.lineNumber != null ? String(data.lineNumber) : "",
    productUuid: data.productUuid ?? "",
    productName: data.product?.shortName ?? data.productName ?? "",
    quantity: data.quantity != null ? String(Number(data.quantity)) : "",
    price: data.price != null ? String(Number(data.price)) : "",
    amount: data.amount != null ? String(Number(data.amount)) : "0",
    unitOfMeasureUuid: data.unitOfMeasureUuid ?? "",
    unitOfMeasureName: data.unitOfMeasure?.shortName ?? data.unitOfMeasureName ?? "",
    vatRateUuid: data.vatRateUuid ?? "",
    vatRateName: data.vatRateRef?.shortName ?? data.vatRateName ?? "",
    vatRate: data.vatRate != null ? String(Number(data.vatRate)) : "12",
    vatAmount: data.vatAmount != null ? String(Number(data.vatAmount)) : "0",
    discountPercent: data.discountPercent != null ? String(Number(data.discountPercent)) : "0",
    discountAmount: data.discountAmount != null ? String(Number(data.discountAmount)) : "0",
    saleUuid: data.saleUuid ?? saleUuid ?? "",
  };
}

function fieldsToDraftRow(fields: TFields): Record<string, unknown> {
  return {
    lineNumber: fields.lineNumber ? parseInt(fields.lineNumber, 10) : undefined,
    productUuid: fields.productUuid || null,
    product: fields.productUuid ? { uuid: fields.productUuid, shortName: fields.productName } : null,
    quantity: fields.quantity,
    price: fields.price,
    amount: fields.amount,
    unitOfMeasureUuid: fields.unitOfMeasureUuid || null,
    unitOfMeasure: fields.unitOfMeasureUuid ? { uuid: fields.unitOfMeasureUuid, shortName: fields.unitOfMeasureName } : null,
    vatRateUuid: fields.vatRateUuid || null,
    vatRateRef: fields.vatRateUuid
      ? { uuid: fields.vatRateUuid, shortName: fields.vatRateName, rate: parseFloat(fields.vatRate) || 0 }
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
  isEditMode: boolean;
  formUid: string;
}

const SaleItemsFieldsForm: FC<SaleItemsFieldsFormProps> = ({
  fields,
  setFields,
  isLoading,
  isEditMode,
  formUid,
}) => {
  const handleNumericChange = useCallback((field: keyof TFields, value: string) => {
    setFields(withSaleItemRecalc(fields, { [field]: value }) as Partial<TFields>);
  }, [fields, setFields]);

  return (
    <div className={styles.FormBodyParts}>
      <Group align="row" gap="12px" className={styles.Form}>
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
          width="400px"
        />
      </Group>

      <Group align="row" gap="12px" className={styles.Form}>
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
      </Group>

      <Group align="row" gap="12px" className={styles.Form}>
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
            const rate = item?.rate != null ? String(Number(item.rate)) : fields.vatRate;
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
              vatRate: "0",
              ...recalcSaleItemAmounts(fields.quantity, fields.price, "0", fields.discountPercent),
            });
          }}
          disabled={isLoading}
          width="200px"
        />
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
      </Group>

      <Group align="row" gap="12px" className={styles.Form}>
        <FieldNumber
          label="Сумма скидки"
          name={`${formUid}_discAmt`}
          value={fields.discountAmount}
          disabled
          textAlign="right"
          width="150px"
        />
        <FieldNumber
          label="НДС (в т.ч.)"
          name={`${formUid}_vatAmt`}
          value={fields.vatAmount}
          disabled
          textAlign="right"
          width="150px"
        />
        <FieldNumber
          label="Итого"
          name={`${formUid}_amount`}
          value={fields.amount}
          disabled
          textAlign="right"
          width="180px"
        />
      </Group>

      {isEditMode && (
        <>
          <Divider />
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" }}>
              <Field
                label="N строки"
                name={`${formUid}_lineNum`}
                value={String(fields.lineNumber ?? "-")}
                disabled
                width="80px"
              />
              <Field
                label="ID"
                name={`${formUid}_id`}
                value={String(fields.id ?? "-")}
                disabled
                width="100px"
              />
              <Field
                label="UUID"
                name={`${formUid}_uuid`}
                value={String(fields.uuid ?? "-")}
                disabled
                width="300px"
              />
            </div>
          </Group>
        </>
      )}
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
        quantity: fd.quantity ? parseFloat(fd.quantity) : 0,
        price: fd.price ? parseFloat(fd.price) : 0,
        lineNumber: fd.lineNumber ? parseInt(fd.lineNumber, 10) : undefined,
        unitOfMeasureUuid: fd.unitOfMeasureUuid || null,
        vatRateUuid: fd.vatRateUuid || null,
        vatRate: fd.vatRate ? parseFloat(fd.vatRate) : 0,
        discountPercent: fd.discountPercent ? parseFloat(fd.discountPercent) : 0,
      };
    },

    buildPaneLabel: (saved) =>
      makePaneLabel(
        "SaleItemsList",
        "Товар",
        saved,
        saved.product?.shortName || String(saved.id ?? "?"),
      ),
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
          isEditMode={form.isEditMode}
          formUid={form.formUid}
        />
      ),
    },
  ], [form.fields, form.setFields, form.isLoading, form.isEditMode, form.formUid]);

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
      readonly={!canWrite}
      isDirty={form.isDirty}
    />
  );
};

const SaleItemsEmbeddedForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useAccessRight("Sale");
  const { windows: { removePane } } = useAppContext();
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
    if (paneProps.onClose) paneProps.onClose();
    if (uniqId) removePane(uniqId);
  }, [paneProps, uniqId, removePane]);

  const tabs = useMemo(() => [
    {
      id: "general",
      label: "Основное",
      component: (
        <SaleItemsFieldsForm
          fields={fields}
          setFields={setFields}
          isLoading={false}
          isEditMode={!!(fields.uuid || fields.id)}
          formUid={formUid}
        />
      ),
    },
  ], [fields, setFields, formUid]);

  return (
    <ModelFormWrapper
      paneId={uniqId}
      tabs={tabs}
      onSave={handleClose}
      onSaveAndClose={handleClose}
      onClose={handleClose}
      isLoading={false}
      showReload={false}
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
