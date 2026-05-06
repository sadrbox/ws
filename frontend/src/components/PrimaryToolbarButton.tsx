import { FC, useCallback } from "react";
import { Toolbar } from "src/components/Toolbar";
import { useTableContext } from "src/components/Table";
import { api } from "src/services/api/client";
import { useQueryClient } from "@tanstack/react-query";

interface PrimaryToolbarButtonProps {
  endpoint: string;
  label?: string;
  disabled?: boolean;
}

/**
 * Кнопка тулбара "Сделать основным" — устанавливает isPrimary=true
 * у активной строки таблицы. Бэкенд автоматически сбрасывает флаг
 * у других записей того же владельца (см. router/{bankaccounts,contracts}.js).
 *
 * Стилизована как другие кнопки тулбара (Toolbar.IconButton) — с
 * автошириной для текстового лейбла, чтобы визуально соответствовать
 * соседним InlineEditButton/ReloadButton/SettingsButton.
 */
export const PrimaryToolbarButton: FC<PrimaryToolbarButtonProps> = ({
  endpoint,
  label = "Сделать основным",
  disabled = false,
}) => {
  const ctx = useTableContext();
  const queryClient = useQueryClient();

  const activeId = ctx.states.activeRow;
  const activeRow = activeId != null ? ctx.rows.find((r) => r.id === activeId) : null;
  const activeUuid = (activeRow?.uuid as string | undefined) ?? "";
  const alreadyPrimary = activeRow?.isPrimary === true;

  const handleClick = useCallback(async () => {
    if (!activeUuid || alreadyPrimary) return;
    await api.put(`/${endpoint}/${activeUuid}`, { isPrimary: true });
    // Принудительный рефетч — invalidate + refetchQueries, чтобы новые
    // значения isPrimary немедленно попали в SubTable и сработало
    // жирное выделение через data-primary.
    await queryClient.refetchQueries({ queryKey: [endpoint] });
    void queryClient.invalidateQueries({ queryKey: ["primary-child", endpoint] });
    ctx.actions.refetch?.();
  }, [activeUuid, alreadyPrimary, endpoint, queryClient, ctx.actions]);

  return (
    <Toolbar.MakePrimaryButton
      onClick={handleClick}
      disabled={disabled || !activeUuid || alreadyPrimary}
      title={alreadyPrimary ? "Уже основной" : label}
    />
  );
};

export default PrimaryToolbarButton;
