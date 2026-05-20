import { FC } from "react";
import { Button } from "src/components/Button";
import { translate } from "src/i18";

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
          <span style={{ fontWeight: 'bold' }}>{translate("saveAndClose")}</span>
        </Button>
      )}
      {effectiveSave && (
        <Button onClick={effectiveSave} disabled={isLoading}>
          <span>{translate("save")}</span>
        </Button>
      )}
      {onClose && (
        <Button onClick={onClose} disabled={isLoading}>
          <span>{translate("close")}</span>
        </Button>
      )}
    </>
  );
};

FormPanel.displayName = "FormPanel";
export default FormPanel;
