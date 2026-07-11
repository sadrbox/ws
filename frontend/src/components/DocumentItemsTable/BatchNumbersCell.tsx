// Ячейка «Партия» строки документа (T6.1 Stage 2c). Показывается для товаров с
// trackBatches. batchUuid хранится ПРЯМО на строке (в отличие от серий), поэтому
// документ можно не сохранять заранее — партия сохраняется вместе со строкой.
//   receipt (приёмка) — ввод номера партии + срока годности → find-or-create;
//   issue   (выбытие) — выбор из доступных партий в порядке FEFO (раньше истекает
//                       — раньше предлагается).
import { FC, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import apiClient from "src/services/api/client";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import styles from "./SerialNumbersCell.module.scss";

export interface BatchCellProps {
  productUuid: string;
  mode: "receipt" | "issue";
  batchUuid: string;
  onChange: (batchUuid: string) => void;
  organizationUuid?: string;
  warehouseUuid?: string;
  disabled?: boolean;
}

interface Batch { uuid: string; batchNumber: string; expiryDate?: string | null; quantity?: number }

const fmtDate = (d?: string | null) => (d ? String(d).slice(0, 10) : "");

export const BatchNumbersCell: FC<BatchCellProps> = ({ productUuid, mode, batchUuid, onChange, organizationUuid, warehouseUuid, disabled }) => {
  const [open, setOpen] = useState(false);

  const { data: tracked } = useQuery({
    queryKey: ["product-batch-flag", productUuid],
    queryFn: async () => {
      const r = await apiClient.get<{ item?: { trackBatches?: boolean } }>(`products/${productUuid}`);
      return r.data?.item?.trackBatches === true;
    },
    enabled: !!productUuid, staleTime: 5 * 60_000,
  });

  // Метка выбранной партии (номер + срок).
  const { data: current } = useQuery({
    queryKey: ["batch", batchUuid],
    queryFn: async () => (await apiClient.get<{ item?: Batch }>(`productbatches/${batchUuid}`)).data?.item ?? null,
    enabled: !!batchUuid && tracked === true, staleTime: 60_000,
  });

  if (tracked !== true) return <span className={styles.Dash}>—</span>;

  const label = current ? `${current.batchNumber}${current.expiryDate ? ` · ${fmtDate(current.expiryDate)}` : ""}` : translate("batchChoose");

  return (
    <div className={styles.Cell}>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <span className={batchUuid ? styles.CountOk : styles.CountBad}>{label}</span>
      </Button>
      {open && (
        <BatchModal
          onClose={() => setOpen(false)}
          onPicked={(uuid) => { onChange(uuid); setOpen(false); }}
          {...{ productUuid, mode, organizationUuid, warehouseUuid, currentUuid: batchUuid }}
        />
      )}
    </div>
  );
};

const BatchModal: FC<{
  productUuid: string; mode: "receipt" | "issue"; organizationUuid?: string; warehouseUuid?: string; currentUuid: string;
  onClose: () => void; onPicked: (uuid: string) => void;
}> = ({ productUuid, mode, organizationUuid, warehouseUuid, currentUuid, onClose, onPicked }) => {
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [picked, setPicked] = useState(currentUuid);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Выбытие: доступные партии в порядке FEFO.
  const available = useQuery({
    queryKey: ["batch-available", productUuid, warehouseUuid],
    queryFn: async () => (await apiClient.get<{ items?: Batch[] }>("productbatches/available", { params: { productUuid, warehouseUuid, organizationUuid } })).data?.items ?? [],
    enabled: mode === "issue" && !!warehouseUuid, staleTime: 0,
  });

  const saveReceipt = useCallback(async () => {
    if (!number.trim()) { setError(translate("batchNumberRequired")); return; }
    setSaving(true); setError("");
    try {
      const r = await apiClient.post<{ item?: Batch }>("productbatches/find-or-create", {
        productUuid, batchNumber: number.trim(), expiryDate: expiry || null, organizationUuid,
      });
      const uuid = r.data?.item?.uuid;
      if (uuid) onPicked(uuid);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || translate("error"));
      setSaving(false);
    }
  }, [number, expiry, productUuid, organizationUuid, onPicked]);

  if (mode === "receipt") {
    return (
      <Modal title={translate("batchReceiptTitle")} onClose={onClose} onApply={saving ? undefined : () => void saveReceipt()}>
        <div className={styles.ModalBody}>
          <Field label={translate("batchNumber")} name="batch_number" value={number} onChange={(e) => setNumber(e.target.value)} />
          <Field label={translate("batchExpiry")} name="batch_expiry" value={expiry} placeholder="ГГГГ-ММ-ДД"
            onChange={(e) => setExpiry(e.target.value)} />
          {error && <div className={styles.Error}>{error}</div>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={translate("batchIssueTitle")} onClose={onClose} onApply={() => onPicked(picked)}>
      <div className={styles.ModalBody}>
        {(available.data ?? []).length === 0 && <div className={styles.Hint}>{translate("batchNoneAvailable")}</div>}
        <div className={styles.PickList}>
          {(available.data ?? []).map((b, i) => (
            <label key={b.uuid} className={styles.PickRow}>
              <input type="radio" name="batch-pick" checked={picked === b.uuid} onChange={() => setPicked(b.uuid)} />
              <span>{b.batchNumber}{b.expiryDate ? ` · ${translate("batchExpiryShort")} ${fmtDate(b.expiryDate)}` : ""} · {translate("serialInStock")} {b.quantity}{i === 0 ? ` · FEFO` : ""}</span>
            </label>
          ))}
        </div>
        {error && <div className={styles.Error}>{error}</div>}
      </div>
    </Modal>
  );
};

export default BatchNumbersCell;
