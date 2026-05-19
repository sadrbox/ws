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
  const activeUuid = (activeRow?.uuid as string | undefined) ?? "";
  const alreadyPrimary = activeRow?.isPrimary === true;

  const handleClick = useCallback(async () => {
    if (!activeUuid || alreadyPrimary || busy) return;
    setBusy(true);
    try {
      await api.put(`/${endpoint}/${activeUuid}`, { isPrimary: true });
      // Инвалидируем кэш — SubTable получит актуальные isPrimary-значения при следующем рендере.
      await queryClient.invalidateQueries({ queryKey: [endpoint] });
    } finally {
      setBusy(false);
    }
  }, [activeUuid, alreadyPrimary, busy, endpoint, queryClient]);

  return (
    <Toolbar.MakePrimaryButton
      onClick={handleClick}
      disabled={disabled || !activeUuid || alreadyPrimary || busy}
      title={busy ? "Сохранение…" : alreadyPrimary ? "Уже основной" : label}
      loading={busy}
    />
  );
};

export default PrimaryToolbarButton;
