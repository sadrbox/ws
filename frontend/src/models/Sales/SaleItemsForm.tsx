/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
import { FieldNumber } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupRow, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore, formStoreAPI } from "src/hooks/useFormStore";
import { useAccessRight } from "src/hooks/useAccessRight";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import ModelForm from "src/components/ModelForm";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import { useAppContext } from "src/app";
import useUID from "src/hooks/useUID";
import { withSaleItemRecalc } from "./saleItemDraft";

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
  amountWithoutVat: number;
  unitOfMeasureUuid: string;
  unitOfMeasureName: string;
  vatRate: number;
  vatAmount: number;
  /** Метод расчёта НДС из настроек НУО (только для пересчёта; на сервер не отправляется). */
  vatCalculationMethod: "INCLUDED" | "ADDED";
  discountPercent: number;
  discountAmount: number;
  exciseRate: number;
  exciseAmount: number;
  saleUuid: string;
}

interface EmbeddedSaleItemConfig {
  applyDraft: (nextRow: Record<string, unknown>) => void;
  /** Передаются из SaleItemsTable: организация и дата документа для подбора
   *  актуальных настроек учёта (флаги НДС/Скидка/Акциз, метод расчёта). */
  organizationUuid?: string | null;
  saleDate?: string | null;
}

const DEFAULT_FIELDS: TFields = {
  lineNumber: 0,
  productUuid: "",
  productName: "",
  quantity: 0,
  price: 0,
  amount: 0,
  amountWithoutVat: 0,
  unitOfMeasureUuid: "",
  unitOfMeasureName: "",
  vatRate: 0,
  vatAmount: 0,
  vatCalculationMethod: "INCLUDED",
  discountPercent: 0,
  discountAmount: 0,
  exciseRate: 0,
  exciseAmount: 0,
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
    amountWithoutVat: data.amountWithoutVat != null ? Number(data.amountWithoutVat) : 0,
    unitOfMeasureUuid: data.unitOfMeasureUuid ?? "",
    unitOfMeasureName: data.unitOfMeasure?.shortName ?? data.unitOfMeasureName ?? "",
    vatRate: data.vatRate != null ? Number(data.vatRate) : 0,
    vatAmount: data.vatAmount != null ? Number(data.vatAmount) : 0,
    vatCalculationMethod:
      String(data.vatCalculationMethod ?? "INCLUDED").toUpperCase() === "ADDED" ? "ADDED" : "INCLUDED",
    discountPercent: data.discountPercent != null ? Number(data.discountPercent) : 0,
    discountAmount: data.discountAmount != null ? Number(data.discountAmount) : 0,
    exciseRate: data.exciseRate != null ? Number(data.exciseRate) : 0,
    exciseAmount: data.exciseAmount != null ? Number(data.exciseAmount) : 0,
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
    amountWithoutVat: fields.amountWithoutVat,
    unitOfMeasureUuid: fields.unitOfMeasureUuid || null,
    unitOfMeasure: fields.unitOfMeasureUuid ? { uuid: fields.unitOfMeasureUuid, shortName: fields.unitOfMeasureName } : null,
    vatRate: fields.vatRate,
    vatAmount: fields.vatAmount,
    discountPercent: fields.discountPercent,
    discountAmount: fields.discountAmount,
    exciseRate: fields.exciseRate,
    exciseAmount: fields.exciseAmount,
    saleUuid: fields.saleUuid,
  };
}

interface SaleItemsFieldsFormProps {
  fields: TFields;
  setFields: (patch: Partial<TFields>) => void;
  isLoading: boolean;
  formUid: string;
  /** Контекст документа: организация и дата → определяют активные настройки
   *  учёта (флаги НДС/Скидка/Акциз и метод расчёта НДС). */
  organizationUuid?: string | null;
  saleDate?: string | null;
}

const SaleItemsFieldsForm: FC<SaleItemsFieldsFormProps> = ({
  fields,
  setFields,
  isLoading,
  formUid,
  organizationUuid,
  saleDate,
}) => {
  const { isVatEnabled, useDiscount, useExcise, vatCalculationMethod } =
    useOrgAccountingSettings(organizationUuid ?? null, saleDate ?? null);

  // Пересчёт всегда использует фактический метод НДС организации (INCLUDED/ADDED)
  // и текущую ставку акциза в строке (если useExcise=true).
  const handleNumericChange = useCallback((field: keyof TFields, value: string) => {
    const current = { ...fields, vatCalculationMethod };
    setFields(withSaleItemRecalc(current, { [field]: value }) as Partial<TFields>);
  }, [fields, setFields, vatCalculationMethod]);

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
              onSelect={(uuid, display, item) => {
                const upd: Partial<TFields> = { productUuid: uuid, productName: display };
                const umUuid = item?.unitOfMeasureUuid as string | undefined;
                const umName = (item?.unitOfMeasure?.shortName ?? item?.unitOfMeasure?.name) as string | undefined;
                if (umUuid) upd.unitOfMeasureUuid = umUuid;
                if (umName) upd.unitOfMeasureName = umName;
                setFields(upd);
              }}
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
              value={String(fields.quantity)}
              onChange={e => handleNumericChange("quantity", e.target.value)}
              disabled={isLoading}
              step="0.1"
              textAlign="right"
              width="160px"
            />
            <FieldNumber
              label="Цена"
              name={`${formUid}_price`}
              value={String(fields.price)}
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

          {/* Строка 3: Ставка НДС · Скидка % · Ставка акциза */}
          <GroupRow>
            {isVatEnabled && (
              <FieldNumber
                label="Ставка НДС, %"
                name={`${formUid}_vatRate`}
                value={String(fields.vatRate)}
                onChange={e => handleNumericChange("vatRate", e.target.value)}
                disabled={isLoading}
                step="0.01"
                min="0"
                max="100"
                textAlign="right"
                width="120px"
              />
            )}
            {useDiscount && (
              <FieldNumber
                label="Скидка %"
                name={`${formUid}_discPct`}
                value={String(fields.discountPercent)}
                onChange={e => handleNumericChange("discountPercent", e.target.value)}
                disabled={isLoading}
                step="0.1"
                textAlign="right"
                width="120px"
              />
            )}
            {useExcise && (
              <FieldNumber
                label="Ставка акциза, %"
                name={`${formUid}_exciseRate`}
                value={String(fields.exciseRate)}
                onChange={e => handleNumericChange("exciseRate", e.target.value)}
                disabled={isLoading}
                step="0.01"
                min="0"
                textAlign="right"
                width="140px"
              />
            )}
          </GroupRow>

          {/* Строка 4: Сумма скидки · Сумма акциза · НДС (сверху/в т.ч.) · Итого */}
          <GroupRow>
            {useDiscount && (
              <FieldNumber
                label="Сумма скидки"
                name={`${formUid}_discAmt`}
                value={String(fields.discountAmount)}
                disabled
                textAlign="right"
                width="150px"
              />
            )}
            {useExcise && (
              <FieldNumber
                label="Сумма акциза"
                name={`${formUid}_exciseAmt`}
                value={String(fields.exciseAmount)}
                disabled
                textAlign="right"
                width="150px"
              />
            )}
            {isVatEnabled && (
              <FieldNumber
                label={vatCalculationMethod === "ADDED" ? "НДС (сверху)" : "НДС (в т.ч.)"}
                name={`${formUid}_vatAmt`}
                value={String(fields.vatAmount)}
                disabled
                textAlign="right"
                width="150px"
              />
            )}
            <FieldNumber
              label="Итого"
              name={`${formUid}_amount`}
              value={String(fields.amount)}
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
  const data = paneProps.data as Record<string, any> | undefined;
  const saleUuid = data?.saleUuid as string | undefined;
  // Организация и дата документа прокидываются SaleItemsTable’ом в data.sale
  // (либо в корне data для самостоятельного открытия).
  const orgUuid = (data?.organizationUuid as string | null | undefined)
    ?? (data?.sale as { organizationUuid?: string | null } | undefined)?.organizationUuid
    ?? null;
  const saleDate = (data?.saleDate as string | null | undefined)
    ?? (data?.sale as { date?: string | null } | undefined)?.date
    ?? null;

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
        vatRate: fd.vatRate ? fd.vatRate : 0,
        discountPercent: fd.discountPercent ? fd.discountPercent : 0,
        exciseRate: fd.exciseRate ? fd.exciseRate : 0,
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
      id: "tab-details",
      label: translate("general"),
      component: (
        <SaleItemsFieldsForm
          fields={form.fields}
          setFields={form.setFields}
          isLoading={form.isLoading}
          formUid={form.formUid}
          organizationUuid={orgUuid}
          saleDate={saleDate}
        />
      ),
    },
  ], [form.fields, form.setFields, form.isLoading, form.isEditMode, form.formUid, orgUuid, saleDate]);

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite}
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
  const orgUuid = embedded?.organizationUuid ?? null;
  const saleDate = embedded?.saleDate ?? null;
  const initialFields = useMemo(() => mapDataToFields(data, data?.saleUuid as string | undefined), [data]);
  const [fields, setFieldsState] = useState<TFields>(initialFields);
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

  // Регистрация reload-обработчика в глобальном formStoreAPI: иначе кнопка
  // ⟳ в PaneItemHeaderToolbar (заголовок панели) не находит обработчик
  // и тихо ничего не делает (эта форма не использует useFormStore).
  useEffect(() => {
    if (!uniqId) return;
    formStoreAPI.register(uniqId, { reload: handleReload });
    return () => formStoreAPI.unregister(uniqId);
  }, [uniqId, handleReload]);

  const handleClose = useCallback(() => {
    if (paneProps.onClose) void paneProps.onClose();
    if (uniqId) void requestClose(uniqId, { force: true });
  }, [paneProps, uniqId, requestClose]);

  const tabs = useMemo(() => [
    {
      id: "tab-details",
      label: translate("general"),
      component: (
        <SaleItemsFieldsForm
          fields={fields}
          setFields={setFields}
          isLoading={false}
          formUid={formUid}
          organizationUuid={orgUuid}
          saleDate={saleDate}
        />
      ),
    },
  ], [fields, setFields, formUid, orgUuid, saleDate]);

  return (
    <ModelForm
      paneId={uniqId}
      tabs={tabs}
      onSave={handleClose}
      onSaveAndClose={handleClose}
      onClose={handleClose}
      onReload={handleReload}
      isLoading={false}
      readonly={!canWrite}
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
