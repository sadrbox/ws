import { FC, useCallback, useState } from "react";
import { Toolbar } from "src/components/Toolbar";
import { useTableContext } from "src/components/Table";
import { useSubTableContext } from "src/components/SubTable";
import { api } from "src/services/api/client";
import { useQueryClient } from "@tanstack/react-query";

interface PrimaryToolbarButtonProps {
  endpoint: string;
  label?: string;
  disabled?: boolean;
}

export const PrimaryToolbarButton: FC<PrimaryToolbarButtonProps> = ({
  endpoint,
  label = "Сделать основным",
  disabled = false,
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
    } finally {
      setBusy(false);
    }
  }, [activeUuid, alreadyPrimary, busy, endpoint, queryClient]);

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
