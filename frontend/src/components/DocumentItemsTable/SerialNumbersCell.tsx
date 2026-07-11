// Ячейка «Серийные номера» для строки документа (T6.1, Stage 1b).
// Показывается только для товаров с trackSerialNumbers. Две роли:
//   receipt (приёмка: Оприходование/Поступление/ГТД) — ввод серий текстом;
//   issue   (выбытие: Реализация/Списание)          — выбор из доступных in_stock.
// Кнопка с бейджем «n/qty» открывает модалку. Сохранение идёт в справочник серий
// сразу (документ должен быть уже сохранён — есть docUuid). Инвариант «серий == qty»
// финально проверяет сервер при проведении.
import { FC, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import apiClient from "src/services/api/client";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import styles from "./SerialNumbersCell.module.scss";

export interface SerialCellProps {
  productUuid: string;
  quantity: number;
  docType: string;
  docUuid: string;
  mode: "receipt" | "issue";
  organizationUuid?: string;
  warehouseUuid?: string;
  disabled?: boolean;
}

interface SerialRow { uuid: string; serialNumber: string; status: string; issueDocUuid?: string | null }

const qkFlag = (uuid: string) => ["product-serial-flag", uuid];
const qkCount = (docUuid: string, productUuid: string, mode: string) => ["serial-count", mode, docUuid, productUuid];

export const SerialNumbersCell: FC<SerialCellProps> = ({ productUuid, quantity, docType, docUuid, mode, organizationUuid, warehouseUuid, disabled }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Учитывается ли товар по сериям (кэш по товару).
  const { data: tracked } = useQuery({
    queryKey: qkFlag(productUuid),
    queryFn: async () => {
      const r = await apiClient.get<{ item?: { trackSerialNumbers?: boolean } }>(`products/${productUuid}`);
      return r.data?.item?.trackSerialNumbers === true;
    },
    enabled: !!productUuid,
    staleTime: 5 * 60_000,
  });

  // Текущее число серий, привязанных к строке (для бейджа).
  const { data: count = 0 } = useQuery({
    queryKey: qkCount(docUuid, productUuid, mode),
    queryFn: async () => {
      if (mode === "receipt") {
        const r = await apiClient.get<{ items?: SerialRow[] }>("serialnumbers/receipt", { params: { docType, docUuid, productUuid } });
        return (r.data?.items ?? []).length;
      }
      const r = await apiClient.get<{ items?: SerialRow[] }>("serialnumbers/available", { params: { productUuid, warehouseUuid, issueDocUuid: docUuid } });
      return (r.data?.items ?? []).filter((s) => s.issueDocUuid === docUuid).length;
    },
    enabled: !!productUuid && !!docUuid && tracked === true,
    staleTime: 0,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qkCount(docUuid, productUuid, mode) });
  }, [queryClient, docUuid, productUuid, mode]);

  if (tracked !== true) return <span className={styles.Dash}>—</span>;
  if (!docUuid) return <span className={styles.Hint} title={translate("serialSaveFirst")}>—</span>;

  const qty = Number(quantity) || 0;
  const ok = count === qty && qty > 0;

  return (
    <div className={styles.Cell}>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <span className={ok ? styles.CountOk : styles.CountBad}>{count}/{qty}</span>
        <span className={styles.BtnLabel}>{translate("serialNumbersShort")}</span>
      </Button>
      {open && (
        <SerialModal
          onClose={() => setOpen(false)}
          onSaved={() => { invalidate(); setOpen(false); }}
          {...{ productUuid, quantity: qty, docType, docUuid, mode, organizationUuid, warehouseUuid }}
        />
      )}
    </div>
  );
};

// ── Модалка ввода/выбора серий ───────────────────────────────────────────────
const SerialModal: FC<Omit<SerialCellProps, "disabled"> & { onClose: () => void; onSaved: () => void }> = ({
  productUuid, quantity, docType, docUuid, mode, organizationUuid, warehouseUuid, onClose, onSaved,
}) => {
  const [text, setText] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Приёмка: подгружаем уже введённые серии в textarea.
  const receipt = useQuery({
    queryKey: ["serial-receipt-edit", docUuid, productUuid],
    queryFn: async () => {
      const r = await apiClient.get<{ items?: SerialRow[] }>("serialnumbers/receipt", { params: { docType, docUuid, productUuid } });
      return (r.data?.items ?? []).map((s) => s.serialNumber);
    },
    enabled: mode === "receipt",
    staleTime: 0,
  });

  // Выбытие: доступные in_stock + уже выбранные этим документом.
  const available = useQuery({
    queryKey: ["serial-available", docUuid, productUuid, warehouseUuid],
    queryFn: async () => {
      const r = await apiClient.get<{ items?: SerialRow[] }>("serialnumbers/available", { params: { productUuid, warehouseUuid, issueDocUuid: docUuid } });
      return r.data?.items ?? [];
    },
    enabled: mode === "issue",
    staleTime: 0,
  });

  const textValue = text ?? (receipt.data ? receipt.data.join("\n") : "");
  const pickedSet = picked ?? new Set((available.data ?? []).filter((s) => s.issueDocUuid === docUuid).map((s) => s.uuid));

  const save = useCallback(async () => {
    setSaving(true); setError("");
    try {
      if (mode === "receipt") {
        const resp = await apiClient.post<{ conflicts?: string[] }>("serialnumbers/receipt", {
          docType, docUuid, productUuid, organizationUuid, warehouseUuid, serials: textValue,
        });
        const conflicts = resp.data?.conflicts ?? [];
        if (conflicts.length) { setError(translate("serialConflict") + ": " + conflicts.join(", ")); setSaving(false); return; }
      } else {
        await apiClient.post("serialnumbers/issue", { docType, docUuid, serialUuids: [...pickedSet] });
      }
      onSaved();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || translate("error"));
      setSaving(false);
    }
  }, [mode, docType, docUuid, productUuid, organizationUuid, warehouseUuid, textValue, pickedSet, onSaved]);

  const currentCount = mode === "receipt"
    ? textValue.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length
    : pickedSet.size;

  return (
    <Modal title={`${translate("serialNumbers")} — ${translate("quantity")}: ${quantity}`} onClose={onClose} onApply={saving ? undefined : () => void save()}>
      <div className={styles.ModalBody}>
        <div className={currentCount === quantity ? styles.CounterOk : styles.CounterBad}>
          {translate("serialSelected")}: {currentCount} / {quantity}
        </div>
        {mode === "receipt" ? (
          <textarea
            className={styles.Textarea}
            value={textValue}
            placeholder={translate("serialReceiptHint")}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(6, Math.min(16, quantity + 2))}
          />
        ) : (
          <div className={styles.PickList}>
            {(available.data ?? []).length === 0 && <div className={styles.Hint}>{translate("serialNoneAvailable")}</div>}
            {(available.data ?? []).map((s) => (
              <label key={s.uuid} className={styles.PickRow}>
                <input
                  type="checkbox"
                  checked={pickedSet.has(s.uuid)}
                  onChange={(e) => {
                    const next = new Set(pickedSet);
                    if (e.target.checked) next.add(s.uuid); else next.delete(s.uuid);
                    setPicked(next);
                  }}
                />
                <span>{s.serialNumber}</span>
              </label>
            ))}
          </div>
        )}
        {error && <div className={styles.Error}>{error}</div>}
      </div>
    </Modal>
  );
};

export default SerialNumbersCell;
