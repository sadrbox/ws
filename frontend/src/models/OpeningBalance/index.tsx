// ─────────────────────────────────────────────────────────────────────────────
// Ввод остатков серий / партий — обработка (не документ).
//
// ЗАЧЕМ. Учёт по сериям/партиям включают на товар, у которого УЖЕ есть остаток,
// набранный приходами без маркировки. Система начинает требовать серию/партию на
// каждую единицу выбытия — а под остаток их нет. Товар становится непродаваемым.
// Здесь остаток размечают: количество на складе НЕ меняется (см. services/openingBalance.js).
//
// Ошибки бэка (422 «нельзя разметить больше, чем лежит на складе») — это ошибки
// ДАННЫХ формы, поэтому идут в <Notice /> внутри формы, а не в тост.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useCallback, useEffect, useState } from "react";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
import { Field, FieldNumber, FieldDateTime } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import { Button } from "src/components/Button";
import Notice, { type NoticeItem } from "src/components/Notice";
import ModelForm from "src/components/ModelForm";
import { showToast } from "src/components/UIToast";
import { api } from "src/services/api/client";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import styles from "src/styles/main.module.scss";

interface Gap { stock: number; marked: number; gap: number }

const isSystemError = (status?: number) => !status || status >= 500 || status === 403;

const OpeningBalanceForm: FC<Partial<TPane>> = (paneProps) => {
  const defaultOrg = useDefaultOrganization();
  const uid = String(paneProps.uniqId ?? "ob");

  const [productUuid, setProductUuid] = useState("");
  const [productName, setProductName] = useState("");
  const [warehouseUuid, setWarehouseUuid] = useState("");
  const [warehouseName, setWarehouseName] = useState("");

  const [kind, setKind] = useState<"serial" | "batch">("serial");
  const [serials, setSerials] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState("");

  const [gap, setGap] = useState<Gap | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orgUuid = defaultOrg.organizationUuid ?? "";

  // Сколько остатка ещё не размечено — подсказка, чтобы пользователь не гадал.
  const loadGap = useCallback(async () => {
    if (!productUuid || !warehouseUuid) { setGap(null); return; }
    try {
      const r = await api.get<Gap>("opening-balance/gap", {
        params: { productUuid, warehouseUuid, organizationUuid: orgUuid, kind },
      });
      setGap({ stock: Number(r?.stock ?? 0), marked: Number(r?.marked ?? 0), gap: Number(r?.gap ?? 0) });
    } catch {
      setGap(null);
    }
  }, [productUuid, warehouseUuid, orgUuid, kind]);

  useEffect(() => { void loadGap(); }, [loadGap]);

  const submit = useCallback(async () => {
    setFormError(null);
    setBusy(true);
    try {
      const base = { productUuid, warehouseUuid, organizationUuid: orgUuid };
      if (kind === "serial") {
        const r = await api.post<{ created?: number }>("opening-balance/serials", { ...base, serials });
        showToast(`${translate("openingBalanceDone")}: ${r?.created ?? 0}`, "success");
        setSerials("");
      } else {
        await api.post("opening-balance/batches", {
          ...base, batchNumber, expiryDate: expiryDate || null, quantity: Number(quantity) || 0,
        });
        showToast(translate("openingBalanceDone"), "success");
        setBatchNumber(""); setExpiryDate(""); setQuantity("");
      }
      await loadGap();
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { message?: string } } };
      const status = err?.response?.status;
      const msg = err?.response?.data?.message ?? translate("error");
      // Системный сбой → тост; ошибка ДАННЫХ (422/400) → Notice внутри формы.
      if (isSystemError(status)) showToast(msg, "error");
      else setFormError(msg);
    } finally {
      setBusy(false);
    }
  }, [kind, productUuid, warehouseUuid, orgUuid, serials, batchNumber, expiryDate, quantity, loadGap]);

  const notices: NoticeItem[] = [];
  if (formError) notices.push({ type: "error", text: formError });
  if (!productUuid || !warehouseUuid) {
    notices.push({ type: "attention", text: translate("openingBalancePickProduct") });
  } else if (gap) {
    if (gap.gap > 0) {
      notices.push({
        type: "warning",
        text: `${translate("openingBalanceGapHint")}: ${gap.stock} / ${gap.marked} → ${gap.gap}`,
      });
    } else {
      notices.push({ type: "success", text: translate("openingBalanceAllMarked") });
    }
  }

  const canSubmit = !!productUuid && !!warehouseUuid && !busy && (
    kind === "serial" ? serials.trim().length > 0 : (!!batchNumber.trim() && Number(quantity) > 0)
  );

  const tabs = [{
    id: "tab-main",
    label: translate("general"),
    component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          <GroupCol>
            <div className={styles.SettingHint}>{translate("openingBalanceNote")}</div>

            <Group>
              <LookupField
                label={translate("ProductsList")} name={`${uid}_product`} endpoint="products"
                value={productUuid} displayValue={productName}
                onSelect={(u: string, d: string) => { setProductUuid(u); setProductName(d); setFormError(null); }}
                onClear={() => { setProductUuid(""); setProductName(""); }}
              />
              <LookupField
                label={translate("WarehousesList")} name={`${uid}_wh`} endpoint="warehouses"
                value={warehouseUuid} displayValue={warehouseName}
                onSelect={(u: string, d: string) => { setWarehouseUuid(u); setWarehouseName(d); setFormError(null); }}
                onClear={() => { setWarehouseUuid(""); setWarehouseName(""); }}
              />
            </Group>

            <GroupRow>
              <label className={styles.SettingChip}>
                <span className={styles.SettingSubLabel}>{translate("openingBalanceKind")}:</span>
                <select
                  value={kind}
                  onChange={(e) => { setKind(e.target.value === "batch" ? "batch" : "serial"); setFormError(null); }}
                  disabled={busy}
                >
                  <option value="serial">{translate("serialNumbers")}</option>
                  <option value="batch">{translate("batchNumber")}</option>
                </select>
              </label>
            </GroupRow>

            {kind === "serial" ? (
              <GroupCol>
                <span className={styles.SettingHint}>{translate("serialReceiptHint")}</span>
                <textarea
                  value={serials}
                  onChange={(e) => { setSerials(e.target.value); setFormError(null); }}
                  rows={8}
                  disabled={busy || !productUuid || !warehouseUuid}
                  style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: 8 }}
                />
              </GroupCol>
            ) : (
              <Group>
                <Field label={translate("batchNumber")} name={`${uid}_bn`} value={batchNumber}
                  onChange={(e) => { setBatchNumber(e.target.value); setFormError(null); }} disabled={busy} />
                <FieldDateTime label={translate("batchExpiry")} name={`${uid}_exp`} value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)} disabled={busy} width="200px" />
                <FieldNumber label={translate("quantity")} name={`${uid}_qty`} value={quantity}
                  onChange={(e) => { setQuantity(e.target.value); setFormError(null); }} disabled={busy} decimals={4} width="160px" />
              </Group>
            )}

            <GroupRow>
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                {translate("openingBalanceSubmit")}
              </Button>
            </GroupRow>
          </GroupCol>
        </div>
        <GroupCol className={styles.FormNotice}>
          <Notice items={notices} />
        </GroupCol>
      </div>
    ),
  }];

  // Обработка, а не документ: сохранять/закрывать нечего — запись идёт кнопкой
  // «Записать остатки». readonly убирает из шапки кнопки сохранения формы.
  return (
    <ModelForm
      paneId={uid} tabs={tabs} readonly isLoading={busy}
      onSave={() => {}} onSaveAndClose={() => {}} onClose={() => {}}
    />
  );
};

OpeningBalanceForm.displayName = "OpeningBalanceForm";
export { OpeningBalanceForm };
export default OpeningBalanceForm;
