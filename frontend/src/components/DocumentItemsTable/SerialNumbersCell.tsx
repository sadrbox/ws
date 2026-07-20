// Ячейка «Серийные номера» для строки документа (T6.1, Stage 1b).
// Показывается только для товаров с trackSerialNumbers. Две роли:
//   receipt (приёмка: Оприходование/Поступление/ГТД) — ввод серий текстом;
//   issue   (выбытие: Реализация/Списание)          — выбор из доступных in_stock.
// Кнопка с бейджем «n/qty» открывает модалку. Сохранение идёт в справочник серий
// сразу (документ должен быть уже сохранён — есть docUuid). Инвариант «серий == qty»
// финально проверяет сервер при проведении.
import { FC, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Notice, { type NoticeItem } from "src/components/Notice";
import apiClient from "src/services/api/client";
import Modal from "src/components/Modal";
import CellActionButton from "./CellActionButton";
import { getFormatDateOnly } from "src/utils/datetime";
import styles from "./SerialNumbersCell.module.scss";

export interface SerialCellProps {
  productUuid: string;
  quantity: number;
  docType: string;
  docUuid: string;
  mode: "receipt" | "issue";
  organizationUuid?: string;
  warehouseUuid?: string;
  /** Дата документа — учёт по сериям не применяется задним числом (serialTrackingSince). */
  documentDate?: string | null;
  disabled?: boolean;
}

interface SerialRow {
  uuid: string; serialNumber: string; status: string;
  issueDocUuid?: string | null;
  /** Откуда серия: «Оприходование № ОПРХ-5 от 01.07.2026» (бэк резолвит документ приёмки). */
  receiptLabel?: string | null;
}

const qkFlag = (uuid: string) => ["product-serial-flag", uuid];
const qkCount = (docUuid: string, productUuid: string, mode: string) => ["serial-count", mode, docUuid, productUuid];

export const SerialNumbersCell: FC<SerialCellProps> = ({ productUuid, quantity, docType, docUuid, mode, organizationUuid, warehouseUuid, documentDate, disabled }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Учитывается ли товар по сериям НА ДАТУ ЭТОГО ДОКУМЕНТА (кэш по товару).
  //
  // Учёт не применяется ЗАДНИМ ЧИСЛОМ: контроль действует только для документов с
  // датой >= serialTrackingSince (момент включения флага). Точно тот же инвариант
  // держит бэкенд (services/serialNumbers.js → serialTrackedProducts). Без этой
  // проверки старый документ показывал бы красное «0/150» и требовал серии, хотя
  // сохранению это уже не мешает — UI пугал бы несуществующей проблемой.
  const { data: trackState } = useQuery({
    queryKey: [...qkFlag(productUuid), documentDate ?? ""],
    queryFn: async (): Promise<{ ok: boolean; since: string | null }> => {
      const r = await apiClient.get<{ item?: { trackSerialNumbers?: boolean; serialTrackingSince?: string | null } }>(`products/${productUuid}`);
      const item = r.data?.item;
      if (item?.trackSerialNumbers !== true) return { ok: false, since: null };
      const since = item.serialTrackingSince ? new Date(item.serialTrackingSince) : null;
      if (!since) return { ok: true, since: null };
      // Новый документ (даты ещё нет) — считаем «сейчас»: учёт действует.
      const docAt = documentDate ? new Date(documentDate) : new Date();
      // since возвращаем только для «документ старше включения учёта» — на нём строится подсказка.
      return docAt >= since ? { ok: true, since: null } : { ok: false, since: item.serialTrackingSince ?? null };
    },
    enabled: !!productUuid,
    staleTime: 5 * 60_000,
  });
  const tracked = trackState?.ok === true;

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

  // Прочерк означал три разные вещи и ни одну не объяснял: товар не на учёте,
  // документ старше момента включения учёта, документ ещё не записан. Подсказываем.
  if (!tracked) {
    const title = trackState?.since
      ? `${translate("serialSinceHint")} ${getFormatDateOnly(String(trackState.since)) ?? ""} ${translate("trackingSinceSuffix")}`
      : translate("serialNotTracked");
    return <span className={styles.Dash} title={title}>—</span>;
  }
  if (!docUuid) return <span className={styles.Hint} title={translate("serialSaveFirst")}>—</span>;

  const qty = Number(quantity) || 0;
  const ok = count === qty && qty > 0;

  return (
    <div className={styles.Cell}>
      <CellActionButton
        icon="serial"
        status={`${count}/${qty}`}
        ok={ok}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={translate("serialNumbersShort")}
        aria-label={translate("serialNumbersShort")}
      />
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
  const [filter, setFilter] = useState("");

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
    ? textValue.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean).length
    : pickedSet.size;

  // ── Подсказки, чтобы не выбрать «не ту» серию ───────────────────────────────
  // Серии физически различимы: отгрузив не тот экземпляр, получим спор по гарантии
  // и возврату. Поэтому даём ЯВНЫЕ ориентиры и не даём набрать лишнего.
  const all = available.data ?? [];
  const rows = mode === "issue"
    ? all.filter((v) => !filter.trim() || v.serialNumber.toLowerCase().includes(filter.trim().toLowerCase()))
    : [];
  const full = currentCount >= quantity;         // норма набрана — лишнее выбрать нельзя
  const over = currentCount > quantity;

  // Дубликаты во вводе приёмки — частая ошибка (скопировали строку дважды).
  const receiptDupes = useMemo(() => {
    if (mode !== "receipt") return [];
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const v of textValue.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)) {
      const k = v.toLowerCase();
      if (seen.has(k)) dup.add(v); else seen.add(k);
    }
    return [...dup];
  }, [mode, textValue]);

  const notices: NoticeItem[] = [];
  if (error) notices.push({ type: "error", text: error });
  if (receiptDupes.length) {
    notices.push({ type: "error", text: `${translate("serialDuplicate")}: ${receiptDupes.join(", ")}` });
  }
  if (over) {
    notices.push({ type: "error", text: `${translate("serialTooMany")} (${currentCount} / ${quantity})` });
  } else if (currentCount < quantity) {
    notices.push({
      type: "attention",
      text: `${translate("serialNeedMore")}: ${quantity - currentCount}`,
    });
  } else if (!receiptDupes.length) {
    notices.push({ type: "success", text: translate("serialCountOk") });
  }
  if (mode === "issue" && all.length > 0 && all.length < quantity) {
    // Серий на складе физически меньше, чем продаём — предупредить ДО сохранения,
    // иначе пользователь упрётся в 422 при записи документа.
    notices.push({ type: "warning", text: `${translate("serialStockShort")}: ${all.length} / ${quantity}` });
  }
  if (mode === "issue") {
    notices.push({ type: "warning", text: translate("serialPickHint") });
  }

  return (
    <Modal title={`${translate("serialNumbers")} — ${translate("quantity")}: ${quantity}`} onClose={onClose} onApply={saving || over ? undefined : () => void save()}>
      <div className={styles.ModalBody}>
        {/* Ошибки/подсказки — это состояние ФОРМЫ, поэтому Notice, а не тост. */}
        <Notice items={notices} />

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
          <>
            {/* Фильтр: когда серий десятки, глазами искать нужную — прямой путь к ошибке. */}
            {all.length > 8 && (
              <input
                className={styles.Filter}
                value={filter}
                placeholder={translate("serialFilterHint")}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            <div className={styles.PickList}>
              {all.length === 0 && <div className={styles.Hint}>{translate("serialNoneAvailable")}</div>}
              {all.length > 0 && rows.length === 0 && <div className={styles.Hint}>{translate("no_results_found")}</div>}
              {rows.map((v) => {
                const checked = pickedSet.has(v.uuid);
                // Норма набрана → остальные гасим: физически нельзя отгрузить больше,
                // чем указано в количестве строки.
                const blocked = !checked && full;
                return (
                  <label
                    key={v.uuid}
                    className={[styles.PickRow, blocked ? styles.PickRowBlocked : ""].filter(Boolean).join(" ")}
                    title={blocked ? translate("serialLimitReached") : (v.receiptLabel ?? undefined)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={blocked}
                      onChange={(e) => {
                        const next = new Set(pickedSet);
                        if (e.target.checked) next.add(v.uuid); else next.delete(v.uuid);
                        setPicked(next);
                      }}
                    />
                    <span className={styles.PickSerial}>{v.serialNumber}</span>
                    {/* Происхождение — главный ориентир «та ли это серия». */}
                    {v.receiptLabel && <span className={styles.PickOrigin}>{v.receiptLabel}</span>}
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default SerialNumbersCell;
