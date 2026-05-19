import { FC } from "react";
import { Button } from "src/components/Button";

export interface FormPanelProps {
  onSaveAndClose?: () => void;
  onSave?: () => void;
  onReload?: () => void;
  onClose?: () => void;
  isLoading: boolean;
  // showReload?: boolean;
  /** Если true — скрыть кнопки сохранения (режим только чтение по правам доступа) */
  readonly?: boolean;
}

/**
 * Панель действий формы, рендерится в PaneItemHeaderToolbar через портал.
 *
 * Содержит только бизнес-действия:
 *   [Сохранить и закрыть] | [Сохранить] | [⟳ Обновить]
 *
 * Кнопка «Закрыть» (✕) управляется на уровне PaneItem.
 */
const FormPanel: FC<FormPanelProps> = ({
  onSaveAndClose,
  onSave,
  onReload,
  onClose,
  isLoading,
  readonly: isReadonly = false,
}) => {
  const effectiveSaveAndClose = isReadonly ? undefined : onSaveAndClose;
  const effectiveSave = isReadonly ? undefined : onSave;

  return (
    <>
      {effectiveSaveAndClose && (
        <Button variant="primary" onClick={effectiveSaveAndClose} disabled={isLoading}>
          <span style={{ fontWeight: 'bold' }}>Сохранить и закрыть</span>
        </Button>
      )}
      {effectiveSave && (
        <Button onClick={effectiveSave} disabled={isLoading}>
          <span>Сохранить</span>
        </Button>
      )}
      {onClose && (
        <Button onClick={onClose} disabled={isLoading}>
          <span>Закрыть</span>
        </Button>
      )}
    </>
  );
};

FormPanel.displayName = "FormPanel";
export default FormPanel;
