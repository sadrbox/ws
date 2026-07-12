import { FC, useCallback, useState } from "react";
import { Toolbar } from "src/components/Toolbar";
import { useTableContext } from "src/components/Table";
import { useSubTableContext } from "src/components/SubTable/context";
import { api } from "src/services/api/client";
import { useQueryClient } from "@tanstack/react-query";

interface PrimaryToolbarButtonProps {
  endpoint: string;
  label?: string;
  disabled?: boolean;
  /**
   * Вызывается после успешной смены основного. Нужен там, где «основной» хранится
   * не флагом строки, а полем РОДИТЕЛЯ (штрихкод товара — Product.barcode): форма
   * родителя должна перечитать данные, иначе её поле останется старым и при
   * сохранении откатит основной обратно.
   */
  onDone?: () => void | Promise<void>;
}

export const PrimaryToolbarButton: FC<PrimaryToolbarButtonProps> = ({
  endpoint,
  label = "Сделать основным",
  disabled = false,
  onDone,
}) => {
  const ctx = useTableContext();
  const subCtx = useSubTableContext();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const activeId = ctx.states.activeRow;
  const rows = subCtx?.rows ?? ctx.rows;
  const activeRow = activeId != null ? rows.find((r) => r.id === activeId) : null;
  const activeUuid = (activeRow?.uuid) ?? "";
  const alreadyPrimary = activeRow?.isPrimary === true;

  const handleClick = useCallback(async () => {
    if (!activeUuid || busy) return;
    setBusy(true);
    try {
      // Toggle: если уже основной — снимаем флаг, иначе — устанавливаем
      await api.put(`/${endpoint}/${activeUuid}`, { isPrimary: !alreadyPrimary });
      await queryClient.invalidateQueries({ queryKey: [endpoint] });
      await onDone?.();
    } finally {
      setBusy(false);
    }
  }, [activeUuid, alreadyPrimary, busy, endpoint, queryClient, onDone]);

  const title = busy
    ? "Сохранение…"
    : alreadyPrimary
      ? "Убрать основным"
      : label;

  return (
    <Toolbar.MakePrimaryButton
      onClick={handleClick}
      disabled={disabled || !activeUuid || busy}
      title={title}
      loading={busy}
    />
  );
};

export default PrimaryToolbarButton;
