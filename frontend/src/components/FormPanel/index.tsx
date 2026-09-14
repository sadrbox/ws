import { FC, ReactNode } from "react";
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
  /**
   * Записать сейчас нельзя по правилу формы (не по загрузке): кнопки видны, но недоступны,
   * а `saveTitle` говорит почему. Иначе кнопка молча не срабатывала бы.
   */
  saveDisabled?: boolean;
  /** Подсказка кнопок записи: причина недоступности или что именно будет записано. */
  saveTitle?: string;
  /** Кнопки после «Закрыть» — действия формы, не относящиеся к записи («Отменить изменения»). */
  afterClose?: ReactNode;
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
  saveDisabled = false,
  saveTitle,
  afterClose,
}) => {
  const effectiveSaveAndClose = isReadonly ? undefined : onSaveAndClose;
  const effectiveSave = isReadonly ? undefined : onSave;

  return (
    <>
      {effectiveSaveAndClose && (
        <Button variant="primary" onClick={effectiveSaveAndClose} disabled={isLoading || saveDisabled} title={saveTitle}>
          <span style={{ fontWeight: 'bold' }}>{translate("saveAndClose")}</span>
        </Button>
      )}
      {effectiveSave && (
        <Button onClick={effectiveSave} disabled={isLoading || saveDisabled} title={saveTitle}>
          <span>{translate("save")}</span>
        </Button>
      )}
      {onReload && (
        <Button onClick={onReload} disabled={isLoading}>
          <span>{translate("refresh")}</span>
        </Button>
      )}
      {onClose && (
        <Button onClick={onClose} disabled={isLoading}>
          <span>{translate("close")}</span>
        </Button>
      )}
      {afterClose}
    </>
  );
};

FormPanel.displayName = "FormPanel";
export default FormPanel;
