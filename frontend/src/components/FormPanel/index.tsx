import { FC } from "react";
import { Button } from "src/components/Button";
import { ReloadButton } from "src/components/Toolbar";

export interface FormPanelProps {
  onSaveAndClose?: () => void;
  onSave?: () => void;
  onReload?: () => void;
  isLoading: boolean;
  showReload?: boolean;
  /** Если true — скрыть кнопки сохранения (режим только чтение по правам доступа) */
  readonly?: boolean;
}

/**
 * Панель действий формы, рендерится в PaneHeaderToolbar через портал.
 *
 * Содержит только бизнес-действия:
 *   [Сохранить и закрыть] | [Сохранить] | [⟳ Обновить]
 *
 * Кнопка «Закрыть» (✕) и индикатор isDirty (●) управляются
 * на уровне PaneItem — они одинаковы для всех панелей.
 */
const FormPanel: FC<FormPanelProps> = ({
  onSaveAndClose,
  onSave,
  onReload,
  isLoading,
  showReload = true,
  readonly: isReadonly = false,
}) => {
  const effectiveSaveAndClose = isReadonly ? undefined : onSaveAndClose;
  const effectiveSave = isReadonly ? undefined : onSave;

  // Если нечего показывать (readonly без reload) — не рендерим ничего
  const hasActions = effectiveSaveAndClose || effectiveSave || (showReload && onReload);
  if (!hasActions) return null;

  return (
    <>
      {effectiveSaveAndClose && (
        <Button variant="primary" onClick={effectiveSaveAndClose} disabled={isLoading}>
          <span>Сохранить и закрыть</span>
        </Button>
      )}
      {effectiveSave && (
        <Button onClick={effectiveSave} disabled={isLoading}>
          <span>Сохранить</span>
        </Button>
      )}
      {showReload && onReload && (
        <ReloadButton onClick={onReload} disabled={isLoading} />
      )}
    </>
  );
};

FormPanel.displayName = "FormPanel";
export default FormPanel;
